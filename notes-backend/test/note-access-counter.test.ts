import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { NoteAccessService } from '../src/modules/notes/note-access.service'
import { NoteCounterService } from '../src/modules/notes/note-counter.service'

test('NoteAccessService.objectId accepts valid object ids', () => {
  const svc = new NoteAccessService()
  const id = new Types.ObjectId()
  assert.equal(String(svc.objectId(String(id), 'note id')), String(id))
})

test('NoteAccessService.objectId rejects invalid ids with BadRequest', () => {
  const svc = new NoteAccessService()
  assert.throws(() => svc.objectId('not-an-objectid', 'note id'), /note id is invalid/)
})

test('NoteAccessService.readScope builds owner/acl/public clauses', () => {
  const svc = new NoteAccessService()
  const noteId = new Types.ObjectId()
  const userId = new Types.ObjectId()
  const query: any = svc.readScope(String(noteId), String(userId))

  assert.equal(String(query._id), String(noteId))
  assert.equal(query.$or.length, 3)
  assert.equal(String(query.$or[0].userId), String(userId))
  assert.equal(String(query.$or[1].acl.$elemMatch.userId), String(userId))
  assert.equal(query.$or[2].visibility, 'public')
})

test('NoteAccessService.writeScope restricts ACL to owner+editor', () => {
  const svc = new NoteAccessService()
  const noteId = new Types.ObjectId()
  const userId = new Types.ObjectId()
  const query: any = svc.writeScope(String(noteId), String(userId))

  assert.deepEqual(query.$or[1].acl.$elemMatch.role.$in, ['owner', 'editor'])
})

test('NoteAccessService.ownerScope restricts ACL to owner only', () => {
  const svc = new NoteAccessService()
  const noteId = new Types.ObjectId()
  const userId = new Types.ObjectId()
  const query: any = svc.ownerScope(String(noteId), String(userId))

  assert.equal(query.$or[1].acl.$elemMatch.role, 'owner')
})

test('NoteCounterService.diffIds computes set differences', () => {
  const svc = new NoteCounterService({} as any, {} as any)
  assert.deepEqual(svc.diffIds(['a', 'b'], ['b', 'c']), { add: ['c'], remove: ['a'] })
})

test('NoteCounterService.diffIds drops falsy ids and de-duplicates', () => {
  const svc = new NoteCounterService({} as any, {} as any)
  const result = svc.diffIds(['a', 'a', '', 'b'], ['a', 'c', 'c', ''])
  assert.deepEqual(result.add.sort(), ['c'])
  assert.deepEqual(result.remove.sort(), ['b'])
})

test('NoteCounterService.incrementForCreate merges single + array categories', async () => {
  const calls: string[] = []
  const categoriesService = {
    incrementNoteCount: async (id: string) => { calls.push(`cat+${id}`) },
    decrementNoteCount: async (id: string) => { calls.push(`cat-${id}`) },
  }
  const tagsService = {
    incrementNoteCount: async (id: string) => { calls.push(`tag+${id}`) },
    decrementNoteCount: async (id: string) => { calls.push(`tag-${id}`) },
  }
  const svc = new NoteCounterService(categoriesService as any, tagsService as any)

  // Same id in both single and array — must NOT double-count.
  await svc.incrementForCreate({ categoryId: 'A', categoryIds: ['A', 'B'], tags: ['t1', 't2'] })

  // Categories should be A and B (deduped), tags t1 and t2.
  assert.deepEqual(calls.sort(), ['cat+A', 'cat+B', 'tag+t1', 'tag+t2'])
})

test('NoteCounterService.updateCategories diffs prev vs next', async () => {
  const calls: string[] = []
  const categoriesService = {
    incrementNoteCount: async (id: string) => { calls.push(`+${id}`) },
    decrementNoteCount: async (id: string) => { calls.push(`-${id}`) },
  }
  const svc = new NoteCounterService(categoriesService as any, {} as any)

  await svc.updateCategories(['A', 'B'], ['B', 'C'])
  assert.deepEqual(calls.sort(), ['+C', '-A'])
})

test('NoteCounterService.updateTags diffs prev vs next', async () => {
  const calls: string[] = []
  const tagsService = {
    incrementNoteCount: async (id: string) => { calls.push(`+${id}`) },
    decrementNoteCount: async (id: string) => { calls.push(`-${id}`) },
  }
  const svc = new NoteCounterService({} as any, tagsService as any)

  await svc.updateTags(['x', 'y'], ['y', 'z'])
  assert.deepEqual(calls.sort(), ['+z', '-x'])
})

test('NoteCounterService.decrementForDelete merges single + array categories', async () => {
  const calls: string[] = []
  const categoriesService = {
    incrementNoteCount: async (id: string) => { calls.push(`cat+${id}`) },
    decrementNoteCount: async (id: string) => { calls.push(`cat-${id}`) },
  }
  const tagsService = {
    incrementNoteCount: async (id: string) => { calls.push(`tag+${id}`) },
    decrementNoteCount: async (id: string) => { calls.push(`tag-${id}`) },
  }
  const svc = new NoteCounterService(categoriesService as any, tagsService as any)

  await svc.decrementForDelete({ categoryId: 'A', categoryIds: ['A', 'B'], tags: ['t1'] })
  assert.deepEqual(calls.sort(), ['cat-A', 'cat-B', 'tag-t1'])
})
