import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { randomUUID } from 'crypto'
import { Model, Types } from 'mongoose'
import { AiRun, AiRunDocument, AiRunStatus } from './schemas/ai-run.schema'

export interface AiRunStartInput {
  runId?: string
  graphName: string
  userId?: string
  provider?: string
  model?: string
}

export interface AiRunRecord {
  runId: string
  graphName: string
  userId?: string
  provider?: string
  model?: string
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
      userId: this.toObjectId(input.userId),
      provider: input.provider,
      model: input.model,
      status: 'running',
    })

    return this.toRecord(doc)
  }

  async succeed(runId: string): Promise<AiRunRecord> {
    return this.finish(runId, 'succeeded')
  }

  async fail(runId: string, error: unknown): Promise<AiRunRecord> {
    return this.finish(runId, 'failed', this.errorMessage(error))
  }

  private async finish(
    runId: string,
    status: AiRunStatus,
    error?: string,
  ): Promise<AiRunRecord> {
    const $set: Record<string, unknown> = {
      status,
      finishedAt: new Date(),
    }
    if (error) $set.error = error

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
      userId: value.userId ? String(value.userId) : undefined,
      provider: value.provider,
      model: value.model,
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
