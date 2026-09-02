import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NotFoundException } from '@nestjs/common'
import { NotesService } from '../src/modules/notes/notes.service'
import { NotesController } from '../src/modules/notes/notes.controller'

function fakeDeps(chunks: any[], notes: any[], options: { readable?: boolean } = {}) {
  const noteAccess = {
    readScope: (noteId: string) => ({ _id: noteId }),
    objectId: (v: string) => v,
    readableFilter: () => ({}),
  }
  const calls = { noteFindOne: 0, chunkFindOne: 0, chunkFind: 0 }
  // findOne 支持任意 filter 字段（含数组 headingPath）；find 支持 select/sort/lean 链。
  const matches = (doc: any, filter: any) => Object.entries(filter).every(([k, v]) => {
    if (Array.isArray(v)) return Array.isArray(doc[k]) && v.length === doc[k].length && v.every((x, i) => String(x) === String(doc[k][i]))
    return String(doc[k]) === String(v)
  })
  // 链形 mock：sort/select/lean 返回自身链对象、exec 解出值（同既有 note-chunk-location-access.test.ts 的 queryResult 惯例）。
  // findOne/find 必须非 async（async 返回 Promise 会断链），直接返回链对象。
  const queryResult = (value: any) => ({ sort: () => queryResult(value), select: () => queryResult(value), lean: () => queryResult(value), exec: async () => value })
  // findOne 记录 sort 并在 exec 时按 sort 挑第一条——供重定位"取最新 chunkIndex"语义在内存模型中表达。
  const chunkModel = {
    findOne: (filter: any) => {
      calls.chunkFindOne++
      let sortSpec: Record<string, number> | null = null
      const chain: any = {
        sort: (spec: Record<string, number>) => { sortSpec = spec; return chain },
        select: () => chain,
        lean: () => chain,
        exec: async () => {
          const matched = chunks.filter((c) => matches(c, filter))
          if (matched.length === 0) return null
          if (sortSpec) {
            matched.sort((a, b) => {
              for (const key of Object.keys(sortSpec)) {
                if (a[key] === b[key]) continue
                const order = (a[key] ?? -Infinity) > (b[key] ?? -Infinity) ? 1 : -1
                return sortSpec[key] > 0 ? order : -order
              }
              return 0
            })
          }
          return matched[0]
        },
      }
      return chain
    },
    find: (filter: any) => {
      calls.chunkFind++
      return {
        select: () => ({
          sort: () => ({
            lean: () => ({
              exec: async () => [...chunks].filter((c) => matches(c, filter)).sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0)),
            }),
          }),
        }),
      }
    },
  }
  // 可读性由 options.readable 控制：false 时 Note 查询恒返回空（对照 location 测试的 readable 桩）。
  const noteModel = {
    findOne: (filter: any) => {
      calls.noteFindOne++
      const found = options.readable === false ? null : (notes.find((n) => matches(n, filter)) ?? null)
      return queryResult(found)
    },
  }
  return { noteAccess, chunkModel, noteModel, calls }
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

const NOT_READABLE_MSG = (err: any) => err instanceof NotFoundException && err.message === '笔记不存在'
const NO_CHUNK_MSG = (err: any) => err instanceof NotFoundException && err.message === '证据位置不存在'
const NO_MODEL_MSG = (err: any) => err instanceof NotFoundException && err.message === '证据不可用'

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

test('before/after 为 NaN 时回落默认 1，不绕过 0-3 clamp', async () => {
  // ?before=abc → Number('abc')=NaN；直接经 Math.max/min 仍 NaN 会让 slice(NaN→0, index)
  // 返回目标前全部邻居（绕过 clamp），after 侧则反向取空——断言 NaN 与默认 1 同语义。
  const chunks = [
    { _id: 'c0', noteId: 'n1', chunkIndex: 0, headingPath: ['A'], content: 'p0' },
    { _id: 'c1', noteId: 'n1', chunkIndex: 1, headingPath: ['A'], content: 'p1' },
    { _id: 'c2', noteId: 'n1', chunkIndex: 2, headingPath: ['B'], content: 'p2' },
    { _id: 'c3', noteId: 'n1', chunkIndex: 3, headingPath: ['B'], content: 'p3' },
    { _id: 'c4', noteId: 'n1', chunkIndex: 4, headingPath: ['B'], content: 'p4' },
  ]
  const notes = [{ _id: 'n1', title: '笔记', updatedAt: '2026-09-01T00:00:00.000Z' }]
  const service = newNotesService(fakeDeps(chunks, notes))
  const result = await service.getChunkEvidence('n1', 'c2', 'u1', { before: Number('abc'), after: Number('abc') })
  assert.deepEqual(result.neighbors.before.map((n: any) => n.chunkId), ['c1'])
  assert.deepEqual(result.neighbors.after.map((n: any) => n.chunkId), ['c3'])
})

test('笔记不可读时抛"笔记不存在"且不查询 Chunk', async () => {
  const chunks = [
    { _id: 'c1', noteId: 'n1', chunkIndex: 0, headingPath: [], content: '正文' },
  ]
  const notes = [{ _id: 'n1', title: '笔记', updatedAt: '2026-09-01T00:00:00.000Z' }]
  const deps = fakeDeps(chunks, notes, { readable: false })
  const service = newNotesService(deps)
  await assert.rejects(
    () => service.getChunkEvidence('n1', 'c1', 'u1'),
    NOT_READABLE_MSG,
  )
  assert.equal(deps.calls.noteFindOne, 1)
  assert.equal(deps.calls.chunkFindOne, 0, '不可读时不得查询 Chunk')
  assert.equal(deps.calls.chunkFind, 0)
})

test('Chunk 未命中且无 headingPath 时抛"证据位置不存在"', async () => {
  const notes = [{ _id: 'n1', title: '笔记', updatedAt: '2026-09-01T00:00:00.000Z' }]
  const deps = fakeDeps([], notes)
  const service = newNotesService(deps)
  await assert.rejects(
    () => service.getChunkEvidence('n1', 'c-missing', 'u1', { before: 1 }),
    NO_CHUNK_MSG,
  )
  assert.equal(deps.calls.chunkFindOne, 1, '仅做一次精确命中查询')
  assert.equal(deps.calls.chunkFind, 0, '未命中时不得枚举邻居')
})

test('重定位仍无命中时抛"证据位置不存在"', async () => {
  const chunks = [
    { _id: 'c1', noteId: 'n1', chunkIndex: 0, headingPath: ['其他'], content: '不同小节' },
  ]
  const notes = [{ _id: 'n1', title: '笔记', updatedAt: '2026-09-01T00:00:00.000Z' }]
  const deps = fakeDeps(chunks, notes)
  const service = newNotesService(deps)
  await assert.rejects(
    () => service.getChunkEvidence('n1', '0000000000000000000000aa', 'u1', { headingPath: ['结论'] }),
    NO_CHUNK_MSG,
  )
  assert.equal(deps.calls.chunkFindOne, 2, '精确命中失败后尝试重定位')
  assert.equal(deps.calls.chunkFind, 0)
})

test('noteChunkModel 缺失时抛"证据不可用"', async () => {
  const notes = [{ _id: 'n1', title: '笔记', updatedAt: '2026-09-01T00:00:00.000Z' }]
  const deps = fakeDeps([], notes)
  const service = newNotesService({ ...deps, chunkModel: undefined as any })
  await assert.rejects(
    () => service.getChunkEvidence('n1', 'c1', 'u1'),
    NO_MODEL_MSG,
  )
  assert.equal(deps.calls.chunkFindOne, 0)
})

test('首块与末块邻居缺边为空', async () => {
  const chunks = [
    { _id: 'c0', noteId: 'n1', chunkIndex: 0, headingPath: ['A'], content: 'a' },
    { _id: 'c1', noteId: 'n1', chunkIndex: 1, headingPath: ['A'], content: 'b' },
    { _id: 'c2', noteId: 'n1', chunkIndex: 2, headingPath: ['B'], content: 'c' },
  ]
  const notes = [{ _id: 'n1', title: '笔记', updatedAt: '2026-09-01T00:00:00.000Z' }]
  const service = newNotesService(fakeDeps(chunks, notes))
  const first = await service.getChunkEvidence('n1', 'c0', 'u1', { before: 1, after: 1 })
  assert.deepEqual(first.neighbors.before, [])
  assert.deepEqual(first.neighbors.after.map((n: any) => n.chunkId), ['c1'])
  const last = await service.getChunkEvidence('n1', 'c2', 'u1', { before: 1, after: 1 })
  assert.deepEqual(last.neighbors.before.map((n: any) => n.chunkId), ['c1'])
  assert.deepEqual(last.neighbors.after, [])
})

test('before/after 为 0 时无邻居，超 3 时 clamp 到 3', async () => {
  const chunks = Array.from({ length: 9 }, (_, i) => ({
    _id: `c${i}`, noteId: 'n1', chunkIndex: i, headingPath: ['H'], content: `p${i}`,
  }))
  const notes = [{ _id: 'n1', title: '笔记', updatedAt: '2026-09-01T00:00:00.000Z' }]
  const service = newNotesService(fakeDeps(chunks, notes))
  const none = await service.getChunkEvidence('n1', 'c4', 'u1', { before: 0, after: 0 })
  assert.deepEqual(none.neighbors.before, [])
  assert.deepEqual(none.neighbors.after, [])
  // c4 两侧各有 4 条，若 clamp 失效会返回 4 条；期望各 3 条。
  const clamped = await service.getChunkEvidence('n1', 'c4', 'u1', { before: 5, after: 5 })
  assert.deepEqual(clamped.neighbors.before.map((n: any) => n.chunkId), ['c1', 'c2', 'c3'])
  assert.deepEqual(clamped.neighbors.after.map((n: any) => n.chunkId), ['c5', 'c6', 'c7'])
})

test('邻居 excerpt 空白归一并截断 200 字符', async () => {
  const chunks = [
    { _id: 'c0', noteId: 'n1', chunkIndex: 0, headingPath: ['A'], content: '  第一行\n\n   第二行\t ' },
    { _id: 'c1', noteId: 'n1', chunkIndex: 1, headingPath: ['A'], content: '目标' },
    { _id: 'c2', noteId: 'n1', chunkIndex: 2, headingPath: ['B'], content: 'x'.repeat(250) },
  ]
  const notes = [{ _id: 'n1', title: '笔记', updatedAt: '2026-09-01T00:00:00.000Z' }]
  const service = newNotesService(fakeDeps(chunks, notes))
  const result = await service.getChunkEvidence('n1', 'c1', 'u1', { before: 1, after: 1 })
  assert.equal(result.neighbors.before[0].excerpt, '第一行 第二行')
  assert.equal(result.neighbors.after[0].excerpt, 'x'.repeat(200))
})

test('重定位在同 headingPath 多条 Chunk 中取最新 chunkIndex', async () => {
  const chunks = [
    { _id: 'c1', noteId: 'n1', chunkIndex: 0, headingPath: ['结论'], content: '旧版' },
    { _id: 'c2', noteId: 'n1', chunkIndex: 1, headingPath: ['结论'], content: '中间版' },
    { _id: 'c3', noteId: 'n1', chunkIndex: 2, headingPath: ['结论'], content: '最新版' },
  ]
  const notes = [{ _id: 'n1', title: '笔记', updatedAt: '2026-09-01T00:00:00.000Z' }]
  const service = newNotesService(fakeDeps(chunks, notes))
  const result = await service.getChunkEvidence('n1', '0000000000000000000000aa', 'u1', { headingPath: ['结论'] })
  assert.equal(result.relocated, true)
  assert.equal(result.chunkId, 'c3')
  assert.equal(result.content, '最新版')
})

test('chunkEvidence 端点把 before/after 转 Number 并按 > 拆分 headingPath', async () => {
  const received: any[] = []
  const service = {
    getChunkEvidence: async (...args: any[]) => { received.push(args); return { echo: true } },
  }
  const controller = new NotesController(service as any)
  const result = await controller.chunkEvidence(
    'n1', 'c2', { user: { id: 'u1' } } as any,
    '2', '0', 'Root > Child > 子节 ',
  )
  assert.deepEqual(result, { echo: true }, 'controller 透传 service 返回值')
  assert.deepEqual(received[0], [
    'n1', 'c2', 'u1',
    { before: 2, after: 0, headingPath: ['Root', 'Child', '子节'] },
  ])
})

test('chunkEvidence 端点无查询参数时 opts 为空对象', async () => {
  const received: any[] = []
  const service = {
    getChunkEvidence: async (...args: any[]) => { received.push(args); return {} },
  }
  const controller = new NotesController(service as any)
  await controller.chunkEvidence('n1', 'c2', { user: { id: 'u1' } } as any)
  assert.deepEqual(received[0], ['n1', 'c2', 'u1', {}])
})
