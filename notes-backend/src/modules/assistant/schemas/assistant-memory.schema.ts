import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Schema as MongooseSchema, Types } from 'mongoose'
import { MemoryEvidence, MemoryKind, MemoryRelationType, MemoryScope } from '../assistant.constants'

// 关联子文档用独立 Schema 声明：mongoose 8 对 @Prop 嵌套 type 字面量会在 create 时实例化空子文档
// 并校验其 required 字段——不带 relation 的 create 会误报 relation.type required（T1 scope 坑的 relation 变体），
// 独立子 Schema 才按可选子文档处理（不传即 undefined，传了才校验）。须定义在 AssistantMemory class 前
// 供其装饰器参数引用（装饰器在 class 定义时求值）。
const MemoryRelationSubSchema = new MongooseSchema(
  {
    type: { type: String, enum: ['supports', 'contradicts', 'supersedes', 'refines'], required: true },
    targetMemoryId: { type: MongooseSchema.Types.ObjectId },
  },
  { _id: false },
)

export type AssistantMemoryDocument = AssistantMemory & Document

@Schema({ collection: 'assistant_memories', timestamps: true })
export class AssistantMemory {
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

  // 范围子文档：默认 global，声明方式同候选 schema（type 为字面量字段）。
  // id 供非 global 范围锚定实体 ObjectId，供 findConflict/supersede/recall 按 'scope.id' 匹配。
  @Prop({ type: { type: String, enum: ['global', 'knowledge_base', 'note', 'conversation'], required: true, default: 'global' }, id: { type: MongooseSchema.Types.ObjectId } })
  scope: MemoryScope

  @Prop({ required: true, enum: ['confirmed', 'superseded'], default: 'confirmed', index: true })
  status: 'confirmed' | 'superseded'

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

  // 关联到被本节点 supersedes/supports 的既有节点；无则缺省（可选子文档，声明见文件顶部 MemoryRelationSubSchema）。
  @Prop({ type: MemoryRelationSubSchema })
  relation?: { type: MemoryRelationType; targetMemoryId: Types.ObjectId }

  @Prop({ required: true, enum: ['ok', 'stale'], default: 'ok' })
  evidenceStatus: 'ok' | 'stale'

  @Prop({ type: Date })
  validFrom?: Date

  @Prop({ type: Date })
  validTo?: Date

  @Prop({ type: Date })
  confirmedAt?: Date

  // 被哪个长期记忆节点替代（status: superseded 时写入）。
  @Prop({ type: MongooseSchema.Types.ObjectId })
  supersededById?: Types.ObjectId

  // 来源候选 id，保留审计回溯。
  @Prop({ type: MongooseSchema.Types.ObjectId })
  candidateId?: Types.ObjectId
}

export const AssistantMemorySchema = SchemaFactory.createForClass(AssistantMemory)
AssistantMemorySchema.index({ userId: 1, status: 1, updatedAt: -1 }, { name: 'idx_assistant_mem_user_status' })
AssistantMemorySchema.index({ userId: 1, scope: 1, subject: 1 }, { name: 'idx_assistant_mem_user_scope_subject' })
