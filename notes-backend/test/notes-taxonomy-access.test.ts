import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { NotesService } from '../src/modules/notes/notes.service'

const userId = '507f1f77bcf86cd799439012'
const ownCategoryId = '507f1f77bcf86cd799439013'
const ownTagId = '507f1f77bcf86cd799439015'
const foreignTagId = '507f1f77bcf86cd799439016'
const foreignCategoryId = '507f1f77bcf86cd799439017'

class FakeNoteModel {
  static savedPayloads: any[] = []
  _id = new Types.ObjectId()

  constructor(payload: any) {
    Object.assign(this, payload)
  }

  async save() {
    FakeNoteModel.savedPayloads.push(this)
    return this
  }
}

function execResult<T>(value: T) {
  return { exec: async () => value }
}

function updateChain<T>(value: T) {
  const chain: any = { populate: () => chain, exec: async () => value }
  return chain
}

function createService(noteModel: any, categoriesService: any, tagsService: any) {
  return new NotesService(
    noteModel,
    categoriesService,
    tagsService,
    { generateEmbedding: async () => [] } as any,
    { generateSummary: async () => '' } as any,
    { writeScope: () => ({ _id: new Types.ObjectId(), permission: 'write' }) } as any,
    { incrementForCreate: async () => undefined, updateCategories: async () => undefined, updateTags: async () => undefined } as any,
    { invalidateLists: async () => undefined } as any,
    { record: async () => undefined } as any,
    { findById: async () => null } as any,
  )
}

test('NotesService.create validates category and tag ownership before saving', async () => {
  FakeNoteModel.savedPayloads = []
  const categoryCalls: any[] = []
  const tagCalls: any[] = []
  const categoriesService = {
    assertOwnedIds: async (ids: string[], ownerId: string) => categoryCalls.push({ ids, ownerId }),
  }
  const tagsService = {
    assertOwnedIds: async (ids: string[], ownerId: string) => tagCalls.push({ ids, ownerId }),
  }
  const service = createService(FakeNoteModel, categoriesService, tagsService)

  await service.create({
    title: 'note',
    content: 'body',
    categoryId: ownCategoryId,
    tags: [ownTagId],
  }, userId)

  assert.deepEqual(categoryCalls, [{ ids: [ownCategoryId], ownerId: userId }])
  assert.deepEqual(tagCalls, [{ ids: [ownTagId], ownerId: userId }])
  assert.equal(FakeNoteModel.savedPayloads.length, 1)
})

test('NotesService.create rejects a foreign taxonomy reference before side effects', async () => {
  FakeNoteModel.savedPayloads = []
  const service = createService(
    FakeNoteModel,
    { assertOwnedIds: async () => { throw new Error('category does not belong to user') } },
    { assertOwnedIds: async () => undefined },
  )

  await assert.rejects(() => service.create({ title: 'note', content: 'body', categoryId: foreignCategoryId, tags: [ownTagId] }, userId), /does not belong/)
  assert.equal(FakeNoteModel.savedPayloads.length, 0)
})

test('NotesService.update validates only taxonomy fields supplied by the caller', async () => {
  const calls: any[] = []
  const original = { _id: new Types.ObjectId(), title: 'old', content: 'body', tags: [] }
  const noteModel = {
    findOne: () => execResult(original),
    findOneAndUpdate: () => updateChain({ ...original, tags: [new Types.ObjectId(ownTagId)] }),
  }
  const service = createService(
    noteModel,
    { assertOwnedIds: async (ids: string[], ownerId: string) => calls.push({ kind: 'category', ids, ownerId }) },
    { assertOwnedIds: async (ids: string[], ownerId: string) => {
      calls.push({ kind: 'tag', ids, ownerId })
      if (ids.includes(foreignTagId)) throw new Error('foreign tag does not belong to user')
    } },
  )

  await assert.rejects(
    () => service.update(String(original._id), { tags: [foreignTagId] }, userId),
    /foreign|does not belong|not found/i,
  )
  assert.deepEqual(calls, [{ kind: 'tag', ids: [foreignTagId], ownerId: userId }])
})
