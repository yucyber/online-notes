import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { NoteAccessService } from '../src/modules/notes/note-access.service'
import { SemanticService } from '../src/modules/semantic/semantic.service'

// 回归场景：SemanticService.search 曾经在某些路径上未拼接 ACL 过滤器，
// 导致未授权用户可以通过搜索接口读取他人私有笔记。以下测试固定 readableFilter 必须参与每次查询。
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

test('SemanticService.searchVector applies readable scope and caller pagination/filter options', async () => {
  const userId = new Types.ObjectId()
  let capturedPipeline: any[] = []
  const noteModel = {
    aggregate(pipeline: any[]) {
      capturedPipeline = pipeline
      return { exec: async () => [
        { _id: new Types.ObjectId(), title: 'shared', content: 'body', score: 0.95, updatedAt: new Date() },
        { _id: new Types.ObjectId(), title: 'shared-2', content: 'body', score: 0.9, updatedAt: new Date() },
      ] }
    },
  }
  const noteAccess = {
    readableFilter: (targetUserId: string) => ({ readableFor: targetUserId }),
  }
  const svc = new SemanticService(
    noteModel as any,
    { generateEmbedding: async () => [0.1, 0.2] } as any,
    {} as any,
    {} as any,
    noteAccess as any,
    {} as any,
  )

  const page = await (svc as any).searchVector('shared', String(userId), {
    page: 2,
    limit: 1,
    categoryId: 'category-1',
    tagIds: ['tag-1'],
    tagsMode: 'any',
    threshold: 0.8,
  })

  assert.equal(page.page, 2)
  assert.equal(page.limit, 1)
  assert.equal(page.total, 2)
  assert.equal(page.data.length, 1)
  assert.ok(capturedPipeline.some((stage) => stage.$match?.$and?.some((clause: any) => clause.readableFor === String(userId))))
  const vectorStage = capturedPipeline.find((stage) => stage.$vectorSearch)?.$vectorSearch
  assert.ok(vectorStage.limit > 10)
  assert.ok(capturedPipeline.some((stage) => stage.$match?.$and?.some((clause: any) => clause.categoryId === 'category-1')))
  assert.ok(capturedPipeline.some((stage) => stage.$match?.$and?.some((clause: any) => clause.tags?.$in?.includes('tag-1'))))
})
