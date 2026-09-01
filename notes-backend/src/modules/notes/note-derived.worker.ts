import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { DelayedError, Job, Worker } from 'bullmq'
import Redis from 'ioredis'
import { Model, Types } from 'mongoose'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { AiCapacityDeferredError } from '../ai/ai-provider-capacity.service'
import { NoteDerivedJobData, NOTE_DERIVED_QUEUE } from './note-derived-job.types'
import { NoteDerivedService, NoteDerivedSnapshot } from './note-derived.service'
import { NoteDerivedQueueService } from './note-derived-queue.service'
import { Note, NoteDocument } from './schemas/note.schema'

@Injectable()
export class NoteDerivedWorker implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<NoteDerivedJobData>
  private workerConnection?: Redis

  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    private readonly derived: NoteDerivedService,
    private readonly queue: NoteDerivedQueueService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit() {
    const connection = this.redis.duplicate({ maxRetriesPerRequest: null })
    this.workerConnection = connection
    this.worker = new Worker(NOTE_DERIVED_QUEUE, (job, token) => this.process(job, token), {
      connection,
      concurrency: 20,
    })
  }

  async process(job: Job<NoteDerivedJobData>, token?: string) {
    const startedAt = Date.now()
    if (job.data.nextRunAt && Date.parse(job.data.nextRunAt) > Date.now() && token) {
      await job.moveToDelayed(Date.parse(job.data.nextRunAt), token)
      throw new DelayedError()
    }
    const current = await this.noteModel.findOne({
      _id: new Types.ObjectId(job.data.noteId),
      userId: new Types.ObjectId(job.data.userId),
    }).lean().exec() as any
    if (!current) return { status: 'discarded', reason: 'note_missing_or_forbidden' }
    const currentUpdatedAt = new Date(current.updatedAt)
    if (currentUpdatedAt.toISOString() !== new Date(job.data.expectedUpdatedAt).toISOString()) {
      return { status: 'discarded', reason: 'stale_snapshot' }
    }

    const snapshot: NoteDerivedSnapshot = {
      noteId: String(current._id),
      userId: String(current.userId),
      title: String(current.title || ''),
      content: String(current.content || ''),
      summary: String(current.summary || ''),
      categoryId: current.categoryId ? String(current.categoryId) : undefined,
      tagIds: (current.tags || []).map((tag: any) => String(tag)),
      expectedUpdatedAt: currentUpdatedAt,
    }
    try {
      await this.derived.refreshTopicArtifacts(snapshot, job.data.changes)
      const latest = await this.queue.getJob(job.data.noteId)
      if (latest?.data.expectedUpdatedAt !== job.data.expectedUpdatedAt && token) {
        await job.moveToDelayed(Date.parse(latest?.data.nextRunAt || new Date().toISOString()), token)
        throw new DelayedError()
      }
      await job.updateData({ ...job.data, audit: { lastDurationMs: Date.now() - startedAt } })
      return { status: 'completed' }
    } catch (error) {
      if (error instanceof AiCapacityDeferredError && token) {
        await job.updateData({
          ...job.data,
          nextRunAt: new Date(Date.now() + error.retryAfterMs).toISOString(),
          audit: { lastErrorCode: 'capacity_delayed', lastDurationMs: Date.now() - startedAt },
        })
        await job.moveToDelayed(Date.now() + error.retryAfterMs, token)
        throw new DelayedError()
      }
      await job.updateData({
        ...job.data,
        audit: { lastErrorCode: 'derived_failed', lastDurationMs: Date.now() - startedAt },
      })
      throw error
    }
  }

  async onModuleDestroy() {
    await this.worker?.close()
    if (this.workerConnection) await this.workerConnection.quit().catch(() => this.workerConnection?.disconnect())
  }
}
