import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type AssistantCheckpointDocument = AssistantContextCheckpoint & Document

@Schema({ collection: 'assistant_context_checkpoints', timestamps: true })
export class AssistantContextCheckpoint {
  @Prop({ required: true, type: Types.ObjectId, ref: 'AssistantConversation', index: true })
  conversationId: Types.ObjectId

  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId

  @Prop({ required: true })
  throughSeq: number

  @Prop({ required: true, default: '' })
  summary: string

  @Prop({ type: [String], default: [] })
  decisions: string[]

  @Prop({ type: [String], default: [] })
  openQuestions: string[]

  @Prop({ type: [String], default: [] })
  referencedEntities: string[]

  @Prop({ type: [Types.ObjectId], default: [] })
  sourceMessageIds: Types.ObjectId[]
}

export const AssistantCheckpointSchema = SchemaFactory.createForClass(AssistantContextCheckpoint)
AssistantCheckpointSchema.index({ conversationId: 1, throughSeq: 1 }, { name: 'idx_assistant_cp_conv_seq', unique: true })
