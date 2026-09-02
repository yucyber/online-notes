import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Schema as MongooseSchema, Types } from 'mongoose'
import { RagCitation } from '../../ai/rag/rag.types'

export type AssistantMessageStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled'
export type AssistantMessageRole = 'user' | 'assistant'

export type AssistantMessageDocument = AssistantMessage & Document

@Schema({ collection: 'assistant_messages', timestamps: true })
export class AssistantMessage {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: 'AssistantConversation', index: true })
  conversationId: Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId

  @Prop({ required: true })
  seq: number

  @Prop({ required: true, enum: ['user', 'assistant'] })
  role: AssistantMessageRole

  @Prop({ required: true, enum: ['pet', 'rag'] })
  route: 'pet' | 'rag'

  // content 不设 required：占位/流式中消息为空内容合法（Mongoose required 校验拒绝空串，会阻塞 createPlaceholder）。
  @Prop({ default: '' })
  content: string

  @Prop({ required: true, enum: ['pending', 'streaming', 'completed', 'failed', 'cancelled'], default: 'pending', index: true })
  status: AssistantMessageStatus

  @Prop()
  requestId?: string

  @Prop({ type: MongooseSchema.Types.ObjectId })
  retryOfMessageId?: Types.ObjectId

  @Prop({ type: [{ _id: false, evidenceId: String, noteId: String, noteTitle: String, chunkId: String, headingPath: [String], excerpt: String, score: Number }], default: [] })
  citations: RagCitation[]

  @Prop({ type: [String], default: [] })
  warnings: string[]

  @Prop({ type: { input: Number, output: Number }, default: undefined })
  tokenUsage?: { input: number; output: number }

  @Prop({ type: Date })
  completedAt?: Date
}

export const AssistantMessageSchema = SchemaFactory.createForClass(AssistantMessage)
AssistantMessageSchema.index({ conversationId: 1, seq: 1 }, { name: 'idx_assistant_msg_conv_seq', unique: true })
// 幂等锚点 = user 消息：同一 (userId, requestId) 只允许一条用户提问（防止重复生成）。assistant 消息的 requestId 仅用于关联/重放定位，不参与唯一。
AssistantMessageSchema.index({ userId: 1, requestId: 1 }, { name: 'idx_assistant_msg_user_request', unique: true, partialFilterExpression: { requestId: { $type: 'string' }, role: 'user' } })
