import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
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
}
