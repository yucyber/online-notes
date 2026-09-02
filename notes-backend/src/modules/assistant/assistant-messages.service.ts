import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { RagCitation } from '../ai/rag/rag.types'
import { AssistantMessage, AssistantMessageDocument } from './schemas/assistant-message.schema'

export type AssistantMessageView = {
  id: string; conversationId: string; seq: number; role: 'user' | 'assistant'; route: 'pet' | 'rag'
  content: string; status: string; requestId?: string; retryOfMessageId?: string
  citations: RagCitation[]; warnings: string[]; tokenUsage?: { input: number; output: number }
  createdAt: string; completedAt?: string
}

function toView(doc: any): AssistantMessageView {
  return {
    id: String(doc._id), conversationId: String(doc.conversationId), seq: Number(doc.seq), role: doc.role, route: doc.route,
    content: String(doc.content || ''), status: doc.status, requestId: doc.requestId, retryOfMessageId: doc.retryOfMessageId ? String(doc.retryOfMessageId) : undefined,
    citations: Array.isArray(doc.citations) ? doc.citations : [], warnings: Array.isArray(doc.warnings) ? doc.warnings : [],
    tokenUsage: doc.tokenUsage, createdAt: String(doc.createdAt || new Date().toISOString()), completedAt: doc.completedAt ? String(doc.completedAt) : undefined,
  }
}

@Injectable()
export class AssistantMessagesService {
  constructor(@InjectModel(AssistantMessage.name) private readonly model: Model<AssistantMessageDocument>) {}

  async appendUser(userId: string, conversationId: string, route: 'pet' | 'rag', content: string, requestId: string): Promise<{ messageId: string; seq: number }> {
    const seq = await this.nextSeq(userId, conversationId)
    const created = await this.model.create({ userId: new Types.ObjectId(userId), conversationId: new Types.ObjectId(conversationId), seq, role: 'user', route, content, status: 'completed', requestId })
    return { messageId: String(created._id), seq }
  }

  async createPlaceholder(userId: string, conversationId: string, route: 'pet' | 'rag', requestId?: string, retryOfMessageId?: string): Promise<{ messageId: string; seq: number }> {
    const seq = await this.nextSeq(userId, conversationId)
    const created = await this.model.create({
      userId: new Types.ObjectId(userId), conversationId: new Types.ObjectId(conversationId), seq, role: 'assistant', route, content: '', status: 'pending',
      ...(requestId ? { requestId } : {}), ...(retryOfMessageId ? { retryOfMessageId: new Types.ObjectId(retryOfMessageId) } : {}),
    })
    return { messageId: String(created._id), seq }
  }

  // 顺序生成 seq：假设单写者；并发时依赖唯一索引 (conversationId, seq) 兜底报错，而非静默错序。
  private async nextSeq(userId: string, conversationId: string): Promise<number> {
    const last = await this.model.findOne({ userId: new Types.ObjectId(userId), conversationId: new Types.ObjectId(conversationId) }).sort({ seq: -1 }).select('seq').lean().exec()
    return (Number(last?.seq) || 0) + 1
  }

  async appendDelta(userId: string, messageId: string, content: string, tokenUsage?: { input: number; output: number }) {
    const update: any = { $set: { content, status: 'streaming' } }
    if (tokenUsage) update.$set.tokenUsage = tokenUsage
    await this.model.updateOne({ _id: new Types.ObjectId(messageId), userId: new Types.ObjectId(userId) }, update).exec()
  }

  async finalize(userId: string, messageId: string, payload: { content: string; citations: RagCitation[]; warnings: string[]; runId?: string; tokenUsage?: { input: number; output: number } }) {
    const update: any = { $set: { content: payload.content, citations: payload.citations, warnings: payload.warnings, status: 'completed', completedAt: new Date() } }
    if (payload.tokenUsage) update.$set.tokenUsage = payload.tokenUsage
    await this.model.updateOne({ _id: new Types.ObjectId(messageId), userId: new Types.ObjectId(userId) }, update).exec()
  }

  async markCancelled(userId: string, messageId: string, content: string) {
    await this.model.updateOne({ _id: new Types.ObjectId(messageId), userId: new Types.ObjectId(userId) }, { $set: { content, status: 'cancelled', completedAt: new Date() } }).exec()
  }

  async markFailed(userId: string, messageId: string, content: string) {
    await this.model.updateOne({ _id: new Types.ObjectId(messageId), userId: new Types.ObjectId(userId) }, { $set: { content, status: 'failed', completedAt: new Date() } }).exec()
  }

  async list(userId: string, conversationId: string, opts?: { afterSeq?: number; limit?: number }): Promise<AssistantMessageView[]> {
    const filter: any = { conversationId: new Types.ObjectId(conversationId), userId: new Types.ObjectId(userId) }
    if (opts?.afterSeq !== undefined) filter.seq = { $gt: opts.afterSeq }
    const docs = await this.model.find(filter).sort({ seq: 1 }).limit(Math.min(200, opts?.limit ?? 200)).lean().exec()
    return docs.map(toView)
  }

  // 幂等判断：任何角色存在即已生成；返回 seq 最大（通常为 assistant）用于补发终态。
  async getByRequestId(userId: string, requestId: string): Promise<AssistantMessageView | null> {
    const doc = await this.model.find({ userId: new Types.ObjectId(userId), requestId }).sort({ seq: -1 }).limit(1).lean().exec().then((rows) => rows[0] ?? null)
    return doc ? toView(doc) : null
  }

  // 测试内存模型用明文 id（'u1'），生产是 ObjectId hex：isValid 兜底避免构造非法 ObjectId 抛错（与 conversations service 一致）。
  private toObjectId(v: string) {
    return Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : v
  }

  // 搜索：query 转义后做 content 正则包含匹配；先取最近 limit 条命中，再按会话截断每会话最多 3 条——
  // 该顺序意味着某会话第 4+ 条新命中会挤掉其他会话的配额（按 brief 语义）。lean() 直接 await 返回数组（方案 A，与 .exec() 等效）。
  async searchMessages(userId: string, query: string, opts?: { limit?: number }): Promise<Array<{ conversationId: string; messageId: string; seq: number; role: 'user' | 'assistant'; snippet: string; updatedAt: string }>> {
    const q = String(query || '').trim()
    if (!q) return []
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const limit = Math.min(20, opts?.limit ?? 20)
    const docs = await this.model.find({
      userId: this.toObjectId(userId),
      content: { $regex: escaped, $options: 'i' },
    }).sort({ createdAt: -1 }).limit(limit).lean() as any[]
    const perConversation = new Map<string, number>()
    const filtered: any[] = []
    for (const doc of docs) {
      const key = String(doc.conversationId)
      const used = perConversation.get(key) || 0
      if (used >= 3) continue
      perConversation.set(key, used + 1)
      filtered.push(doc)
    }
    return filtered.map((doc) => {
      const text = String(doc.content || '').replace(/\s+/g, ' ').trim()
      const index = text.indexOf(q)
      const start = Math.max(0, index - 20)
      return {
        conversationId: String(doc.conversationId), messageId: String(doc._id), seq: Number(doc.seq),
        role: doc.role, snippet: (start > 0 ? '…' : '') + text.slice(start, start + 80) + (text.length > start + 80 ? '…' : ''),
        updatedAt: String(doc.updatedAt || doc.createdAt || new Date().toISOString()),
      }
    })
  }
}
