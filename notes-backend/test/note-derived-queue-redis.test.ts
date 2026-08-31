import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { NoteDerivedQueueService } from '../src/modules/notes/note-derived-queue.service'

test('真实 Redis 中的 delayed job 在 queue 重建后恢复', async () => {
  const queueName = `note-derived-recovery-test-${process.pid}-${Date.now()}`
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
  const redis = new Redis(redisUrl)
  const firstConnection = redis.duplicate({ maxRetriesPerRequest: null })
  const firstQueue = new Queue(queueName, { connection: firstConnection })
  const first = new NoteDerivedQueueService(firstQueue as any, 60_000, redis, firstConnection)

  try {
    await first.schedule({
      noteId: 'note-recovery', userId: 'user-1', expectedUpdatedAt: '2026-08-28T00:00:00.000Z',
      changes: { titleChanged: false, contentChanged: true, taxonomyChanged: false },
    })
    await first.onModuleDestroy()

    const rebuiltConnection = redis.duplicate({ maxRetriesPerRequest: null })
    const rebuiltQueue = new Queue(queueName, { connection: rebuiltConnection })
    const rebuilt = new NoteDerivedQueueService(rebuiltQueue as any, 60_000, redis, rebuiltConnection)
    const recovered = await rebuilt.getJob('note-recovery')
    assert.equal(await recovered?.getState(), 'delayed')
    assert.equal(recovered?.data.noteId, 'note-recovery')
    await rebuiltQueue.obliterate({ force: true })
    await rebuilt.onModuleDestroy()
  } finally {
    await redis.quit()
  }
})
