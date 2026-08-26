import { test } from 'node:test'
import assert = require('node:assert/strict')
import { ObjectId } from 'mongodb'
import { CUTOFF, cleanupPreJuly2026 } from '../scripts/cleanup-pre-july-2026'

function matches(row: any, filter: any): boolean {
  if (filter.$or) return filter.$or.some((item: any) => matches(row, item))
  return Object.entries(filter).every(([key, condition]: [string, any]) => {
    const value = key.split('.').reduce((current, part) => current?.[part], row)
    if (condition?.$lt) return value < condition.$lt
    if (condition?.$in) return condition.$in.some((target: any) => String(target) === String(value))
    return String(value) === String(condition)
  })
}

function fakeDb(seed: Record<string, any[]>) {
  const rows = Object.fromEntries(Object.entries(seed).map(([name, values]) => [name, [...values]]))
  let deleteCalls = 0
  return {
    rows,
    get deleteCalls() { return deleteCalls },
    listCollections: () => ({ toArray: async () => Object.keys(rows).map(name => ({ name })) }),
    collection: (name: string) => ({
      find: (filter: any) => ({
        project: () => ({ toArray: async () => rows[name].filter(row => matches(row, filter)).map(row => ({ _id: row._id })) }),
      }),
      countDocuments: async (filter: any) => rows[name].filter(row => matches(row, filter)).length,
      deleteMany: async (filter: any) => {
        deleteCalls += 1
        const before = rows[name].length
        rows[name] = rows[name].filter(row => !matches(row, filter))
        return { deletedCount: before - rows[name].length }
      },
    }),
  }
}

test('cleanup defaults to dry-run and uses the fixed July cutoff', async () => {
  const oldUser = new ObjectId()
  const db = fakeDb({
    users: [{ _id: oldUser, createdAt: new Date('2026-06-01T00:00:00Z') }],
    notes: [],
  })

  const result = await cleanupPreJuly2026(db as any, false)

  assert.equal(CUTOFF.toISOString(), '2026-06-30T16:00:00.000Z')
  assert.equal(result.execute, false)
  assert.equal(result.collections.users.matched, 1)
  assert.equal(db.deleteCalls, 0)
})

test('execute deletes old records and newer dependencies of old users and notes', async () => {
  const oldUser = new ObjectId()
  const oldNote = new ObjectId()
  const newNoteOwnedByOldUser = new ObjectId()
  const currentUser = new ObjectId()
  const db = fakeDb({
    users: [
      { _id: oldUser, createdAt: new Date('2026-06-01T00:00:00Z') },
      { _id: currentUser, createdAt: new Date('2026-08-01T00:00:00Z') },
    ],
    notes: [
      { _id: oldNote, userId: currentUser, createdAt: new Date('2026-06-02T00:00:00Z') },
      { _id: newNoteOwnedByOldUser, userId: oldUser, createdAt: new Date('2026-08-02T00:00:00Z') },
    ],
    mindmaps: [
      { _id: new ObjectId(), noteId: newNoteOwnedByOldUser, userId: currentUser, createdAt: new Date('2026-08-03T00:00:00Z') },
    ],
  })

  const result = await cleanupPreJuly2026(db as any, true)

  assert.equal(result.collections.users.deleted, 1)
  assert.equal(result.collections.notes.deleted, 2)
  assert.equal(result.collections.mindmaps.deleted, 1)
  assert.equal(db.rows.users.length, 1)
  assert.equal(db.rows.notes.length, 0)
  assert.equal(db.rows.mindmaps.length, 0)
})
