import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { randomUUID } from 'crypto'
import { Model, Types } from 'mongoose'
import { AiRun, AiRunDocument, AiRunStatus } from './schemas/ai-run.schema'
import { AiReasoningMode, AiTask, AiTaskAttempt } from './ai-gateway.types'
import { AiRunMetrics, AiRunStage, sanitizeAiRunMetrics, sanitizeAiRunStage } from './ai-run-timing'

export interface AiRunStartInput {
  runId?: string
  graphName: string
  task?: AiTask
  reasoningMode?: AiReasoningMode
  userId?: string
  provider?: string
  model?: string
}

export interface AiRunRecord {
  runId: string
  graphName: string
  task?: AiTask
  reasoningMode?: AiReasoningMode
  userId?: string
  provider?: string
  model?: string
  durationMs?: number
  retryCount?: number
  fallbackUsed?: boolean
  fallbackType?: 'quality' | 'provider'
  fallbackReason?: string
  finishReason?: string
  contentChars?: number
  reasoningChars?: number
  validationResult?: 'valid' | 'invalid'
  stages?: AiRunStage[]
  metrics?: AiRunMetrics
  status: AiRunStatus
  error?: string
  createdAt?: Date
  updatedAt?: Date
  finishedAt?: Date
}

@Injectable()
export class AiRunService {
  constructor(@InjectModel(AiRun.name) private readonly model: Model<AiRunDocument>) {}

  async start(input: AiRunStartInput): Promise<AiRunRecord> {
    const doc = await this.model.create({
      runId: input.runId || randomUUID(),
      graphName: input.graphName,
      task: input.task,
      reasoningMode: input.reasoningMode,
      userId: this.toObjectId(input.userId),
      provider: input.provider,
      model: input.model,
      stages: [],
      metrics: {},
      status: 'running',
    })

    return this.toRecord(doc)
  }

  async succeed(runId: string, attempt?: AiTaskAttempt): Promise<AiRunRecord> {
    return this.finish(runId, 'succeeded', undefined, attempt)
  }

  async fail(runId: string, error: unknown): Promise<AiRunRecord> {
    return this.finish(runId, 'failed', this.errorMessage(error))
  }

  async addStage(runId: string, stage: AiRunStage): Promise<AiRunRecord> {
    const doc = await this.model.findOneAndUpdate(
      { runId },
      { $push: { stages: sanitizeAiRunStage(stage) } },
      { new: true },
    ).exec()
    return this.toRecord(doc)
  }

  async mergeMetrics(runId: string, metrics: AiRunMetrics): Promise<AiRunRecord> {
    const sanitized = sanitizeAiRunMetrics(metrics)
    const $set = Object.fromEntries(
      Object.entries(sanitized).map(([key, value]) => [`metrics.${key}`, value]),
    )
    const doc = await this.model.findOneAndUpdate(
      { runId },
      { $set },
      { new: true },
    ).exec()
    return this.toRecord(doc)
  }

  private async finish(
    runId: string,
    status: AiRunStatus,
    error?: string,
    attempt?: AiTaskAttempt,
  ): Promise<AiRunRecord> {
    const $set: Record<string, unknown> = {
      status,
      finishedAt: new Date(),
    }
    if (error) $set.error = error
    if (attempt) Object.assign($set, {
      task: attempt.task,
      reasoningMode: attempt.reasoningMode,
      provider: attempt.provider,
      model: attempt.model,
      durationMs: attempt.durationMs,
      retryCount: attempt.retryCount,
      fallbackUsed: attempt.fallbackUsed,
      fallbackType: attempt.fallbackType,
      fallbackReason: attempt.fallbackReason,
      finishReason: attempt.finishReason,
      contentChars: attempt.contentChars,
      reasoningChars: attempt.reasoningChars,
      validationResult: attempt.validationResult,
    })

    const doc = await this.model.findOneAndUpdate(
      { runId },
      { $set },
      { new: true },
    ).exec()

    return this.toRecord(doc)
  }

  private toRecord(doc: any): AiRunRecord {
    const value = typeof doc?.toObject === 'function' ? doc.toObject() : doc
    return {
      runId: value.runId,
      graphName: value.graphName,
      task: value.task,
      reasoningMode: value.reasoningMode,
      userId: value.userId ? String(value.userId) : undefined,
      provider: value.provider,
      model: value.model,
      durationMs: value.durationMs,
      retryCount: value.retryCount,
      fallbackUsed: value.fallbackUsed,
      fallbackType: value.fallbackType,
      fallbackReason: value.fallbackReason,
      finishReason: value.finishReason,
      contentChars: value.contentChars,
      reasoningChars: value.reasoningChars,
      validationResult: value.validationResult,
      stages: value.stages,
      metrics: value.metrics,
      status: value.status,
      error: value.error,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      finishedAt: value.finishedAt,
    }
  }

  private toObjectId(userId?: string): Types.ObjectId | undefined {
    if (!userId || !Types.ObjectId.isValid(userId)) return undefined
    return new Types.ObjectId(userId)
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message.slice(0, 1000)
    return String(error || 'Unknown AI run failure').slice(0, 1000)
  }
}
