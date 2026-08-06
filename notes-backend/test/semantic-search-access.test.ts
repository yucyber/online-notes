import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { NoteAccessService } from '../src/modules/notes/note-access.service'
import { SemanticService } from '../src/modules/semantic/semantic.service'

function createFindChain(docs: any[]) {
  const chain: any = {
    sort() { return chain },
    skip() { return chain },
    limit() { return chain },
    select() { return chain },
    lean() { return chain },
    exec: async () => docs,
  }
  return chain
}

test('SemanticService.search always ANDs NoteAccess readableFilter', async () => {
  const userId = new Types.ObjectId()
  let capturedQuery: any = null

  const noteModel = {
    find(query: any) {
      capturedQuery = query
      return createFindChain([])
    },
    countDocuments: async (query: any) => {
      capturedQuery = query
      return 0
    },
  }

  const fakeRedis = { get: async () => null, set: async () => 'OK', setnx: async () => 1, expire: async () => 1, del: async () => 1 } as any

  const svc = new SemanticService(
    noteModel as any,
    {} as any,
    {} as any,
    {} as any,
    new NoteAccessService(),
    fakeRedis,
  )

  await svc.search('JWT auth', String(userId), { mode: 'keyword', page: 1, limit: 10 })

  assert.ok(capturedQuery?.$and, 'query must use $and')
  const access = capturedQuery.$and[0]
  assert.equal(access.$or.length, 3)
  assert.equal(String(access.$or[0].userId), String(userId))
  assert.equal(access.$or[2].visibility, 'public')
})

test('SemanticService.search does not omit access scope when category filters present', async () => {
  const userId = new Types.ObjectId()
  let capturedQuery: any = null

  const noteModel = {
    find(query: any) {
      capturedQuery = query
      return createFindChain([{ _id: new Types.ObjectId(), title: 'A', content: 'B', updatedAt: new Date() }])
    },
    countDocuments: async (query: any) => {
      capturedQuery = query
      return 1
    },
  }

  const fakeRedis = { get: async () => null, set: async () => 'OK', setnx: async () => 1, expire: async () => 1, del: async () => 1 } as any

  const svc = new SemanticService(
    noteModel as any,
    {} as any,
    {} as any,
    {} as any,
    new NoteAccessService(),
    fakeRedis,
  )

  const page = await svc.search('测试', String(userId), {
    mode: 'keyword',
    categoryId: 'cat-1',
    page: 1,
    limit: 5,
  })

  assert.equal(page.total, 1)
  assert.ok(capturedQuery.$and.some((clause: any) => clause.categoryId === 'cat-1'))
  assert.ok(capturedQuery.$and.some((clause: any) => Array.isArray(clause.$or) && clause.$or[0]?.userId))
})
