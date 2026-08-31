import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { JobsOptions, Queue } from 'bullmq'
import Redis from 'ioredis'
import { NoteDerivedJobData, NOTE_DERIVED_QUEUE, noteDerivedJobId } from './note-derived-job.types'

type DerivedQueue = Pick<Queue<NoteDerivedJobData>, 'add' | 'getJob' | 'close' | 'getJobCounts' | 'pause' | 'resume'>

@Injectable()
export class NoteDerivedQueueService implements OnModuleDestroy {
  constructor(
    private readonly queue: DerivedQueue,
    private readonly quietMs = 10_000,
    private readonly redis?: Redis,
    private readonly ownedConnection?: Redis,
  ) {}

  async schedule(data: NoteDerivedJobData) {
    return this.withNoteLock(data.noteId, () => this.scheduleLocked(data))
  }

  private async scheduleLocked(data: NoteDerivedJobData) {
    const scheduled = { ...data, nextRunAt: new Date(Date.now() + this.quietMs).toISOString() }
    const jobId = noteDerivedJobId(data.noteId)
    const existing = await this.queue.getJob(jobId)
    if (existing) {
      const state = await existing.getState()
      if (state === 'delayed' || state === 'waiting' || state === 'active') {
        await existing.updateData({
          ...scheduled,
          ...(existing.data.audit ? { audit: existing.data.audit } : {}),
          changes: {
            titleChanged: existing.data.changes.titleChanged || data.changes.titleChanged,
            contentChanged: existing.data.changes.contentChanged || data.changes.contentChanged,
            taxonomyChanged: existing.data.changes.taxonomyChanged || data.changes.taxonomyChanged,
          },
        })
        if (state === 'delayed') await existing.changeDelay(this.quietMs)
        return existing
      }
    }

    const options: JobsOptions = {
      jobId,
      delay: this.quietMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: false,
    }
    return this.queue.add(NOTE_DERIVED_QUEUE, scheduled, options)
  }

  private async withNoteLock<T>(noteId: string, action: () => Promise<T>): Promise<T> {
    if (!this.redis) return action()
    const key = `note-derived:lock:${noteId}`
    const owner = `${process.pid}-${Date.now()}-${Math.random()}`
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const acquired = await this.redis.set(key, owner, 'PX', 2_000, 'NX')
      if (acquired === 'OK') {
        try { return await action() }
        finally {
          await this.redis.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            1, key, owner,
          )
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`note-derived scheduling lock timeout for ${noteId}`)
  }

  getJob(noteId: string) {
    return this.queue.getJob(noteDerivedJobId(noteId))
  }

  async replayFailed(noteId: string) {
    const job = await this.getJob(noteId)
    if (!job || await job.getState() !== 'failed') throw new Error(`note ${noteId} has no failed derived job`)
    await job.retry()
    return job
  }

  getCounts() {
    return this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed')
  }

  pause() {
    return this.queue.pause()
  }

  resume() {
    return this.queue.resume()
  }

  async onModuleDestroy() {
    await this.queue.close()
    if (this.ownedConnection) await this.ownedConnection.quit().catch(() => this.ownedConnection?.disconnect())
  }
}
