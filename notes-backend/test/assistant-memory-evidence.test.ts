import { test } from 'node:test'
import assert = require('node:assert/strict')
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { MemoryService } from '../src/modules/assistant/assistant-memory.service'
import { AssistantController } from '../src/modules/assistant/assistant.controller'
import { AssistantGenerationService } from '../src/modules/assistant/assistant-generation.service'
import { AssistantContextService } from '../src/modules/assistant/assistant-context.service'
import { MemoryRecallServiceLike } from '../src/modules/assistant/assistant.constants'

// 内存 Mongoose 模型：与真实 Query 同形（find/findOne/findOneAndUpdate/updateOne/deleteOne 返回可链式
// sort/limit/select/lean/exec 的对象，exec 惰性求值读取当前 docs），使服务按真实链式 API 编程、测试全内存直跑。
function getPath(obj: any, path: string): any {
  return path.split('.').reduce((o, key) => (o == null ? undefined : o[key]), obj)
}

function matchesFilter(doc: any, filter: any): boolean {
  return Object.entries(filter).every(([key, value]: [string, any]) => {
    const actual = getPath(doc, key)
    if (value && typeof value === 'object' && '$in' in value) {
      return value.$in.some((item: any) => String(item) === String(actual))
    }
    if (value && typeof value === 'object' && '$ne' in value) {
      return String(actual) !== String(value.$ne)
    }
    return String(actual) === String(value)
  })
}

class QueryChain {
  private readonly rows: () => any
  private spec: any = null
  private limitN: number | null = null
  constructor(rows: () => any) { this.rows = rows }
  sort(spec: any) { this.spec = spec ?? this.spec; return this }
  limit(n: number) { this.limitN = n; return this }
  select() { return this }
  lean() { return this }
  exec() {
    let list = this.rows()
    if (this.spec) {
      const [key, dir] = Object.entries(this.spec)[0] as [string, number]
      const sign = Number(dir) >= 0 ? 1 : -1
      list = [...list].sort((a: any, b: any) => {
        const av = String(getPath(a, key) ?? '')
        const bv = String(getPath(b, key) ?? '')
        return av < bv ? -sign : av > bv ? sign : 0
      })
    }
    if (this.limitN != null) list = list.slice(0, this.limitN)
    return Promise.resolve(list)
  }
}

function cloneSeed(docs: any[]) {
  return docs.map((d) => ({ ...d, scope: d.scope ? { ...d.scope } : d.scope }))
}

function applyUpdate(doc: any, update: any) {
  if (update?.$set) Object.assign(doc, update.$set)
  if (update?.$unset) for (const key of Object.keys(update.$unset)) delete doc[key]
  return doc
}

function makeModel(seed: any[] = []) {
  const docs = cloneSeed(seed)
  return {
    docs,
    find(filter: any) { return new QueryChain(() => docs.filter((d) => matchesFilter(d, filter))) },
    findOne(filter: any) { return new QueryChain(() => docs.find((d) => matchesFilter(d, filter)) ?? null) },
    findOneAndUpdate(filter: any, update: any, _opts?: any) {
      return new QueryChain(() => {
        const doc = docs.find((d) => matchesFilter(d, filter))
        if (doc) applyUpdate(doc, update)
        return doc ?? null
      })
    },
    updateOne(filter: any, update: any) {
      return new QueryChain(() => {
        const idx = docs.findIndex((d) => matchesFilter(d, filter))
        if (idx >= 0) applyUpdate(docs[idx], update)
        return { matchedCount: idx >= 0 ? 1 : 0 }
      })
    },
    deleteOne(filter: any) {
      return new QueryChain(() => {
        const idx = docs.findIndex((d) => matchesFilter(d, filter))
        if (idx >= 0) docs.splice(idx, 1)
        return { deletedCount: idx >= 0 ? 1 : 0 }
      })
    },
    async create(data: any) {
      const doc = { _id: `mem-${docs.length + 1}`, ...cloneSeed([data])[0] }
      docs.push(doc)
      return doc
    },
  }
}

type ModelLike = ReturnType<typeof makeModel>

// MemoryService 真实构造器为 (memoryModel, candidateModel?, chunkModel?)：候选模型在第 2 参
// （T4 已提交的 conflict 测试以该顺序直构），chunkModel 只能在末尾追加，不复用计划骨架的 (memory, chunk, candidate) 顺序。
function newService(memories: ModelLike, candidates?: ModelLike, chunkModel?: ModelLike) {
  return new MemoryService(memories as any, (candidates ?? makeModel()) as any, chunkModel as any)
}

function memoryDoc(overrides: any = {}) {
  return {
    _id: 'm1', userId: 'u1', conversationId: 'conv1', kind: 'decision', subject: '布局',
    statement: '保留浮层', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok',
    evidence: [], confidence: 0.9, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function chunkDoc(overrides: any = {}) {
  return { _id: 'c1', noteId: 'n1', content: 'x', ...overrides }
}

// ---- refreshEvidence：note_chunk 证据逐一校验 chunk 是否仍存在 ----

test('note_chunk 证据缺失时标记 stale 并生成复核候选', async () => {
  const memories = makeModel([
    memoryDoc({ _id: 'm1', statement: '保留浮层', confidence: 0.9, evidence: [{ type: 'note_chunk', noteId: 'n1', chunkId: 'c1', excerpt: 'x' }] }),
  ])
  const candidates = makeModel([])
  const chunks = makeModel([])
  const service = newService(memories, candidates, chunks)
  const result = await service.refreshEvidence('u1', 'm1')
  assert.deepEqual(result, { evidenceStatus: 'stale', reviewCreated: true })
  assert.equal(memories.docs[0].evidenceStatus, 'stale', '缺失证据的记忆应落库置 stale')
  assert.equal(candidates.docs.length, 1)
  const review = candidates.docs[0]
  assert.equal(review.kind, 'hypothesis')
  assert.equal(review.subject, '布局')
  assert.equal(review.statement, '复核认知：保留浮层（原证据可能已变化）')
  assert.ok(Math.abs(review.confidence - 0.72) < 1e-9, '复核候选置信度应为原值 ×0.8')
  assert.deepEqual(review.scope, { type: 'global' })
  assert.equal(review.evidenceKey, 'review-m1', '复核候选用 review-<memoryId> 去重锚点')
  assert.equal(review.conversationId, 'conv1')
  assert.deepEqual(review.evidence, [{ type: 'message', messageId: 'm1', excerpt: '保留浮层' }])
})

test('note_chunk 证据存在时保持 ok 且不生成复核候选', async () => {
  const memories = makeModel([
    memoryDoc({ _id: 'm1', evidence: [{ type: 'note_chunk', noteId: 'n1', chunkId: 'c1', excerpt: 'x' }] }),
  ])
  const candidates = makeModel([])
  const chunks = makeModel([chunkDoc({ _id: 'c1', noteId: 'n1' })])
  const service = newService(memories, candidates, chunks)
  const result = await service.refreshEvidence('u1', 'm1')
  assert.deepEqual(result, { evidenceStatus: 'ok', reviewCreated: false })
  assert.equal(memories.docs[0].evidenceStatus, 'ok')
  assert.equal(candidates.docs.length, 0)
})

test('message 类型证据无法校验时保持现状', async () => {
  const memories = makeModel([
    memoryDoc({ _id: 'm1', evidence: [{ type: 'message', messageId: 'msg1', excerpt: 'y' }] }),
  ])
  const candidates = makeModel([])
  const chunks = makeModel([chunkDoc({ _id: 'c1', noteId: 'n1' })])
  const service = newService(memories, candidates, chunks)
  const result = await service.refreshEvidence('u1', 'm1')
  assert.deepEqual(result, { evidenceStatus: 'ok', reviewCreated: false })
  assert.equal(candidates.docs.length, 0, 'message 证据不触发复核候选')
})

test('chunkModel 未注入（DI 未注册 NoteChunk）时短路返回现状不报错', async () => {
  const memories = makeModel([
    memoryDoc({ _id: 'm1', evidence: [{ type: 'note_chunk', noteId: 'n1', chunkId: 'c1', excerpt: 'x' }] }),
  ])
  const service = newService(memories, makeModel([]))
  const result = await service.refreshEvidence('u1', 'm1')
  assert.deepEqual(result, { evidenceStatus: 'ok', reviewCreated: false })
})

test('已 stale 的记忆复核不重复生成复核候选（幂等）', async () => {
  const memories = makeModel([
    memoryDoc({ _id: 'm1', evidenceStatus: 'stale', evidence: [{ type: 'note_chunk', noteId: 'n1', chunkId: 'c1', excerpt: 'x' }] }),
  ])
  const candidates = makeModel([])
  const service = newService(memories, candidates, makeModel([]))
  const result = await service.refreshEvidence('u1', 'm1')
  assert.deepEqual(result, { evidenceStatus: 'stale', reviewCreated: false })
  assert.equal(candidates.docs.length, 0, '已 stale 不重复生成复核候选')
})

test('refreshEvidence 记忆不存在时抛 not found', async () => {
  const service = newService(makeModel([]), makeModel([]), makeModel([]))
  await assert.rejects(
    () => service.refreshEvidence('u1', 'missing'),
    (error: any) => error instanceof NotFoundException && /memory not found/i.test(String(error.message)),
  )
})

// ---- exportJsonl：JSONL 行含确认与已替代记忆及证据 ----

test('exportJsonl 输出全部记忆（含 superseded）且按 createdAt 升序', async () => {
  const memories = makeModel([
    memoryDoc({
      _id: 'm2', subject: '布局', statement: '改用新方案', status: 'confirmed', evidenceStatus: 'ok',
      evidence: [{ type: 'note_chunk', noteId: 'n1', chunkId: 'c1', excerpt: 'x' }],
      // 生产 lean 文档里时间字段是 Date 实例：导出须归一化为 ISO 8601（String(Date) 会输出本地化串）。
      createdAt: '2026-09-02T00:00:00.000Z',
      validFrom: new Date('2026-09-02T00:00:00.000Z'), confirmedAt: new Date('2026-09-02T08:00:00.000Z'),
    }),
    memoryDoc({
      _id: 'm1', subject: '布局', statement: '旧方案', status: 'superseded', evidenceStatus: 'stale', supersededById: 'm2',
      evidence: [], createdAt: '2026-09-01T00:00:00.000Z', validFrom: '2026-09-01T00:00:00.000Z',
      validTo: new Date('2026-09-02T00:00:00.000Z'), confirmedAt: new Date('2026-09-01T00:00:00.000Z'),
    }),
  ])
  const service = newService(memories)
  const jsonl = await service.exportJsonl('u1')
  const lines = jsonl.split('\n')
  assert.equal(lines.length, 2, 'superseded 节点也应导出')
  const rows = lines.map((line) => JSON.parse(line))
  assert.deepEqual(rows.map((r) => r.id), ['m1', 'm2'], '按 createdAt 升序')
  assert.equal(rows[0].status, 'superseded')
  assert.equal(rows[0].evidenceStatus, 'stale')
  assert.equal(rows[0].validTo, '2026-09-02T00:00:00.000Z', 'Date 实例导出为 ISO 8601（UTC）')
  assert.equal(rows[1].validFrom, '2026-09-02T00:00:00.000Z', 'validFrom Date 归一化为 ISO 8601')
  assert.equal(rows[1].confirmedAt, '2026-09-02T08:00:00.000Z', 'confirmedAt 携带偏移的 Date 归一化为 UTC ISO 8601')
  assert.deepEqual(Object.keys(rows[1]).sort(), ['confirmedAt', 'evidence', 'evidenceStatus', 'id', 'kind', 'scope', 'statement', 'status', 'subject', 'validFrom'])
  assert.equal(rows[1].evidence[0].chunkId, 'c1')
})

test('exportJsonl 无记忆时返回空串', async () => {
  const service = newService(makeModel([]))
  assert.equal(await service.exportJsonl('u1'), '')
})

// ---- controller 端点 ----

function controllerWith(memories: any) {
  return new AssistantController({} as any, {} as any, {} as any, {} as any, {} as any, memories as any)
}

test('POST memories/:id/refresh-evidence 转发 userId 与 id', async () => {
  const captured: any[] = []
  const controller = controllerWith({
    refreshEvidence: async (userId: string, id: string) => { captured.push({ userId, id }); return { evidenceStatus: 'stale', reviewCreated: true } },
  })
  const result = await controller.refreshMemoryEvidence('m1', { user: { id: 'u1' } } as any)
  assert.deepEqual(result, { evidenceStatus: 'stale', reviewCreated: true })
  assert.deepEqual(captured, [{ userId: 'u1', id: 'm1' }])
})

test('GET memories/export 写出 NDJSON 附件', async () => {
  const jsonl = '{"id":"m1"}\n{"id":"m2"}'
  const controller = controllerWith({ exportJsonl: async () => jsonl })
  const res: any = {
    headers: {} as Record<string, string>,
    body: '',
    setHeader: (k: string, v: string) => { res.headers[k] = v },
    write: (chunk: string) => { res.body += chunk },
    end: () => { res.ended = true },
  }
  await controller.exportMemories(res, { user: { id: 'u1' } } as any)
  assert.equal(res.headers['Content-Type'], 'application/x-ndjson; charset=utf-8')
  assert.match(String(res.headers['Content-Disposition']), /assistant-memories\.jsonl/)
  assert.equal(res.body, jsonl)
  assert.equal(res.ended, true)
})

test('refresh-evidence / export 无认证用户时抛 400', async () => {
  const controller = controllerWith({})
  await assert.rejects(() => controller.refreshMemoryEvidence('m1', undefined), BadRequestException)
  await assert.rejects(() => controller.exportMemories({} as any, undefined), BadRequestException)
})

// ---- generation gating：memoryEnabled=false 时 memoryRecall 置 undefined（不再注入 [已确认认知]） ----

const recallStub: MemoryRecallServiceLike = {
  recall: async () => [{ label: '已确认认知', text: '保留浮层（范围：global）' }],
}

function genStore(settings: { memoryEnabled: boolean; temporary: boolean }) {
  const events: any[] = []
  return {
    events,
    conversations: {
      // 无会话 / id 失效时走 create 新建（本组测试始终带 conversationId 走 get 路径，ensure 已随 send 语义移除）。
      create: async () => ({ id: 'c1', isNew: true }),
      get: async (_u: string, id: string) => ({ id, title: '新对话', status: 'active' }),
      touch: async () => undefined,
      renameIfDefault: async () => undefined,
      setActiveRequest: async () => undefined,
      getSettings: async () => settings,
    },
    messages: {
      appendUser: async () => ({ messageId: 'um1', seq: 1 }),
      createPlaceholder: async () => ({ messageId: 'am1', seq: 2 }),
      appendDelta: async () => undefined,
      finalize: async (_u: string, _id: string, payload: any) => { events.push({ type: 'finalize', ...payload }) },
      markCancelled: async () => undefined,
      markFailed: async () => undefined,
      list: async () => [],
      listBefore: async () => [],
      getByRequestId: async () => null,
    },
  }
}

test('rag 分支：memoryEnabled=false 时 streamRagAnswer 收到 memoryRecall undefined，complete 事件补发空 memoryCitations', async () => {
  const store = genStore({ memoryEnabled: false, temporary: false })
  const captured: any[] = []
  const emitted: any[] = []
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async (input: any) => { captured.push(input); return { route: 'rag', citations: [], memoryCitations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } } } } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any, undefined as any, undefined as any, undefined as any,
    recallStub as any,
  )
  await service.start({ userId: 'u1', conversationId: 'c1', requestId: 'req-rag-off', question: '布局怎么改', forceRoute: 'rag' }, (e) => emitted.push(e))
  await service.waitForTerminal('req-rag-off')
  assert.equal(captured[0].memoryRecall, undefined, '关闭召回时 rag 不得注入认知节')
  const complete = emitted.find((e) => e.event === 'complete')
  assert.ok(complete, 'rag 完成时应发 complete 事件')
  assert.deepEqual(complete.data.memoryCitations, [], 'complete 事件应携带 memoryCitations（关闭召回时为空）')
})

test('rag 分支：memoryEnabled 缺省（旧数据按 true）时透传注入的 memoryRecall，complete 事件补发认知引用', async () => {
  const store = genStore({ memoryEnabled: true, temporary: false })
  const captured: any[] = []
  const emitted: any[] = []
  const memoryCitations = [{ marker: 'M1', memoryId: 'm1', text: '保留浮层' }]
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async (input: any) => { captured.push(input); return { route: 'rag', citations: [], memoryCitations, warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } } } } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any, undefined as any, undefined as any, undefined as any,
    recallStub as any,
  )
  await service.start({ userId: 'u1', conversationId: 'c1', requestId: 'req-rag-on', question: '布局怎么改', forceRoute: 'rag' }, (e) => emitted.push(e))
  await service.waitForTerminal('req-rag-on')
  assert.equal(captured[0].memoryRecall, recallStub, '开启召回时透传注入的 recall')
  const complete = emitted.find((e) => e.event === 'complete')
  assert.ok(complete, 'rag 完成时应发 complete 事件')
  assert.deepEqual(complete.data.memoryCitations, memoryCitations, 'complete 事件携带 streamRagAnswer 返回的认知引用')
})

test('设置读取失败时保持默认召回，不影响回答', async () => {
  const store = genStore({ memoryEnabled: true, temporary: false })
  store.conversations.getSettings = async () => { throw new Error('conversation not found') }
  const captured: any[] = []
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async (input: any) => { captured.push(input); return { route: 'rag', citations: [], memoryCitations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } } } } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any, undefined as any, undefined as any, undefined as any,
    recallStub as any,
  )
  await service.start({ userId: 'u1', conversationId: 'c1', requestId: 'req-rag-cfg', question: '布局怎么改', forceRoute: 'rag' }, () => undefined)
  await service.waitForTerminal('req-rag-cfg')
  assert.equal(captured[0].memoryRecall, recallStub)
})

// pet 分支经 context.assemble 注入认知节：显式 memoryRecall=undefined 时不得回退到 context 自身 DI 召回。
function makeContext(ownRecall: MemoryRecallServiceLike | undefined) {
  const messages = { list: async () => [], listBefore: async () => [] }
  const checkpoints = { getLatest: async () => null }
  return new AssistantContextService(messages as any, checkpoints as any, ownRecall as any)
}

test('pet 分支：memoryEnabled=false 时不再注入 [已确认认知]', async () => {
  const store = genStore({ memoryEnabled: false, temporary: false })
  const chatPrompts: string[] = []
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => ({ route: 'rag', citations: [], memoryCitations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }) } as any,
    { chatPet: async (opts: any) => { chatPrompts.push(opts.message); return new ReadableStream({ start(c) { c.close() } }) } } as any,
    undefined as any, undefined as any,
    makeContext(recallStub) as any, undefined as any,
    recallStub as any,
  )
  await service.start({ userId: 'u1', conversationId: 'c1', requestId: 'req-pet-off', question: '布局怎么改', forceRoute: 'pet' }, () => undefined)
  await service.waitForTerminal('req-pet-off')
  assert.ok(!chatPrompts[0].includes('已确认认知'), '关闭召回时 pet prompt 不得含 [已确认认知]')
})

test('pet 分支：memoryEnabled=true 时注入 [已确认认知] 分区', async () => {
  const store = genStore({ memoryEnabled: true, temporary: false })
  const chatPrompts: string[] = []
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => ({ route: 'rag', citations: [], memoryCitations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }) } as any,
    { chatPet: async (opts: any) => { chatPrompts.push(opts.message); return new ReadableStream({ start(c) { c.close() } }) } } as any,
    undefined as any, undefined as any,
    makeContext(recallStub) as any, undefined as any,
    recallStub as any,
  )
  await service.start({ userId: 'u1', conversationId: 'c1', requestId: 'req-pet-on', question: '布局怎么改', forceRoute: 'pet' }, () => undefined)
  await service.waitForTerminal('req-pet-on')
  assert.ok(chatPrompts[0].includes('已确认认知'), '开启召回时 pet prompt 含 [已确认认知]')
})
