import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type AiRunDocument = AiRun & Document
export type AiRunStatus = 'running' | 'succeeded' | 'failed'

@Schema({ collection: 'ai_runs', timestamps: true })
export class AiRun {
  @Prop({ required: true, unique: true, index: true })
  runId: string

  @Prop({ required: true, index: true })
  graphName: string

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId

  @Prop()
  provider?: string

  @Prop()
  model?: string

  @Prop({ required: true, enum: ['running', 'succeeded', 'failed'], default: 'running', index: true })
  status: AiRunStatus

  @Prop()
  error?: string

  @Prop({ type: Date })
  finishedAt?: Date
}

export const AiRunSchema = SchemaFactory.createForClass(AiRun)

AiRunSchema.index({ userId: 1, createdAt: -1 }, { name: 'idx_ai_run_user_created' })
AiRunSchema.index({ graphName: 1, status: 1, createdAt: -1 }, { name: 'idx_ai_run_graph_status_created' })
