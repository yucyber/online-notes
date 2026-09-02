import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Schema as MongooseSchema, Types } from 'mongoose'
import { MemoryEvidence, MemoryKind, MemoryScope } from '../assistant.constants'

export type AssistantMemoryCandidateDocument = AssistantMemoryCandidate & Document

@Schema({ collection: 'assistant_memory_candidates', timestamps: true })
export class AssistantMemoryCandidate {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: 'AssistantConversation', index: true })
  conversationId: Types.ObjectId

  @Prop({ required: true, enum: ['decision', 'preference', 'fact', 'hypothesis', 'open_question', 'constraint', 'lesson'] })
  kind: MemoryKind

  @Prop({ required: true })
  subject: string

  @Prop({ required: true })
  statement: string

  // 范围子文档：默认 global。type 字面量字段需以 { type: { type: String } } 形式声明，
  // 否则 mongoose 会把 type 当 SchemaType 声明并把 enum/default 误判为子路径。
  // id 供非 global 范围（knowledge_base/note/conversation）锚定实体 ObjectId；不声明会被 strict 模式静默剥离。
  @Prop({ type: { type: String, enum: ['global', 'knowledge_base', 'note', 'conversation'], required: true, default: 'global' }, id: { type: MongooseSchema.Types.ObjectId } })
  scope: MemoryScope

  @Prop({ required: true, enum: ['pending', 'rejected', 'confirmed'], default: 'pending', index: true })
  status: 'pending' | 'rejected' | 'confirmed'

  @Prop({ required: true, min: 0, max: 1 })
  confidence: number

  @Prop({
    required: true,
    type: [{
      _id: false,
      type: { type: String, enum: ['message', 'note_chunk'], required: true },
      messageId: { type: MongooseSchema.Types.ObjectId },
      noteId: { type: MongooseSchema.Types.ObjectId },
      chunkId: { type: MongooseSchema.Types.ObjectId },
      excerpt: { type: String, required: true },
    }],
  })
  evidence: MemoryEvidence[]

  // 证据去重锚点：sha1(userId|kind|subject|conversationId|messageIds)，与 pending/confirmed 候选撞键则跳过。
  @Prop({ required: true, unique: true })
  evidenceKey: string

  @Prop()
  rejectionReason?: string
}

export const AssistantMemoryCandidateSchema = SchemaFactory.createForClass(AssistantMemoryCandidate)
AssistantMemoryCandidateSchema.index({ userId: 1, status: 1, createdAt: -1 }, { name: 'idx_assistant_mc_user_status' })
