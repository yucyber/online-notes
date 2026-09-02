import { test } from 'node:test'
import assert = require('node:assert/strict')
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { MemoryService } from '../src/modules/assistant/assistant-memory.service'
import { AssistantController } from '../src/modules/assistant/assistant.controller'

// 内存 Mongoose 模型：与真实 Query 同形——find/findOne/findOneAndUpdate/updateOne/deleteOne
// 返回可链式 sort/limit/lean/exec 的对象（exec 惰性求值读取当前 docs）。sort 按首键升/降序、
// limit 截断在 exec 内应用，使服务按真实链式 API 编程、测试仍全内存直跑。
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
    if (value && typeof value === 'object' && '$regex' in value) {
      return new RegExp(String(value.$regex), String(value.$options ?? '')).test(String(actual ?? ''))
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

function memoryDoc(overrides: any = {}) {
  return {
    _id: 'm1', userId: 'u1', conversationId: 'conv0', kind: 'decision', subject: '界面',
    statement: '保留旧方案', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok',
    evidence: [], confidence: 0.9, updatedAt: '2026-08-01T00:00:00.000Z', ...overrides,
  }
}

function candidateDoc(overrides: any = {}) {
  return {
    _id: 'c1', userId: 'u1', conversationId: 'conv1', kind: 'decision', subject: '布局',
    statement: '改用新方案', scope: { type: 'global' }, confidence: 0.8, evidence: [],
    status: 'confirmed', createdAt: '2026-09-01T00:00:00.000Z', ...overrides,
  }
}

function newService(memories: ModelLike, candidates?: ModelLike) {
  return new MemoryService(memories as any, (candidates ?? makeModel()) as any)
}

// 时间断言相对 Date.now() 锚定：supersede/delete 写入的时间必须落在调用窗口内，不写死日期。
function assertInNowWindow(value: any, from: number, to: number) {
  assert.ok(value instanceof Date || typeof value === 'string', `expected a time value, got ${String(value)}`)
  const t = new Date(value as any).getTime()
  assert.ok(Number.isFinite(t) && t >= from && t <= to, `time ${value} outside [${from}, ${to}]`)
}

// ---- supersede：旧节点失效并建立 supersedes 关系（plan/brief 语义） ----

test('supersede 让旧节点失效并建立关系', async () => {
  const model = makeModel([
    memoryDoc({ _id: 'old', subject: '布局', statement: '用大侧栏' }),
    memoryDoc({ _id: 'new', subject: '布局', statement: '保留浮层' }),
  ])
  const service = newService(model)
  const before = Date.now()
  const result = await service.resolveConflict('u1', 'new', { type: 'supersede', targetMemoryId: 'old' })
  const after = Date.now()
  assert.deepEqual(result, { status: 'superseded' })
  const old = model.docs.find((d: any) => d._id === 'old')
  assert.equal(old.status, 'superseded')
  assertInNowWindow(old.validTo, before, after)
  assert.equal(old.supersededById, 'new')
  const next = model.docs.find((d: any) => d._id === 'new')
  assert.deepEqual(next.relation, { type: 'supersedes', targetMemoryId: 'old' })
})

test('supersede 的目标不存在时抛 not found 且不改动新节点', async () => {
  const model = makeModel([memoryDoc({ _id: 'new', subject: '布局' })])
  const service = newService(model)
  await assert.rejects(
    () => service.resolveConflict('u1', 'new', { type: 'supersede', targetMemoryId: 'ghost' }),
    (error: any) => error instanceof NotFoundException && /target memory not found/i.test(String(error.message)),
  )
  const next = model.docs.find((d: any) => d._id === 'new')
  assert.equal(next.relation, undefined)
  assert.equal(next.status, 'confirmed')
})

// ---- delete：物理删除；删除 supersedes 新节点时旧节点恢复有效 ----

test('删除新节点后旧节点恢复有效', async () => {
  const model = makeModel([
    memoryDoc({ _id: 'old', status: 'superseded', supersededById: 'new', validTo: '2026-09-01T00:00:00.000Z' }),
    memoryDoc({ _id: 'new', relation: { type: 'supersedes', targetMemoryId: 'old' } }),
  ])
  const service = newService(model)
  await service.delete('u1', 'new')
  assert.equal(model.docs.length, 1)
  const old = model.docs[0]
  assert.equal(old._id, 'old')
  assert.equal(old.status, 'confirmed')
  assert.equal(old.supersededById, undefined)
  assert.equal(old.validTo, undefined)
})

test('删除无 supersedes 关系的记忆仅物理删除', async () => {
  const model = makeModel([
    memoryDoc({ _id: 'm1' }),
    memoryDoc({ _id: 'm2', subject: '布局', statement: '另一条' }),
  ])
  const service = newService(model)
  await service.delete('u1', 'm1')
  assert.equal(model.docs.length, 1)
  assert.equal(model.docs[0]._id, 'm2')
})

// ---- seam：resolve 端点可处理 T3 confirm 冲突产生的 confirmed 挂起候选（无记忆行） ----

test('supersede 把 confirmed 挂起候选物化为记忆并替代旧节点', async () => {
  const memories = makeModel([memoryDoc({ _id: 'old', subject: '布局', statement: '用大侧栏' })])
  const candidates = makeModel([candidateDoc({ _id: 'c1' })])
  const service = newService(memories, candidates)
  const before = Date.now()
  const result = await service.resolveConflict('u1', 'c1', { type: 'supersede', targetMemoryId: 'old' })
  const after = Date.now()
  assert.deepEqual(result, { status: 'superseded' })
  assert.equal(memories.docs.length, 2)
  const created = memories.docs.find((d: any) => d.candidateId === 'c1')
  assert.ok(created, '挂起候选应被物化为长期记忆')
  assert.equal(created.status, 'confirmed')
  assert.equal(created.kind, 'decision')
  assert.equal(created.subject, '布局')
  assert.equal(created.statement, '改用新方案')
  assert.equal(created.conversationId, 'conv1')
  assert.equal(created.candidateId, 'c1')
  assertInNowWindow(created.confirmedAt, before, after)
  assert.deepEqual(created.relation, { type: 'supersedes', targetMemoryId: 'old' })
  const old = memories.docs.find((d: any) => d._id === 'old')
  assert.equal(old.status, 'superseded')
  assertInNowWindow(old.validTo, before, after)
  assert.equal(old.supersededById, created._id)
  // 候选保留 confirmed 审计态，不再出现在 pending 列表。
  assert.equal(candidates.docs[0].status, 'confirmed')
})

test('挂起候选 supersede 目标不存在时抛 not found 且不物化', async () => {
  const memories = makeModel([])
  const candidates = makeModel([candidateDoc({ _id: 'c1' })])
  const service = newService(memories, candidates)
  await assert.rejects(
    () => service.resolveConflict('u1', 'c1', { type: 'supersede', targetMemoryId: 'ghost' }),
    (error: any) => error instanceof NotFoundException && /target memory not found/i.test(String(error.message)),
  )
  assert.equal(memories.docs.length, 0)
  assert.equal(candidates.docs[0].status, 'confirmed')
})

test('reject_memory 把 confirmed 挂起候选退回 pending 供修改重提', async () => {
  const memories = makeModel([memoryDoc({ _id: 'old' })])
  const candidates = makeModel([candidateDoc({ _id: 'c1' })])
  const service = newService(memories, candidates)
  const result = await service.resolveConflict('u1', 'c1', { type: 'reject_memory' })
  assert.deepEqual(result, { status: 'rejected' })
  assert.equal(memories.docs.length, 1)
  assert.equal(candidates.docs[0].status, 'pending')
})

test('reject_memory 删除已物化记忆并把来源候选退回 pending', async () => {
  const memories = makeModel([memoryDoc({ _id: 'm1', candidateId: 'c1' })])
  const candidates = makeModel([candidateDoc({ _id: 'c1' })])
  const service = newService(memories, candidates)
  const result = await service.resolveConflict('u1', 'm1', { type: 'reject_memory' })
  assert.deepEqual(result, { status: 'rejected' })
  assert.equal(memories.docs.length, 0)
  assert.equal(candidates.docs[0].status, 'pending')
})

// ---- keep_both：不改旧节点；新结论范围仍与既有重叠则拒绝 ----

test('keep_both 同 scope 仍有重叠节点时拒绝且不产生写入', async () => {
  const memories = makeModel([memoryDoc({ _id: 'old', subject: '布局', statement: '用大侧栏' })])
  const candidates = makeModel([candidateDoc({ _id: 'c1', subject: '布局', statement: '改用新方案' })])
  const service = newService(memories, candidates)
  await assert.rejects(
    () => service.resolveConflict('u1', 'c1', { type: 'keep_both' }),
    (error: any) => error instanceof BadRequestException && /scope/i.test(String(error.message)),
  )
  assert.equal(memories.docs.length, 1)
  assert.equal(memories.docs[0].status, 'confirmed')
  assert.equal(candidates.docs[0].status, 'confirmed')
})

test('keep_both 携带不同 scope 后物化候选并保留旧节点', async () => {
  const memories = makeModel([memoryDoc({ _id: 'old', subject: '布局', statement: '用大侧栏' })])
  const candidates = makeModel([candidateDoc({ _id: 'c1', subject: '布局', statement: '改用新方案' })])
  const service = newService(memories, candidates)
  const result = await service.resolveConflict('u1', 'c1', { type: 'keep_both', scope: { type: 'knowledge_base', id: 'kb1' } })
  assert.deepEqual(result, { status: 'kept' })
  const old = memories.docs.find((d: any) => d._id === 'old')
  assert.equal(old.status, 'confirmed')
  assert.equal(old.supersededById, undefined)
  const created = memories.docs.find((d: any) => d.candidateId === 'c1')
  assert.ok(created, 'keep_both 应物化新结论')
  assert.equal(created.status, 'confirmed')
  assert.deepEqual(created.scope, { type: 'knowledge_base', id: 'kb1' })
  assert.equal(created.relation, undefined)
})

test('keep_both 对 memory 级节点同样拒绝同 scope 重叠', async () => {
  const model = makeModel([
    memoryDoc({ _id: 'old', subject: '布局', statement: '用大侧栏' }),
    memoryDoc({ _id: 'new', subject: '布局', statement: '保留浮层' }),
  ])
  const service = newService(model)
  await assert.rejects(
    () => service.resolveConflict('u1', 'new', { type: 'keep_both' }),
    (error: any) => error instanceof BadRequestException && /scope/i.test(String(error.message)),
  )
  assert.ok(model.docs.every((d: any) => d.status === 'confirmed'))
})

test('keep_both 对 memory 级节点改 scope 后放行并保留旧节点', async () => {
  const model = makeModel([
    memoryDoc({ _id: 'old', subject: '布局', statement: '用大侧栏' }),
    memoryDoc({ _id: 'new', subject: '布局', statement: '保留浮层' }),
  ])
  const service = newService(model)
  const result = await service.resolveConflict('u1', 'new', { type: 'keep_both', scope: { type: 'note', id: 'note1' } })
  assert.deepEqual(result, { status: 'kept' })
  assert.equal(model.docs.find((d: any) => d._id === 'old').status, 'confirmed')
  assert.deepEqual(model.docs.find((d: any) => d._id === 'new').scope, { type: 'note', id: 'note1' })
})

// ---- 未知 id / 越权 ----

test('resolveConflict 对未知 id 抛 not found', async () => {
  const memories = makeModel([memoryDoc({ _id: 'm1' })])
  const candidates = makeModel([candidateDoc({ _id: 'c1' })])
  const service = newService(memories, candidates)
  await assert.rejects(
    () => service.resolveConflict('u1', 'ghost', { type: 'reject_memory' }),
    (error: any) => error instanceof NotFoundException && /memory not found/i.test(String(error.message)),
  )
  // 他人用户的记忆不可被本用户 resolve。
  await assert.rejects(() => service.resolveConflict('u2', 'm1', { type: 'reject_memory' }), NotFoundException)
})

// ---- list：默认只返回当前有效（confirmed），includeSuperseded 打开演进视图 ----

test('list 默认只返回 confirmed，includeSuperseded 时包含已替代节点', async () => {
  const model = makeModel([
    memoryDoc({ _id: 'm1', updatedAt: '2026-09-02T00:00:00.000Z' }),
    memoryDoc({ _id: 'm2', status: 'superseded', supersededById: 'm1', updatedAt: '2026-09-01T00:00:00.000Z' }),
    memoryDoc({ _id: 'm3', userId: 'u2' }),
  ])
  const service = newService(model)
  const current = await service.list('u1')
  assert.deepEqual(current.map((item) => item.id), ['m1'])
  const all = await service.list('u1', { includeSuperseded: true })
  assert.deepEqual(all.map((item) => item.id), ['m1', 'm2'])
  const view = all[1]
  assert.equal(view.status, 'superseded')
  assert.equal(view.supersededById, 'm1')
  assert.equal(view.evidenceStatus, 'ok')
})

// ---- getTimeline：subject + scope 过滤并按 validFrom 升序（演进过程） ----

test('getTimeline 按 validFrom 升序返回该 subject+scope 的演进过程', async () => {
  const model = makeModel([
    memoryDoc({ _id: 'm1', subject: '布局', statement: '中期方案', validFrom: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z' }),
    memoryDoc({ _id: 'm2', subject: '布局', statement: '最初方案', status: 'superseded', supersededById: 'm3', validFrom: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z' }),
    memoryDoc({ _id: 'm3', subject: '布局', statement: '最新方案', validFrom: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z' }),
    memoryDoc({ _id: 'm4', subject: '布局', scope: { type: 'knowledge_base', id: 'kb1' }, validFrom: '2026-09-02T00:00:00.000Z' }),
    memoryDoc({ _id: 'm5', subject: '界面' }),
  ])
  const service = newService(model)
  const items = await service.getTimeline('u1', '布局', { type: 'global' })
  assert.deepEqual(items.map((item) => item.id), ['m2', 'm1', 'm3'])
  assert.equal(items[0].status, 'superseded')
  const kb = await service.getTimeline('u1', '布局', { type: 'knowledge_base', id: 'kb1' })
  assert.deepEqual(kb.map((item) => item.id), ['m4'])
})

// ---- controller 端点：转发 userId/参数到 MemoryService ----

function controllerWith(service: any) {
  return new AssistantController({} as any, {} as any, {} as any, {} as any, {} as any, service as any)
}

test('GET memories 返回当前有效记忆并支持 includeSuperseded', async () => {
  const items = [{ id: 'm1', status: 'confirmed' }]
  const calls: any[] = []
  const controller = controllerWith({
    list: async (userId: string, opts?: any) => { calls.push({ userId, opts }); return items },
  })
  const current = await controller.listMemories(undefined, { user: { id: 'u1' } } as any)
  assert.deepEqual(current, { items })
  await controller.listMemories('1', { user: { id: 'u1' } } as any)
  assert.deepEqual(calls, [
    { userId: 'u1', opts: undefined },
    { userId: 'u1', opts: { includeSuperseded: true } },
  ])
})

test('POST memories/:id/resolve 转发 id 与动作到服务', async () => {
  const captured: any[] = []
  const controller = controllerWith({
    resolveConflict: async (userId: string, id: string, action: any) => { captured.push({ userId, id, action }); return { status: 'superseded' } },
  })
  const req = { user: { id: 'u1' } } as any
  const supersede = await controller.resolveMemoryConflict('mem-1', { type: 'supersede', targetMemoryId: 'old' }, req)
  assert.deepEqual(supersede, { status: 'superseded' })
  await controller.resolveMemoryConflict('c1', { type: 'keep_both', scope: { type: 'note', id: 'n1' } }, req)
  await controller.resolveMemoryConflict('c1', { type: 'reject_memory' }, req)
  assert.deepEqual(captured, [
    { userId: 'u1', id: 'mem-1', action: { type: 'supersede', targetMemoryId: 'old' } },
    { userId: 'u1', id: 'c1', action: { type: 'keep_both', scope: { type: 'note', id: 'n1' } } },
    { userId: 'u1', id: 'c1', action: { type: 'reject_memory' } },
  ])
})

test('resolve 动作非法或缺少 targetMemoryId 时抛 400', async () => {
  const controller = controllerWith({ resolveConflict: async () => ({ status: 'ok' }) })
  const req = { user: { id: 'u1' } } as any
  await assert.rejects(() => controller.resolveMemoryConflict('m1', { type: 'modify' }, req), BadRequestException)
  await assert.rejects(() => controller.resolveMemoryConflict('m1', { type: 'supersede' }, req), BadRequestException)
  await assert.rejects(() => controller.resolveMemoryConflict('m1', { type: 'keep_both' }, undefined), BadRequestException)
})

test('DELETE memories/:id 删除并返回 ok', async () => {
  const captured: any[] = []
  const controller = controllerWith({
    delete: async (userId: string, id: string) => { captured.push({ userId, id }) },
  })
  const result = await controller.deleteMemory('mem-1', { user: { id: 'u1' } } as any)
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(captured, [{ userId: 'u1', id: 'mem-1' }])
})

test('GET memories/timeline 转发 subject 与 scope 查询参数', async () => {
  const captured: any[] = []
  const controller = controllerWith({
    getTimeline: async (userId: string, subject: string, scope: any) => { captured.push({ userId, subject, scope }); return [{ id: 'm1' }] },
  })
  const req = { user: { id: 'u1' } } as any
  const global = await controller.getMemoryTimeline('布局', 'global', undefined, req)
  assert.deepEqual(global, { items: [{ id: 'm1' }] })
  await controller.getMemoryTimeline('布局', 'note', 'note1', req)
  assert.deepEqual(captured, [
    { userId: 'u1', subject: '布局', scope: { type: 'global' } },
    { userId: 'u1', subject: '布局', scope: { type: 'note', id: 'note1' } },
  ])
})

test('记忆端点无认证用户时抛 400', async () => {
  const controller = controllerWith({})
  await assert.rejects(() => controller.listMemories(undefined, undefined), BadRequestException)
  await assert.rejects(() => controller.resolveMemoryConflict('m1', { type: 'reject_memory' }, undefined), BadRequestException)
  await assert.rejects(() => controller.deleteMemory('m1', undefined), BadRequestException)
  await assert.rejects(() => controller.getMemoryTimeline('布局', 'global', undefined, undefined), BadRequestException)
})
