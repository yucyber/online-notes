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
}
