import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type KnowledgeBaseDocument = KnowledgeBase & Document

@Schema({ collection: 'knowledge_bases', timestamps: true })
export class KnowledgeBase {
  @Prop({ required: true })
  name: string

  @Prop({ default: '' })
  description?: string

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId
}

export const KnowledgeBaseSchema = SchemaFactory.createForClass(KnowledgeBase)

KnowledgeBaseSchema.index({ userId: 1, createdAt: -1 }, { name: 'idx_knowledge_base_user_created' })
KnowledgeBaseSchema.index({ userId: 1, name: 1 }, { name: 'uniq_knowledge_base_user_name', unique: true })
