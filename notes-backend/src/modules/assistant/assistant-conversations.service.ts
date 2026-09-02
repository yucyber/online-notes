import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
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

  // 测试内存模型用明文 id（'c1'/'u1'），生产是 ObjectId hex：isValid 兜底避免构造非法 ObjectId 抛错，同时保证生产查询仍按 ObjectId 匹配。
  private toObjectId(v: string) {
    return Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : v
  }

  async rename(userId: string, id: string, title: string) {
    const filter = { _id: this.toObjectId(id), userId: this.toObjectId(userId) }
    const doc = await this.model.findOne(filter)
    if (!doc) throw new Error('conversation not found')
    const nextTitle = String(title || '').trim().slice(0, 80) || '新对话'
    await this.model.updateOne(filter, { $set: { title: nextTitle } })
    return { id: String(doc._id), title: nextTitle }
  }

  async setStatus(userId: string, id: string, status: 'active' | 'archived' | 'deleted') {
    const filter = { _id: this.toObjectId(id), userId: this.toObjectId(userId) }
    const doc = await this.model.findOne(filter)
    if (!doc) throw new Error('conversation not found')
    const update: any = { $set: { status } }
    if (status === 'deleted') update.$set.deletedAt = new Date()
    if (status === 'active') update.$set.deletedAt = null
    await this.model.updateOne(filter, update)
    return { id: String(doc._id), status }
  }

  async setActiveRequest(userId: string, id: string, requestId: string | null) {
    // 显式写 null 清空（$set: undefined 在 Mongoose 中不更新字段，会残留旧 requestId）
    await this.model.updateOne({ _id: this.toObjectId(id), userId: this.toObjectId(userId) }, { $set: { activeRequestId: requestId } })
  }

  async getActiveRequest(userId: string, id: string) {
    const doc = await this.model.findOne({ _id: this.toObjectId(id), userId: this.toObjectId(userId) }, 'activeRequestId')
    return doc?.activeRequestId ?? null
  }
}
