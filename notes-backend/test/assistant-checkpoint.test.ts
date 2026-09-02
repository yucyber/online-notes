import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantCheckpointService } from '../src/modules/assistant/assistant-checkpoint.service'

// 内存模型：生产查询为 findOne/findOneAndUpdate 的链式调用（sort/lean/exec），
// 此处返回链式代理最终 resolve 首条命中/写后文档——只补机制，不改断言语义。
class MemoryModel {
  docs: any[] = []
  private rows(filter: any): any[] {
    return this.docs.filter((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v)))
  }
  findOne(filter: any) {
    const rows = this.rows(filter)
    return { sort: () => ({ lean: () => ({ exec: async () => rows[0] ?? null }) }) }
  }
  findOneAndUpdate(_filter: any, update: any, _opts: any) {
    const existing = this.docs.find((d) => String(d.conversationId) === String(update.$set.conversationId))
    if (existing) Object.assign(existing, update.$set)
    else this.docs.push({ _id: 'cp1', ...update.$set })
    const doc = this.docs[this.docs.length - 1]
    return { lean: () => ({ exec: async () => doc }) }
  }
}

test('build 解析模型 JSON 并写入最新 checkpoint', async () => {
  const model = new MemoryModel()
  const gateway = { chatTask: async () => ({ content: JSON.stringify({ summary: '讨论了界面方案', decisions: ['保留浮层'], openQuestions: ['是否扩大'], referencedEntities: ['小助手'] }) }) }
  const messages = {
    list: async () => [
      { id: 'm1', seq: 1, role: 'user', route: 'rag', content: '浮层够用吗', status: 'completed', citations: [], warnings: [], createdAt: '' },
      { id: 'm2', seq: 2, role: 'assistant', route: 'rag', content: '建议新增全屏', status: 'completed', citations: [], warnings: [], createdAt: '' },
    ],
  }
  const service = new AssistantCheckpointService(model as any, gateway as any, messages as any)
  const result = await service.build('u1', 'c1')
  assert.equal(result.summary, '讨论了界面方案')
  assert.deepEqual(result.decisions, ['保留浮层'])
  assert.equal(result.throughSeq, 2)
  assert.deepEqual(result.sourceMessageIds, ['m1', 'm2'])
})

test('getLatest 返回该会话最新 checkpoint', async () => {
  const model = new MemoryModel()
  model.docs.push({ conversationId: 'c1', userId: 'u1', throughSeq: 10, summary: 's', decisions: [], openQuestions: [], referencedEntities: [], sourceMessageIds: [] })
  const service = new AssistantCheckpointService(model as any, {} as any, {} as any)
  const latest = await service.getLatest('u1', 'c1')
  assert.equal(latest?.throughSeq, 10)
  assert.equal(await service.getLatest('u2', 'c1'), null)
})

test('build 无新消息时保留现有 checkpoint 且不调用模型', async () => {
  const model = new MemoryModel()
  model.docs.push({ conversationId: 'c1', userId: 'u1', throughSeq: 10, summary: 's', decisions: [], openQuestions: [], referencedEntities: [], sourceMessageIds: [] })
  let chatCalls = 0
  const gateway = { chatTask: async () => { chatCalls += 1; return { content: '{}' } } }
  const messages = { list: async () => [] }
  const service = new AssistantCheckpointService(model as any, gateway as any, messages as any)
  const result = await service.build('u1', 'c1')
  assert.equal(result.throughSeq, 10)
  assert.equal(chatCalls, 0)
})

test('schedule 距上一 checkpoint 不足 10 条不触发压缩', async () => {
  const model = new MemoryModel()
  model.docs.push({ conversationId: 'c1', userId: 'u1', throughSeq: 10, summary: 's', decisions: [], openQuestions: [], referencedEntities: [], sourceMessageIds: [] })
  let chatCalls = 0
  const gateway = { chatTask: async () => { chatCalls += 1; return { content: '{}' } } }
  const messages = { list: async () => [] }
  const service = new AssistantCheckpointService(model as any, gateway as any, messages as any)
  await service.schedule('u1', 'c1', 19)
  assert.equal(chatCalls, 0)
  assert.equal(model.docs.length, 1)
})

test('schedule 距上一 checkpoint 达到 10 条触发压缩', async () => {
  const model = new MemoryModel()
  model.docs.push({ conversationId: 'c1', userId: 'u1', throughSeq: 10, summary: 's', decisions: [], openQuestions: [], referencedEntities: [], sourceMessageIds: [] })
  let chatCalls = 0
  const gateway = { chatTask: async () => { chatCalls += 1; return { content: JSON.stringify({ summary: 'n', decisions: [], openQuestions: [], referencedEntities: [] }) } } }
  const messages = {
    list: async () => [
      { id: 'm11', seq: 11, role: 'user', route: 'rag', content: 'a', status: 'completed', citations: [], warnings: [], createdAt: '' },
      { id: 'm12', seq: 12, role: 'assistant', route: 'rag', content: 'b', status: 'completed', citations: [], warnings: [], createdAt: '' },
    ],
  }
  const service = new AssistantCheckpointService(model as any, gateway as any, messages as any)
  // schedule 的 build 是 fire-and-forget：等宏任务落定后再断言结果。
  await service.schedule('u1', 'c1', 20)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(chatCalls, 1)
  assert.equal(model.docs[model.docs.length - 1].throughSeq, 12)
})
