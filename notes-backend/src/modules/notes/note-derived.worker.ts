import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { DelayedError, Job, Worker } from 'bullmq'
import Redis from 'ioredis'
import { Model } from 'mongoose'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { AiCapacityDeferredError } from '../ai/ai-provider-capacity.service'
import { NoteDerivedJobData, NOTE_DERIVED_QUEUE } from './note-derived-job.types'
import { NoteDerivedService, NoteDerivedSnapshot } from './note-derived.service'
import { NoteDerivedQueueService } from './note-derived-queue.service'
import { Note, NoteDocument } from './schemas/note.schema'

@Injectable()
export class NoteDerivedWorker implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<NoteDerivedJobData>

  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    private readonly derived: NoteDerivedService,
    private readonly queue: NoteDerivedQueueService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit() {
    const connection = this.redis.duplicate({ maxRetriesPerRequest: null })
    this.worker = new Worker(NOTE_DERIVED_QUEUE, (job, token) => this.process(job, token), {
      connection,
      concurrency: 20,
    })
  }

  async process(job: Job<NoteDerivedJobData>, token?: string) {
    if (job.data.nextRunAt && Date.parse(job.data.nextRunAt) > Date.now() && token) {
      await job.moveToDelayed(Date.parse(job.data.nextRunAt), token)
      throw new DelayedError()
    }
    const current = await this.noteModel.findOne({ _id: job.data.noteId, userId: job.data.userId }).lean().exec() as any
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
      return { status: 'completed' }
    } catch (error) {
      if (error instanceof AiCapacityDeferredError && token) {
        await job.moveToDelayed(Date.now() + error.retryAfterMs, token)
        throw new DelayedError()
      }
      throw error
    }
  }

  async onModuleDestroy() {
    await this.worker?.close()
  }
}
