import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { AiReasoningMode, AiTask } from '../ai-gateway.types'
import { AiRunMetrics, AiRunStage } from '../ai-run-timing'

export type AiRunDocument = AiRun & Document
export type AiRunStatus = 'running' | 'succeeded' | 'failed'

@Schema({ collection: 'ai_runs', timestamps: true })
export class AiRun {
  @Prop({ required: true, unique: true, index: true })
  runId: string

  @Prop({ required: true, index: true })
  graphName: string

  @Prop({ index: true })
  task?: AiTask

  @Prop({ enum: ['off', 'auto', 'deep'] })
  reasoningMode?: AiReasoningMode

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId

  @Prop()
  provider?: string

  @Prop()
  model?: string

  @Prop()
  durationMs?: number

  @Prop()
  retryCount?: number

  @Prop()
  fallbackUsed?: boolean

  @Prop({ enum: ['quality', 'provider'] })
  fallbackType?: 'quality' | 'provider'

  @Prop()
  fallbackReason?: string

  @Prop()
  finishReason?: string

  @Prop()
  contentChars?: number

  @Prop()
  reasoningChars?: number

  @Prop({ enum: ['valid', 'invalid'] })
  validationResult?: 'valid' | 'invalid'

  @Prop({
    type: [{
      _id: false,
      name: { type: String, enum: ['request', 'context_prepare', 'capacity_wait', 'provider', 'validation', 'persistence', 'response'], required: true },
      durationMs: { type: Number, required: true, min: 0 },
      status: { type: String, enum: ['succeeded', 'failed', 'skipped'], required: true },
      attempt: { type: Number, min: 0 },
      provider: String,
      model: String,
      fallbackType: { type: String, enum: ['quality', 'provider'] },
    }],
    default: undefined,
  })
  stages?: AiRunStage[]

  @Prop({
    type: {
      inputChars: { type: Number, min: 0 },
      candidateNotes: { type: Number, min: 0 },
      candidateChunks: { type: Number, min: 0 },
      outputChars: { type: Number, min: 0 },
    },
    default: undefined,
  })
  metrics?: AiRunMetrics

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
