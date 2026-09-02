import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NotesService } from '../src/modules/notes/notes.service'

function fakeDeps(chunks: any[], notes: any[]) {
  const noteAccess = {
    readScope: (noteId: string) => ({ _id: noteId }),
    objectId: (v: string) => v,
    readableFilter: () => ({}),
  }
  // findOne 支持任意 filter 字段（含数组 headingPath）；find 支持 select/sort/lean 链。
  const matches = (doc: any, filter: any) => Object.entries(filter).every(([k, v]) => {
    if (Array.isArray(v)) return Array.isArray(doc[k]) && v.length === doc[k].length && v.every((x, i) => String(x) === String(doc[k][i]))
    return String(doc[k]) === String(v)
  })
  // 链形 mock：sort/select/lean 返回自身链对象、exec 解出值（同既有 note-chunk-location-access.test.ts 的 queryResult 惯例）。
  // findOne/find 必须非 async（async 返回 Promise 会断链），直接返回链对象。
  const queryResult = (value: any) => ({ sort: () => queryResult(value), select: () => queryResult(value), lean: () => queryResult(value), exec: async () => value })
  const chunkModel = {
    findOne: (filter: any) => queryResult(chunks.find((c) => matches(c, filter)) ?? null),
    find: (filter: any) => ({
      select: () => ({
        sort: () => ({
          lean: () => ({
            exec: async () => [...chunks].filter((c) => matches(c, filter)).sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0)),
          }),
        }),
      }),
    }),
  }
  const noteModel = {
    findOne: (filter: any) => queryResult(notes.find((n) => matches(n, filter)) ?? null),
  }
  return { noteAccess, chunkModel, noteModel }
}

function newNotesService(deps: ReturnType<typeof fakeDeps>) {
  const { noteAccess, chunkModel, noteModel } = deps
  // 构造器签名：noteModel, categoriesService, tagsService, embeddingService, aiService, noteAccess,
  // noteCounter, noteCache, audit, users, noteRecommendations?, noteDerived?, jwtService?, mindmapModel?, noteChunkModel?
  return new NotesService(
    noteModel as any, {} as any, {} as any, {} as any, {} as any,
    noteAccess as any, {} as any, {} as any, {} as any, {} as any,
    undefined, undefined, undefined, undefined, chunkModel as any,
  )
}

test('命中 Chunk 时返回正文、邻居与 relocated=false', async () => {
  const chunks = [
    { _id: 'c1', noteId: 'n1', chunkIndex: 0, headingPath: ['A'], content: '第一段' },
    { _id: 'c2', noteId: 'n1', chunkIndex: 1, headingPath: ['A'], content: '第二段' },
    { _id: 'c3', noteId: 'n1', chunkIndex: 2, headingPath: ['B'], content: '第三段' },
  ]
  const notes = [{ _id: 'n1', title: '笔记', updatedAt: '2026-09-01T00:00:00.000Z' }]
  const service = newNotesService(fakeDeps(chunks, notes))
  const result = await service.getChunkEvidence('n1', 'c2', 'u1', { before: 1, after: 1 })
  assert.equal(result.chunkId, 'c2')
  assert.equal(result.relocated, false)
  assert.equal(result.content, '第二段')
  assert.deepEqual(result.neighbors.before.map((n: any) => n.chunkId), ['c1'])
  assert.deepEqual(result.neighbors.after.map((n: any) => n.chunkId), ['c3'])
})

test('Chunk 失效时按 headingPath 重定位并标记 relocated', async () => {
  const chunks = [
    { _id: 'c1', noteId: 'n1', chunkIndex: 0, headingPath: ['结论'], content: '最新结论' },
  ]
  const notes = [{ _id: 'n1', title: '笔记', updatedAt: '2026-09-01T00:00:00.000Z' }]
  const service = newNotesService(fakeDeps(chunks, notes))
  // 真实失效场景：citation 里的 chunkId 是合法 ObjectId 但文档已被重新索引删除（非非法字符串）——
  // 用合法 hex 形态的 '0000000000000000000000aa'（不在 seeds）模拟，避免触发 objectId 校验抛错掩盖重定位路径。
  const result = await service.getChunkEvidence('n1', '0000000000000000000000aa', 'u1', { headingPath: ['结论'] })
  assert.equal(result.relocated, true)
  assert.equal(result.chunkId, 'c1')
  assert.equal(result.content, '最新结论')
})
