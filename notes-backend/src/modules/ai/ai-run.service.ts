import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { randomUUID } from 'crypto'
import { Model, Types } from 'mongoose'
import { AiRun, AiRunDocument, AiRunStatus } from './schemas/ai-run.schema'
import { AiReasoningMode, AiTask, AiTaskAttempt } from './ai-gateway.types'
import { AiRunMetrics, AiRunStage, sanitizeAiRunMetrics, sanitizeAiRunStage } from './ai-run-timing'
import { AiRunPerformanceQueryDto } from './dto'

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

export type AiRunPublicRecord = Omit<AiRunRecord, 'userId' | 'error' | 'stages' | 'metrics'> & {
  stages: AiRunStage[]
  metrics: AiRunMetrics
}

export interface AiRunStagePerformance {
  name: string
  requestCount: number
  p50Ms: number
  p95Ms: number
}

export interface AiRunTaskPerformance {
  task: string
  requestCount: number
  successRate: number
  fallbackRate: number
  p50Ms: number
  p95Ms: number
  stages: AiRunStagePerformance[]
}

export interface AiRunPerformance {
  requestCount: number
  successRate: number
  fallbackRate: number
  p50Ms: number
  p95Ms: number
  byTask: AiRunTaskPerformance[]
  recentRuns: {
    items: AiRunPublicRecord[]
    page: number
    size: number
    total: number
    totalPages: number
  }
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

  async getPerformance(userId: string | undefined, query: AiRunPerformanceQueryDto): Promise<AiRunPerformance> {
    const normalized = this.normalizePerformanceQuery(query)
    const filter: Record<string, unknown> = {
      userId: this.authenticatedUserId(userId),
      createdAt: { $gte: normalized.from, $lte: normalized.to },
    }
    if (normalized.task) filter.task = normalized.task
    if (normalized.provider) filter.provider = normalized.provider
    if (normalized.model) filter.model = normalized.model
    if (normalized.status) filter.status = normalized.status
    if (normalized.fallbackUsed !== undefined) filter.fallbackUsed = normalized.fallbackUsed

    // ACL 必须下推到首层 Mongo 查询，不能先按 runId 或筛选条件取出后再判断归属。
    const docs = await this.model.find(filter).sort({ createdAt: -1 }).lean().exec()
    const records = docs.map((doc) => this.toPublicRecord(doc))
    const offset = (normalized.page - 1) * normalized.size

    return {
      ...this.aggregate(records),
      byTask: this.byTask(records),
      recentRuns: {
        items: records.slice(offset, offset + normalized.size),
        page: normalized.page,
        size: normalized.size,
        total: records.length,
        totalPages: records.length === 0 ? 0 : Math.ceil(records.length / normalized.size),
      },
    }
  }

  async getRun(userId: string | undefined, runId: string): Promise<AiRunPublicRecord> {
    // 不区分不存在与跨用户记录，避免 runId 被用来探测其他用户的运行数据。
    const doc = await this.model.findOne({
      userId: this.authenticatedUserId(userId),
      runId,
    }).lean().exec()
    if (!doc) throw new NotFoundException('AI run not found')
    return this.toPublicRecord(doc)
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

  private normalizePerformanceQuery(query: AiRunPerformanceQueryDto = {} as AiRunPerformanceQueryDto) {
    const to = query.to ? new Date(query.to) : new Date()
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000)
    const page = query.page === undefined ? 1 : Number(query.page)
    const size = query.size === undefined ? 20 : Number(query.size)
    const fallbackUsed = query.fallbackUsed === undefined
      ? undefined
      : query.fallbackUsed === true || (query.fallbackUsed as any) === 'true'

    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
      throw new BadRequestException('Invalid AI run date range')
    }
    if (to.getTime() - from.getTime() > 90 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('AI run date range cannot exceed 90 days')
    }
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 100) {
      throw new BadRequestException('Invalid AI run pagination')
    }

    return { ...query, from, to, page, size, fallbackUsed }
  }

  private aggregate(records: AiRunPublicRecord[]) {
    const durations = records.map((record) => record.durationMs).filter(this.isDuration)
    return {
      requestCount: records.length,
      successRate: this.rate(records.filter((record) => record.status === 'succeeded').length, records.length),
      fallbackRate: this.rate(records.filter((record) => record.fallbackUsed === true).length, records.length),
      p50Ms: this.percentile(durations, 0.5),
      p95Ms: this.percentile(durations, 0.95),
    }
  }

  private toPublicRecord(doc: any): AiRunPublicRecord {
    const record = this.toRecord(doc)
    const { userId: _userId, error: _error, ...publicRecord } = record
    return {
      ...publicRecord,
      stages: Array.isArray(record.stages) ? record.stages.map(sanitizeAiRunStage) : [],
      metrics: sanitizeAiRunMetrics(record.metrics || {}),
    }
  }

  private byTask(records: AiRunPublicRecord[]): AiRunTaskPerformance[] {
    const groups = new Map<string, AiRunPublicRecord[]>()
    for (const record of records) {
      const task = record.task || 'unknown'
      groups.set(task, [...(groups.get(task) || []), record])
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([task, taskRecords]) => ({
        task,
        ...this.aggregate(taskRecords),
        stages: this.aggregateStages(taskRecords),
      }))
  }

  private aggregateStages(records: AiRunPublicRecord[]): AiRunStagePerformance[] {
    const groups = new Map<string, number[]>()
    for (const stage of records.flatMap((record) => record.stages || [])) {
      if (!this.isDuration(stage.durationMs)) continue
      groups.set(stage.name, [...(groups.get(stage.name) || []), stage.durationMs])
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, durations]) => ({
        name,
        requestCount: durations.length,
        p50Ms: this.percentile(durations, 0.5),
        p95Ms: this.percentile(durations, 0.95),
      }))
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
  }

  private rate(count: number, total: number): number {
    return total === 0 ? 0 : count / total
  }

  private isDuration(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
  }

  private authenticatedUserId(userId?: string): Types.ObjectId {
    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid authenticated user id')
    }
    return new Types.ObjectId(userId)
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
