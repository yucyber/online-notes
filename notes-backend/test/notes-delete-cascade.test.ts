import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { NotesService } from '../src/modules/notes/notes.service'
import { NoteAccessService } from '../src/modules/notes/note-access.service'

function createService(options: { noteExists?: boolean; deletedCount?: number } = {}) {
  const noteId = new Types.ObjectId()
  const userId = new Types.ObjectId()
  const calls: string[] = []
  const session = {
    async withTransaction(work: () => Promise<void>) {
      calls.push('transaction:start')
      await work()
      calls.push('transaction:commit')
    },
    async endSession() { calls.push('session:end') },
  }
  const note = options.noteExists === false ? null : {
    _id: noteId,
    title: 'Note',
    categoryId: undefined,
    tags: [],
  }
  const noteModel = {
    db: { startSession: async () => session },
    findOne: () => ({
      session: () => ({ exec: async () => note }),
    }),
    deleteOne: () => ({
      session: () => ({ exec: async () => {
        calls.push('note:delete')
        return { deletedCount: options.deletedCount ?? 1 }
      } }),
    }),
  }
  const mindmapModel = {
    deleteMany: (query: any) => ({
      session: () => ({ exec: async () => {
        calls.push(`mindmaps:delete:${String(query.noteId)}`)
        return { deletedCount: 2 }
      } }),
    }),
  }
  const chunkModel = {
    deleteMany: (query: any) => ({
      session: () => ({ exec: async () => {
        calls.push(`chunks:delete:${String(query.noteId)}`)
        return { deletedCount: 3 }
      } }),
    }),
  }
  const noop = async () => undefined
  const service = new NotesService(
    noteModel as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    new NoteAccessService(),
    { decrementForDelete: noop } as any,
    { invalidateLists: noop } as any,
    { record: noop } as any,
    {} as any,
    undefined,
    { buildFallbackSummary: () => '', refresh: noop } as any,
    undefined,
    mindmapModel as any,
    chunkModel as any,
  )
  return { service, calls, noteId: String(noteId), userId: String(userId) }
}

test('deleting a note removes linked mindmaps and chunks in the same transaction', async () => {
  const { service, calls, noteId, userId } = createService()

  await service.remove(noteId, userId)

  assert.deepEqual(calls.slice(0, 5), [
    'transaction:start',
    `mindmaps:delete:${noteId}`,
    `chunks:delete:${noteId}`,
    'note:delete',
    'transaction:commit',
  ])
  assert.equal(calls.at(-1), 'session:end')
})

test('missing note does not delete mindmaps or chunks', async () => {
  const { service, calls, noteId, userId } = createService({ noteExists: false })

  await assert.rejects(() => service.remove(noteId, userId), /笔记不存在/)

  assert.equal(calls.some(call => call.startsWith('mindmaps:delete')), false)
  assert.equal(calls.some(call => call.startsWith('chunks:delete')), false)
  assert.equal(calls.at(-1), 'session:end')
})
