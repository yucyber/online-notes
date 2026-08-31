import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NoteDerivedWorker } from '../src/modules/notes/note-derived.worker'
import { AiCapacityDeferredError } from '../src/modules/ai/ai-provider-capacity.service'

function modelReturning(note: any) {
  return {
    findOne: () => ({ lean: () => ({ exec: async () => note }) }),
  }
}

test('worker 遇到陈旧 expectedUpdatedAt 时不写回任何派生字段', async () => {
  let refreshes = 0
  const worker = new NoteDerivedWorker(
    modelReturning({ _id: 'note-1', userId: 'user-1', updatedAt: new Date('2026-08-28T00:00:02.000Z') }) as any,
    { refreshTopicArtifacts: async () => { refreshes += 1 } } as any,
    { getJob: async () => undefined } as any,
    {} as any,
  )
  const result = await worker.process({
    data: {
      noteId: 'note-1', userId: 'user-1', expectedUpdatedAt: '2026-08-28T00:00:01.000Z',
      changes: { titleChanged: true, contentChanged: true, taxonomyChanged: true },
    },
  } as any)

  assert.deepEqual(result, { status: 'discarded', reason: 'stale_snapshot' })
  assert.equal(refreshes, 0)
})

test('worker 从数据库当前 Note 构造快照并保持单次派生入口', async () => {
  const snapshots: any[] = []
  const updatedAt = new Date('2026-08-28T00:00:01.000Z')
  const worker = new NoteDerivedWorker(
    modelReturning({ _id: 'note-1', userId: 'user-1', title: 'T', content: 'C', summary: 'S', tags: [], updatedAt }) as any,
    { refreshTopicArtifacts: async (snapshot: any) => { snapshots.push(snapshot) } } as any,
    { getJob: async () => ({ data: { expectedUpdatedAt: updatedAt.toISOString() } }) } as any,
    {} as any,
  )
  await worker.process({
    data: {
      noteId: 'note-1', userId: 'user-1', expectedUpdatedAt: updatedAt.toISOString(),
      changes: { titleChanged: false, contentChanged: true, taxonomyChanged: false },
    },
    updateData: async () => undefined,
  } as any)

  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].content, 'C')
  assert.equal(snapshots[0].expectedUpdatedAt.toISOString(), updatedAt.toISOString())
})

test('provider 容量不足时 job 转回 delayed 而不是 busy wait', async () => {
  const updatedAt = new Date('2026-08-28T00:00:01.000Z')
  const delayedAt: number[] = []
  const worker = new NoteDerivedWorker(
    modelReturning({ _id: 'note-1', userId: 'user-1', title: 'T', content: 'C', tags: [], updatedAt }) as any,
    { refreshTopicArtifacts: async () => { throw new AiCapacityDeferredError('siliconflow', 5_000) } } as any,
    { getJob: async () => undefined } as any,
    {} as any,
  )
  await assert.rejects(() => worker.process({
    data: {
      noteId: 'note-1', userId: 'user-1', expectedUpdatedAt: updatedAt.toISOString(),
      changes: { titleChanged: false, contentChanged: true, taxonomyChanged: false },
    },
    moveToDelayed: async (timestamp: number) => { delayedAt.push(timestamp) },
    updateData: async () => undefined,
  } as any, 'worker-token'))

  assert.equal(delayedAt.length, 1)
  assert.ok(delayedAt[0] >= Date.now() + 4_000)
})
