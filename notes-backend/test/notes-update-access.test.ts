import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NotesService } from '../src/modules/notes/notes.service'

const noteId = '507f1f77bcf86cd799439011'
const userId = '507f1f77bcf86cd799439012'

function execResult<T>(value: T) {
  return { exec: async () => value }
}

function updateChain<T>(value: T) {
  const chain: any = {
    populate: () => chain,
    exec: async () => value,
  }
  return chain
}

function createService(noteModel: any, noteAccess: any, overrides: Record<string, any> = {}) {
  return new NotesService(
    noteModel,
    overrides.categoriesService || {} as any,
    overrides.tagsService || {} as any,
    overrides.embeddingService || { generateEmbedding: async () => [] },
    overrides.aiService || { generateSummary: async () => '' },
    noteAccess,
    overrides.noteCounter || { updateCategories: async () => undefined, updateTags: async () => undefined },
    overrides.noteCache || {} as any,
    overrides.noteRecommendations,
  )
}

test('NotesService.update uses the same access scope for read and atomic write', async () => {
  const scope = { _id: noteId, permission: 'write' }
  const calls: any[] = []
  const original = { _id: noteId, title: 'old', content: 'body', tags: [], categoryIds: [] }
  const updated = { ...original, title: 'new' }
  const noteModel = {
    findOne: (query: any) => {
      calls.push({ type: 'findOne', query })
      return execResult(original)
    },
    findOneAndUpdate: (query: any) => {
      calls.push({ type: 'findOneAndUpdate', query })
      return updateChain(updated)
    },
  }
  const noteAccess = {
    writeScope: () => scope,
    ownerScope: () => ({ ...scope, permission: 'owner' }),
  }
  const service = createService(noteModel, noteAccess)

  await service.update(noteId, { title: 'new' }, userId)

  assert.deepEqual(calls[0].query, scope)
  assert.deepEqual(calls[1].query, scope)
})

test('NotesService.update rejects editor visibility changes before writing', async () => {
  const original = { _id: noteId, title: 'old', content: 'body', tags: [], categoryIds: [] }
  let updateCalls = 0
  const noteModel = {
    findOne: (query: any) => execResult(query.permission === 'owner' ? null : original),
    findOneAndUpdate: () => {
      updateCalls++
      return updateChain(original)
    },
  }
  const noteAccess = {
    writeScope: () => ({ _id: noteId, permission: 'write' }),
    ownerScope: () => ({ _id: noteId, permission: 'owner' }),
  }
  const service = createService(noteModel, noteAccess)

  await assert.rejects(
    () => service.update(noteId, { visibility: 'public' as any }, userId),
    (error: any) => error?.name === 'NotFoundException',
  )
  assert.equal(updateCalls, 0)
})

test('NotesService.update refreshes summary when content is cleared', async () => {
  let payload: any
  const original = { _id: noteId, title: 'old', content: 'body', tags: [], categoryIds: [] }
  const noteModel = {
    findOne: () => execResult(original),
    findOneAndUpdate: (_query: any, nextPayload: any) => {
      payload = nextPayload
      return updateChain({ ...original, ...nextPayload })
    },
    updateOne: () => execResult({}),
  }
  const service = createService(noteModel, {
    writeScope: () => ({ _id: noteId, permission: 'write' }),
    ownerScope: () => ({ _id: noteId, permission: 'owner' }),
  })

  await service.update(noteId, { content: '' }, userId)

  assert.equal(payload.summary, '')
})
