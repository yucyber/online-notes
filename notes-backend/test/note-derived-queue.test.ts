import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NoteDerivedQueueService } from '../src/modules/notes/note-derived-queue.service'

class MemoryJob {
  state: string = 'delayed'
  delay = 0
  constructor(readonly id: string, public data: any) {}
  async getState() { return this.state }
  async updateData(data: any) { this.data = data }
  async changeDelay(delay: number) { this.delay = delay }
  async retry() { this.state = 'waiting' }
}

class MemoryQueue {
  jobs = new Map<string, MemoryJob>()
  async getJob(id: string) { return this.jobs.get(id) }
  async add(_name: string, data: any, options: any) {
    const existing = this.jobs.get(options.jobId)
    if (existing) return existing
    const job = new MemoryJob(options.jobId, data)
    job.delay = options.delay
    this.jobs.set(options.jobId, job)
    return job
  }
  async close() {}
}

const payload = (noteId: string, changes: any, updatedAt: string) => ({
  noteId,
  userId: 'user-1',
  changes,
  expectedUpdatedAt: updatedAt,
})

test('同一 note 只保留最新快照并合并变化类型，且 job 不保存正文', async () => {
  const queue = new MemoryQueue()
  const service = new NoteDerivedQueueService(queue as any, 10_000)

  await service.schedule(payload('note-1', { titleChanged: true, contentChanged: false, taxonomyChanged: false }, '2026-08-28T00:00:00.000Z'))
  await service.schedule(payload('note-1', { titleChanged: false, contentChanged: true, taxonomyChanged: true }, '2026-08-28T00:00:01.000Z'))

  assert.equal(queue.jobs.size, 1)
  const job = [...queue.jobs.values()][0]
  assert.deepEqual({ ...job.data, nextRunAt: undefined }, {
    ...payload('note-1', { titleChanged: true, contentChanged: true, taxonomyChanged: true }, '2026-08-28T00:00:01.000Z'),
    nextRunAt: undefined,
  })
  assert.ok(Date.parse(job.data.nextRunAt) > Date.now())
  assert.equal('content' in job.data, false)
  assert.equal('title' in job.data, false)
  assert.equal(job.delay, 10_000)
})

test('不同 note 共存，重新创建 queue service 后任务仍存在', async () => {
  const queue = new MemoryQueue()
  await new NoteDerivedQueueService(queue as any, 10_000).schedule(payload('note-1', { titleChanged: true, contentChanged: false, taxonomyChanged: false }, '2026-08-28T00:00:00.000Z'))
  await new NoteDerivedQueueService(queue as any, 10_000).schedule(payload('note-2', { titleChanged: false, contentChanged: true, taxonomyChanged: false }, '2026-08-28T00:00:00.000Z'))

  const rebuilt = new NoteDerivedQueueService(queue as any, 10_000)
  assert.ok(await rebuilt.getJob('note-1'))
  assert.ok(await rebuilt.getJob('note-2'))
})

test('只允许按 noteId 重放 failed job', async () => {
  const queue = new MemoryQueue()
  const service = new NoteDerivedQueueService(queue as any, 10_000)
  await service.schedule(payload('note-1', { titleChanged: true, contentChanged: false, taxonomyChanged: false }, '2026-08-28T00:00:00.000Z'))
  const job = (await service.getJob('note-1')) as unknown as MemoryJob

  await assert.rejects(() => service.replayFailed('note-1'), /failed/)
  job.state = 'failed'
  await service.replayFailed('note-1')
  assert.equal(job.state, 'waiting')
})
