import { test } from 'node:test'
import assert = require('node:assert/strict')
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { MemoryCandidatesService } from '../src/modules/assistant/assistant-memory-candidates.service'
import { AssistantController } from '../src/modules/assistant/assistant.controller'

// 内存 Mongoose 模型：与真实 Query 同形——find/findOneAndUpdate/updateOne 返回可链式
// sort/limit/lean/exec 的对象（exec 惰性求值，读取当前 docs），使服务按真实链式 API 编程、
// 测试仍全内存直跑。find 不能是 async（async 返回 Promise 无法继续链式）。
class QueryChain {
  private readonly rows: () => any
  constructor(rows: () => any) { this.rows = rows }
  sort() { return this }
  limit() { return this }
  lean() { return this }
  exec() { return Promise.resolve(this.rows()) }
}

function getPath(obj: any, path: string): any {
  return path.split('.').reduce((o, key) => (o == null ? undefined : o[key]), obj)
}

function matchesFilter(doc: any, filter: any): boolean {
  return Object.entries(filter).every(([key, value]: [string, any]) => {
    const actual = getPath(doc, key)
    if (value && typeof value === 'object' && '$in' in value) {
      return value.$in.some((item: any) => String(item) === String(actual))
    }
    if (value && typeof value === 'object' && '$regex' in value) {
      return new RegExp(String(value.$regex), String(value.$options ?? '')).test(String(actual ?? ''))
    }
    return String(actual) === String(value)
  })
}

function cloneSeed(docs: any[]) {
  return docs.map((d) => ({ ...d, scope: d.scope ? { ...d.scope } : d.scope }))
}

class CandidateModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = cloneSeed(seed) }
  find(filter: any) { return new QueryChain(() => this.docs.filter((d) => matchesFilter(d, filter))) }
  findOneAndUpdate(filter: any, update: any, _opts?: any) {
    return new QueryChain(() => {
      const doc = this.docs.find((d) => matchesFilter(d, filter))
      if (doc) Object.assign(doc, update.$set)
      return doc ?? null
    })
  }
  updateOne(filter: any, update: any) {
    return new QueryChain(() => {
      const idx = this.docs.findIndex((d) => matchesFilter(d, filter))
      if (idx >= 0) Object.assign(this.docs[idx], update.$set)
      return { matchedCount: idx >= 0 ? 1 : 0, modifiedCount: idx >= 0 ? 1 : 0 }
    })
  }
}

class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = cloneSeed(seed) }
  find(filter: any) { return new QueryChain(() => this.docs.filter((d) => matchesFilter(d, filter))) }
  async create(data: any) {
    const doc = { _id: `mem-${this.docs.length + 1}`, ...data }
    this.docs.push(doc)
    return doc
  }
}

function pendingCandidate(overrides: any = {}) {
  return {
    _id: 'c1', userId: 'u1', conversationId: 'conv1', kind: 'fact', subject: '主题',
    statement: '表述', scope: { type: 'global' }, confidence: 0.7, evidence: [],
    status: 'pending', createdAt: '2026-09-01T00:00:00.000Z', ...overrides,
  }
}

function confirmedMemory(overrides: any = {}) {
  return {
    _id: 'm1', userId: 'u1', conversationId: 'conv0', kind: 'decision', subject: '界面',
    statement: '保留旧方案', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok',
    evidence: [], confidence: 0.9, createdAt: '2026-08-01T00:00:00.000Z', ...overrides,
  }
}

test('确认候选写入长期记忆并保留审计', async () => {
  const memories = new MemoryModel()
  const candidates = new CandidateModel([
    pendingCandidate({ kind: 'decision', subject: '界面', statement: '保留浮层', confidence: 0.9, evidence: [{ type: 'message', messageId: 'm1', excerpt: 'x' }] }),
  ])
  const service = new MemoryCandidatesService(candidates as any, memories as any)
  const result = await service.confirm('u1', 'c1', {})
  assert.equal(result.memoryId, 'mem-1')
  assert.equal(result.conflict, undefined)
  const memory = memories.docs[0]
  assert.equal(memory.status, 'confirmed')
  assert.equal(memory.kind, 'decision')
  assert.equal(memory.subject, '界面')
  assert.equal(memory.statement, '保留浮层')
  assert.equal(memory.userId, 'u1')
  assert.equal(memory.conversationId, 'conv1')
  assert.equal(memory.candidateId, 'c1')
  assert.ok(memory.confirmedAt instanceof Date)
  // 候选本身标记 confirmed 保留审计，不再出现在待确认列表。
  assert.equal(candidates.docs[0].status, 'confirmed')
})

test('修改后确认使用编辑值', async () => {
  const memories = new MemoryModel()
  const candidates = new CandidateModel([pendingCandidate({ statement: '旧表述' })])
  const service = new MemoryCandidatesService(candidates as any, memories as any)
  await service.confirm('u1', 'c1', { statement: '新表述', scope: { type: 'knowledge_base', id: 'kb1' } })
  assert.equal(memories.docs[0].statement, '新表述')
  assert.equal(memories.docs[0].scope.type, 'knowledge_base')
  assert.equal(memories.docs[0].scope.id, 'kb1')
  // 未编辑字段沿用候选值。
  assert.equal(memories.docs[0].kind, 'fact')
  assert.equal(memories.docs[0].subject, '主题')
})

test('确认遇到同 scope 主题重叠的已确认节点时返回冲突且不写长期记忆', async () => {
  const memories = new MemoryModel([confirmedMemory()])
  const candidates = new CandidateModel([pendingCandidate({ kind: 'decision', subject: '界面', statement: '改用悬浮窗' })])
  const service = new MemoryCandidatesService(candidates as any, memories as any)
  const result = await service.confirm('u1', 'c1', {})
  assert.equal(result.memoryId, '')
  assert.deepEqual(result.conflict, { memoryId: 'm1', subject: '界面', statement: '保留旧方案' })
  // 不写长期记忆；候选标记 confirmed 挂起，等待 Task 4 冲突解决。
  assert.equal(memories.docs.length, 1)
  assert.equal(candidates.docs[0].status, 'confirmed')
})

test('不同 scope 的同主题节点不构成冲突', async () => {
  const memories = new MemoryModel([confirmedMemory()])
  const candidates = new CandidateModel([pendingCandidate({ kind: 'decision', subject: '界面', statement: 'KB 内改用悬浮窗', scope: { type: 'knowledge_base', id: 'kb1' } })])
  const service = new MemoryCandidatesService(candidates as any, memories as any)
  const result = await service.confirm('u1', 'c1', {})
  assert.equal(result.memoryId, 'mem-2')
  assert.equal(result.conflict, undefined)
  const created = memories.docs.find((m: any) => m.candidateId === 'c1')
  assert.equal(created.scope.type, 'knowledge_base')
  assert.equal(created.scope.id, 'kb1')
})

test('确认不存在的候选抛 not found', async () => {
  const service = new MemoryCandidatesService(new CandidateModel() as any, new MemoryModel() as any)
  await assert.rejects(() => service.confirm('u1', 'c1', {}), (error: any) => error instanceof NotFoundException && /not found/i.test(String(error.message)))
  // 已确认/拒绝的候选再次确认同样视为不存在（status 过滤 pending）。
  const candidates = new CandidateModel([pendingCandidate({ status: 'confirmed' })])
  const svc = new MemoryCandidatesService(candidates as any, new MemoryModel() as any)
  await assert.rejects(() => svc.confirm('u1', 'c1', {}), (error: any) => error instanceof NotFoundException)
})

test('拒绝记录原因', async () => {
  const candidates = new CandidateModel([pendingCandidate()])
  const service = new MemoryCandidatesService(candidates as any, new MemoryModel() as any)
  await service.reject('u1', 'c1', '表述不准确')
  assert.equal(candidates.docs[0].status, 'rejected')
  assert.equal(candidates.docs[0].rejectionReason, '表述不准确')
})

test('拒绝不存在的候选抛 not found', async () => {
  const service = new MemoryCandidatesService(new CandidateModel() as any, new MemoryModel() as any)
  await assert.rejects(() => service.reject('u1', 'c1', '原因'), (error: any) => error instanceof NotFoundException)
})

test('listPending 只返回本人的 pending 候选并映射视图字段', async () => {
  const candidates = new CandidateModel([
    pendingCandidate({ _id: 'c1', userId: 'u1', confidence: 0.8, evidence: [{ type: 'message', messageId: 'm1', excerpt: 'x' }] }),
    pendingCandidate({ _id: 'c2', userId: 'u2' }),
    pendingCandidate({ _id: 'c3', userId: 'u1', status: 'confirmed' }),
  ])
  const service = new MemoryCandidatesService(candidates as any, new MemoryModel() as any)
  const items = await service.listPending('u1')
  assert.equal(items.length, 1)
  assert.deepEqual(items[0], {
    id: 'c1', kind: 'fact', subject: '主题', statement: '表述', scope: { type: 'global' },
    confidence: 0.8, evidence: [{ type: 'message', messageId: 'm1', excerpt: 'x' }], createdAt: '2026-09-01T00:00:00.000Z',
  })
})

test('批量确认校验同 kind 同 scope', async () => {
  const memories = new MemoryModel()
  const candidates = new CandidateModel([
    pendingCandidate({ _id: 'c1', kind: 'decision', subject: 'a', statement: 'A' }),
    pendingCandidate({ _id: 'c2', kind: 'fact', subject: 'b', statement: 'B' }),
  ])
  const service = new MemoryCandidatesService(candidates as any, memories as any)
  await assert.rejects(
    () => service.batchConfirm('u1', ['c1', 'c2'], { kind: 'decision', scope: { type: 'global' } }),
    (error: any) => error instanceof BadRequestException && /kind|scope/i.test(String(error.message)),
  )
  // 校验失败不产生任何写入或状态变更。
  assert.equal(memories.docs.length, 0)
  assert.equal(candidates.docs[0].status, 'pending')
  assert.equal(candidates.docs[1].status, 'pending')
})

test('批量确认同 kind 同 scope 全部写入并返回计数', async () => {
  const memories = new MemoryModel()
  const candidates = new CandidateModel([
    pendingCandidate({ _id: 'c1', kind: 'decision', subject: '界面', statement: '保留浮层' }),
    pendingCandidate({ _id: 'c2', kind: 'decision', subject: '布局', statement: '用大侧栏' }),
  ])
  const service = new MemoryCandidatesService(candidates as any, memories as any)
  const result = await service.batchConfirm('u1', ['c1', 'c2'], { kind: 'decision', scope: { type: 'global' } })
  assert.deepEqual(result, { confirmed: 2, conflicts: 0 })
  assert.equal(memories.docs.length, 2)
  assert.ok(memories.docs.every((m: any) => m.status === 'confirmed' && m.kind === 'decision' && m.scope.type === 'global'))
  assert.deepEqual(memories.docs.map((m: any) => m.candidateId).sort(), ['c1', 'c2'])
  assert.equal(candidates.docs[0].status, 'confirmed')
  assert.equal(candidates.docs[1].status, 'confirmed')
})

test('批量确认部分候选冲突时按冲突数跳过写入', async () => {
  const memories = new MemoryModel([confirmedMemory({ subject: '布局', statement: '保留旧布局' })])
  const candidates = new CandidateModel([
    pendingCandidate({ _id: 'c1', kind: 'decision', subject: '布局', statement: '改用新布局' }),
    pendingCandidate({ _id: 'c2', kind: 'decision', subject: '字体', statement: '用默认字体' }),
  ])
  const service = new MemoryCandidatesService(candidates as any, memories as any)
  const result = await service.batchConfirm('u1', ['c1', 'c2'], { kind: 'decision', scope: { type: 'global' } })
  assert.deepEqual(result, { confirmed: 1, conflicts: 1 })
  // 冲突候选保持 pending（批量内不擅自置状态），无冲突候选正常确认。
  assert.equal(candidates.docs.find((d) => d._id === 'c1').status, 'pending')
  assert.equal(candidates.docs.find((d) => d._id === 'c2').status, 'confirmed')
})

test('批量确认 ids 为空或 kind/scope 非法时抛 400', async () => {
  const service = new MemoryCandidatesService(new CandidateModel() as any, new MemoryModel() as any)
  await assert.rejects(() => service.batchConfirm('u1', [], { kind: 'decision', scope: { type: 'global' } }), BadRequestException)
  await assert.rejects(() => service.batchConfirm('u1', ['c1'], { kind: 'not-a-kind' as any, scope: { type: 'global' } }), BadRequestException)
  await assert.rejects(() => service.batchConfirm('u1', ['c1'], { kind: 'decision', scope: { type: 'nope' } as any }), BadRequestException)
})

// ---- controller 端点：转发 userId 与 body 到候选服务，结果原样返回 ----

function controllerWith(candidates: any) {
  return new AssistantController({} as any, {} as any, {} as any, {} as any, candidates as any)
}

test('GET memories/candidates 返回本人 pending 候选列表', async () => {
  const items = [{ id: 'c1', kind: 'fact', subject: '主题', statement: '表述', scope: { type: 'global' }, confidence: 0.7, evidence: [], createdAt: '' }]
  const controller = controllerWith({ listPending: async (userId: string) => { assert.equal(userId, 'u1'); return items } })
  const result = await controller.listMemoryCandidates('pending', { user: { id: 'u1' } } as any)
  assert.deepEqual(result, { items })
  // 未带认证用户抛 400；非 pending 的 status 查询不被支持。
  await assert.rejects(() => controller.listMemoryCandidates('pending', undefined), BadRequestException)
  await assert.rejects(() => controller.listMemoryCandidates('confirmed', { user: { id: 'u1' } } as any), BadRequestException)
})

test('POST memories/candidates/:id/confirm 转发 edits 并返回确认结果', async () => {
  const confirm = async (userId: string, id: string, edits: any) => {
    assert.equal(userId, 'u1')
    assert.equal(id, 'c1')
    assert.deepEqual(edits, { statement: '新表述' })
    return { memoryId: 'mem-1' }
  }
  const controller = controllerWith({ confirm })
  const result = await controller.confirmMemoryCandidate('c1', { statement: '新表述' }, { user: { id: 'u1' } } as any)
  assert.deepEqual(result, { memoryId: 'mem-1' })
})

test('POST memories/candidates/:id/reject 转发原因', async () => {
  let called: any = null
  const controller = controllerWith({
    reject: async (userId: string, id: string, reason: string) => { called = { userId, id, reason } },
  })
  const result = await controller.rejectMemoryCandidate('c1', '表述不准确', { user: { id: 'u1' } } as any)
  assert.deepEqual(called, { userId: 'u1', id: 'c1', reason: '表述不准确' })
  assert.deepEqual(result, { ok: true })
})

test('POST memories/candidates/batch-confirm 转发 ids/kind/scope', async () => {
  const controller = controllerWith({
    batchConfirm: async (userId: string, ids: string[], opts: any) => {
      assert.equal(userId, 'u1')
      assert.deepEqual(ids, ['c1', 'c2'])
      assert.deepEqual(opts, { kind: 'decision', scope: { type: 'global' } })
      return { confirmed: 1, conflicts: 1 }
    },
  })
  const result = await controller.batchConfirmMemoryCandidates(
    { ids: ['c1', 'c2'], kind: 'decision', scope: { type: 'global' } },
    { user: { id: 'u1' } } as any,
  )
  assert.deepEqual(result, { confirmed: 1, conflicts: 1 })
})

test('候选管理端点无认证用户时抛 400', async () => {
  const controller = controllerWith({})
  await assert.rejects(() => controller.listMemoryCandidates('pending', undefined), BadRequestException)
  await assert.rejects(() => controller.confirmMemoryCandidate('c1', {}, undefined), BadRequestException)
  await assert.rejects(() => controller.rejectMemoryCandidate('c1', '原因', undefined), BadRequestException)
  await assert.rejects(() => controller.batchConfirmMemoryCandidates({ ids: ['c1'], kind: 'decision', scope: { type: 'global' } }, undefined), BadRequestException)
})
