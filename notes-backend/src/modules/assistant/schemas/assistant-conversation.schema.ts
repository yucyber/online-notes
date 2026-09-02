import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Schema as MongooseSchema, Types } from 'mongoose'

export type AssistantConversationStatus = 'active' | 'archived' | 'deleted'
export type AssistantRoute = 'auto' | 'pet' | 'rag'

export type AssistantConversationDocument = AssistantConversation & Document

@Schema({ collection: 'assistant_conversations', timestamps: true })
export class AssistantConversation {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId

  @Prop({ required: true, default: '新对话' })
  title: string

  @Prop({ required: true, enum: ['active', 'archived', 'deleted'], default: 'active', index: true })
  status: AssistantConversationStatus

  @Prop({ required: true, enum: ['auto', 'pet', 'rag'], default: 'auto' })
  defaultRoute: AssistantRoute

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'KnowledgeBase' })
  knowledgeBaseId?: Types.ObjectId

  @Prop({ type: Date })
  lastMessageAt?: Date

  @Prop({ required: true, default: 0 })
  messageCount: number

  @Prop({ type: Date })
  deletedAt?: Date

  @Prop()
  activeRequestId?: string

  @Prop({ type: Types.ObjectId })
  parentConversationId?: Types.ObjectId

  @Prop()
  forkedFromSeq?: number

  // 认知记忆（阶段四）：memoryEnabled 关闭/临时会话不产生长期候选；默认均开启/非临时，旧数据按开启处理。
  @Prop({ default: true })
  memoryEnabled: boolean

  @Prop({ default: false })
  temporary: boolean
}

export const AssistantConversationSchema = SchemaFactory.createForClass(AssistantConversation)
AssistantConversationSchema.index({ userId: 1, updatedAt: -1 }, { name: 'idx_assistant_conv_user_updated' })
