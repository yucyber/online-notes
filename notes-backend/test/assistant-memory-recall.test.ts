import { test } from 'node:test'
import assert = require('node:assert/strict')
import { MemoryRecallService } from '../src/modules/assistant/assistant-memory-recall.service'

// 内存模型：find → sort → limit → lean 链（lean 直接 resolve 数组，实现按方案 A 不带 .exec()）。
// find 非 async——async 返回 Promise 链不上 .sort（同 assistant-search.test.ts / assistant-branch.test.ts 约定）。
// 只按 status/evidenceStatus/userId/scope.type 过滤，其余（validTo/supersededById/分词命中）由服务内复查负责，
// 保证过期、被替代、范围不兼容等规则不会被 DB 预筛掩盖。
class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  find(filter: any) {
    return {
      sort: () => ({
        limit: () => ({
          lean: async () => this.docs.filter((d) => {
            if (filter.status && d.status !== filter.status) return false
            if (filter.evidenceStatus && d.evidenceStatus !== filter.evidenceStatus) return false
            if (filter.userId && String(d.userId) !== String(filter.userId)) return false
            if (filter['scope.type'] && d.scope.type !== filter['scope.type']) return false
            return true
          }),
        }),
      }),
    }
  }
}

test('只召回已确认未过期的认知，并按范围过滤', async () => {
  const model = new MemoryModel([
    { _id: 'm1', userId: 'u1', subject: '界面', statement: '保留现有浮层', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok' },
    { _id: 'm2', userId: 'u1', subject: '界面', statement: '用大侧栏', scope: { type: 'global' }, status: 'superseded', evidenceStatus: 'ok' },
    { _id: 'm3', userId: 'u2', subject: '界面', statement: '别的用户', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok' },
    { _id: 'm4', userId: 'u1', subject: '知识库A', statement: 'KB 结论', scope: { type: 'knowledge_base', id: 'kb1' }, status: 'confirmed', evidenceStatus: 'ok' },
  ])
  const service = new MemoryRecallService(model as any)
  const hits = await service.recall('u1', '界面怎么改', {})
  assert.equal(hits.length, 1)
  assert.ok(hits[0].text.includes('保留现有浮层'))
  const kbHits = await service.recall('u1', '知识库A 结论', { knowledgeBaseId: 'kb1' })
  assert.equal(kbHits.length, 1)
})

test('过期与证据缺失的认知不召回', async () => {
  const model = new MemoryModel([
    { _id: 'm1', userId: 'u1', subject: '主题', statement: '过期内容', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok', validTo: '2020-01-01T00:00:00.000Z' },
    { _id: 'm2', userId: 'u1', subject: '主题', statement: '来源缺失', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'stale' },
  ])
  const service = new MemoryRecallService(model as any)
  const hits = await service.recall('u1', '主题', {})
  assert.equal(hits.length, 0)
})

test('note/conversation 范围需对应 id 匹配，global 恒兼容', async () => {
  const model = new MemoryModel([
    { _id: 'm1', userId: 'u1', subject: '布局', statement: '笔记内决策', scope: { type: 'note', id: 'n1' }, status: 'confirmed', evidenceStatus: 'ok' },
    { _id: 'm2', userId: 'u1', subject: '布局', statement: '会话内结论', scope: { type: 'conversation', id: 'c1' }, status: 'confirmed', evidenceStatus: 'ok' },
    { _id: 'm3', userId: 'u1', subject: '布局', statement: '全局偏好', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok' },
  ])
  const service = new MemoryRecallService(model as any)
  const noteHits = await service.recall('u1', '布局', { noteId: 'n1' })
  assert.deepEqual(noteHits.map((h) => h.text), ['笔记内决策（范围：note n1）', '全局偏好（范围：global）'])
  const convHits = await service.recall('u1', '布局', { conversationId: 'c1' })
  assert.deepEqual(convHits.map((h) => h.text), ['会话内结论（范围：conversation c1）', '全局偏好（范围：global）'])
})

test('按命中数降序且 limit 生效', async () => {
  const model = new MemoryModel([
    { _id: 'm1', userId: 'u1', subject: 'React', statement: '怎么用查文档', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok' },
    { _id: 'm2', userId: 'u1', subject: 'React', statement: '看示例即可', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok' },
    { _id: 'm3', userId: 'u1', subject: '布局', statement: '不相关', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok' },
  ])
  const service = new MemoryRecallService(model as any)
  const hits = await service.recall('u1', 'React 怎么用', {})
  assert.ok(hits.length >= 2)
  assert.ok(hits[0].text.includes('查文档'))
  const limited = await service.recall('u1', 'React 怎么用', { limit: 1 })
  assert.equal(limited.length, 1)
  assert.ok(limited[0].text.includes('查文档'))
})

test('确认后又被 supersededById 指向替代的认知不召回', async () => {
  const model = new MemoryModel([
    { _id: 'm1', userId: 'u1', subject: '主题', statement: '已被替代的旧结论', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok', supersededById: 'm2' },
  ])
  const service = new MemoryRecallService(model as any)
  const hits = await service.recall('u1', '主题', {})
  assert.equal(hits.length, 0)
})

test('有效期内（validTo 未来）仍可召回', async () => {
  const model = new MemoryModel([
    { _id: 'm1', userId: 'u1', subject: '主题', statement: '远期结论', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok', validTo: '2099-01-01T00:00:00.000Z' },
  ])
  const service = new MemoryRecallService(model as any)
  const hits = await service.recall('u1', '主题', {})
  assert.equal(hits.length, 1)
})

test('单字问题不触发召回查询并返回空', async () => {
  const model = new MemoryModel([
    { _id: 'm1', userId: 'u1', subject: '主题', statement: '一句话', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok' },
  ])
  const service = new MemoryRecallService(model as any)
  const hits = await service.recall('u1', '界', {})
  assert.equal(hits.length, 0)
})
