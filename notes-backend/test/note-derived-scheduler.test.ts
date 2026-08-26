import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NoteDerivedScheduler } from '../src/modules/notes/note-derived-scheduler'

test('同一笔记静默期内只执行最后一次派生任务', async () => {
  const scheduler = new NoteDerivedScheduler(10)
  const executed: string[] = []

  scheduler.schedule('note-1', async () => { executed.push('first') })
  scheduler.schedule('note-1', async () => { executed.push('latest') })
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.deepEqual(executed, ['latest'])
})

test('不同笔记的派生任务互不覆盖', async () => {
  const scheduler = new NoteDerivedScheduler(10)
  const executed: string[] = []

  scheduler.schedule('note-1', async () => { executed.push('note-1') })
  scheduler.schedule('note-2', async () => { executed.push('note-2') })
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.deepEqual(executed.sort(), ['note-1', 'note-2'])
})
