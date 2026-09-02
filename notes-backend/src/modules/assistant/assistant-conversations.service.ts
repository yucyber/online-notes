import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import type { AssistantMessagesService } from './assistant-messages.service'
import { toObjectId } from './object-id.util'
import { AssistantConversation, AssistantConversationDocument } from './schemas/assistant-conversation.schema'

@Injectable()
export class AssistantConversationsService {
  constructor(@InjectModel(AssistantConversation.name) private readonly model: Model<AssistantConversationDocument>) {}

  async ensure(userId: string, opts?: { knowledgeBaseId?: string; title?: string }): Promise<{ id: string; isNew: boolean }> {
    const existing = await this.model.findOne({ userId: new Types.ObjectId(userId), status: 'active' }).sort({ updatedAt: -1 }).select('_id').lean().exec()
    if (existing) return { id: String(existing._id), isNew: false }
    const created = await this.model.create({
      userId: new Types.ObjectId(userId),
      title: opts?.title || '新对话',
      ...(opts?.knowledgeBaseId ? { knowledgeBaseId: new Types.ObjectId(opts.knowledgeBaseId) } : {}),
    })
    return { id: String(created._id), isNew: true }
  }

  async get(userId: string, id: string) {
    // 只认 active 会话：archived/deleted 会话命中视为不存在（调用方回退新建），避免新消息写入失效会话。
    const doc = await this.model.findOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId), status: 'active' }).lean().exec()
    if (!doc) return null
    return { id: String(doc._id), title: String(doc.title || ''), status: doc.status }
  }

  async touch(userId: string, id: string, delta: { lastMessageAt: Date; messageCount: number; knowledgeBaseId?: string | null }) {
    const update: any = { $set: { lastMessageAt: delta.lastMessageAt, messageCount: delta.messageCount } }
    if (delta.knowledgeBaseId !== undefined) update.$set.knowledgeBaseId = delta.knowledgeBaseId ? new Types.ObjectId(delta.knowledgeBaseId) : null
    await this.model.updateOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) }, update).exec()
  }

  async rename(userId: string, id: string, title: string) {
    const nextTitle = String(title || '').trim().slice(0, 80) || '新对话'
    const doc = await this.model.findOneAndUpdate(
      { _id: toObjectId(id), userId: toObjectId(userId) },
      { $set: { title: nextTitle } },
      { new: true },
    ).lean().exec()
    if (!doc) throw new NotFoundException('conversation not found')
    return { id: String(doc._id), title: String(doc.title) }
  }

  // 自动标题专用：仅当标题仍为默认"新对话"时原子更新（默认标题进查询条件），
  // 避免覆盖生成期间用户手动改的标题，也让"新会话首次生成失败后标题卡默认"的会话在后续成功问答时补上标题。
  // 会话不存在或标题已改时静默返回（不抛 NotFound）：自动标题是尽力而为，非管理操作，调用方已 .catch 兜底。
  async renameIfDefault(userId: string, id: string, title: string) {
    const nextTitle = String(title || '').trim().slice(0, 80) || '新对话'
    await this.model.updateOne(
      { _id: toObjectId(id), userId: toObjectId(userId), title: '新对话' },
      { $set: { title: nextTitle } },
    ).exec()
  }

  async setStatus(userId: string, id: string, status: 'active' | 'archived' | 'deleted') {
    const update: any = { $set: { status } }
    if (status === 'deleted') update.$set.deletedAt = new Date()
    if (status === 'active') update.$set.deletedAt = null
    const doc = await this.model.findOneAndUpdate(
      { _id: toObjectId(id), userId: toObjectId(userId) },
      update,
      { new: true },
    ).lean().exec()
    if (!doc) throw new NotFoundException('conversation not found')
    return { id: String(doc._id), status: doc.status }
  }

  async setActiveRequest(userId: string, id: string, requestId: string | null) {
    // 显式写 null 清空（$set: undefined 在 Mongoose 中不更新字段，会残留旧 requestId）；找不到会话时抛 NotFound（管理操作与 rename/setStatus 一致）。
    const doc = await this.model.findOneAndUpdate(
      { _id: toObjectId(id), userId: toObjectId(userId) },
      { $set: { activeRequestId: requestId } },
      { new: true },
    ).lean().exec()
    if (!doc) throw new NotFoundException('conversation not found')
  }

  async getActiveRequest(userId: string, id: string) {
    // 只读辅助：会话不存在时返回 null（cancelByConversation 据此跳过取消），与写操作抛 NotFound 区分。
    const doc = await this.model.findOne({ _id: toObjectId(id), userId: toObjectId(userId) }, 'activeRequestId')
    return doc?.activeRequestId ?? null
  }

  // 标题搜索：排除 deleted（archived 仍可搜到），query 转义后正则包含匹配，按 updatedAt 倒序最多 20 条。
  async searchByTitle(userId: string, query: string): Promise<Array<{ id: string; title: string; updatedAt: string }>> {
    const q = String(query || '').trim()
    if (!q) return []
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const docs = await this.model.find({
      userId: toObjectId(userId), status: { $ne: 'deleted' }, title: { $regex: escaped, $options: 'i' },
    }).sort({ updatedAt: -1 }).limit(20).lean() as any[]
    return docs.map((doc) => ({ id: String(doc._id), title: String(doc.title || ''), updatedAt: String(doc.updatedAt || new Date().toISOString()) }))
  }

  // 分支会话（从历史续写）：读源会话、复制 seq ≤ throughSeq 的成功问答前缀（copyPrefix 已限 completed）到新会话并重排 seq，
  // 标题追加 "· 分支"，记录 parentConversationId/forkedFromSeq 溯源。源会话不属于该用户或不存在时抛 NotFound（写操作语义与 rename/setStatus 一致）。
  async branch(userId: string, sourceId: string, throughSeq: number, messages: AssistantMessagesService): Promise<{ id: string; parentConversationId: string; forkedFromSeq: number }> {
    // 源会话读取不带 .lean().exec() 链：测试内存模型 findOne 同步返回 doc，await findOne 对真实 Mongoose 同样返回 doc。
    const source = await this.model.findOne({ _id: toObjectId(sourceId), userId: toObjectId(userId) })
    if (!source) throw new NotFoundException('conversation not found')
    const prefix = await messages.copyPrefix(userId, sourceId, throughSeq)
    // messageCount/lastMessageAt 在 create 时携带（而非 create 后 touch）：与 generation 的 touch 语义一致——
    // messageCount = 复制消息总数，lastMessageAt = 最后一条前缀的 createdAt；少一次写且字段随会话同生；空前缀时不写 lastMessageAt。
    const created = await this.model.create({
      userId: toObjectId(userId),
      title: `${String(source.title || '新对话')} · 分支`,
      status: 'active',
      defaultRoute: source.defaultRoute || 'auto',
      parentConversationId: source._id,
      forkedFromSeq: throughSeq,
      messageCount: prefix.length,
      ...(prefix.length ? { lastMessageAt: prefix[prefix.length - 1].createdAt } : {}),
    })
    try {
      for (const [index, message] of prefix.entries()) {
        await messages.appendBranchMessage(userId, String(created._id), index + 1, message)
      }
    } catch (error) {
      // 复制中途失败：删除刚创建的空壳会话避免孤儿会话（部分已复制消息随之不可达）；删除本身失败不掩盖原始错误。
      await this.model.deleteOne({ _id: created._id }).exec().catch(() => undefined)
      throw error
    }
    return { id: String(created._id), parentConversationId: sourceId, forkedFromSeq: throughSeq }
  }
}
