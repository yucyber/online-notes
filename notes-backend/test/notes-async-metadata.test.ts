import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NotesService } from '../src/modules/notes/notes.service'

function createService(calls: any[], overrides: { embedding?: number[]; summary?: string } = {}) {
  const noteModel = {
    updateOne: (...args: any[]) => {
      calls.push(args)
      return { exec: async () => ({ acknowledged: true }) }
    },
  }
  return new NotesService(
    noteModel as any,
    {} as any,
    {} as any,
    { generateEmbedding: async () => overrides.embedding ?? [0.1, 0.2] } as any,
    { generateSummary: async () => overrides.summary ?? 'AI summary' } as any,
    {} as any,
    {} as any,
    {} as any,
  )
}

test('async embedding update does not bump note updatedAt', async () => {
  const calls: any[] = []
  const service = createService(calls)

  await (service as any).updateEmbedding({ _id: 'note-1', title: 'Title', content: 'Body' })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0][2], { timestamps: false })
})

test('async AI summary update does not bump note updatedAt', async () => {
  const calls: any[] = []
  const service = createService(calls)

  ;(service as any).generateAndSaveSummary({ _id: 'note-1', content: 'Body' })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0][2], { timestamps: false })
})
