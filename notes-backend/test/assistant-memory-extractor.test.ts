import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantMemoryExtractorService } from '../src/modules/assistant/assistant-memory-extractor.service'

class MemoryCandidateModel {
  docs: any[] = []
  async insertMany(items: any[]) { this.docs.push(...items); return items }
  async findOne(filter: any) { return this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) ?? null }
}

test('提取合法候选并跳过重复证据', async () => {
  const model = new MemoryCandidateModel()
  const messages = {
    list: async () => [
      { id: 'um1', seq: 1, role: 'user', route: 'rag', content: '我决定保留现有浮层', status: 'completed', citations: [], warnings: [], createdAt: '' },
      { id: 'am1', seq: 2, role: 'assistant', route: 'rag', content: '好的，已记录', status: 'completed', citations: [{ evidenceId: 'E1', noteId: 'n1', noteTitle: 't', chunkId: 'c1', headingPath: [], excerpt: 'x' }], warnings: [], createdAt: '' },
    ],
  }
  const gateway = {
    chatTask: async () => ({ content: JSON.stringify({ candidates: [{ kind: 'decision', subject: '界面形态', statement: '保留现有浮层', confidence: 0.9, messageIds: ['um1'] }] }) }),
  }
  const service = new AssistantMemoryExtractorService(model as any, gateway as any, messages as any)
  const first = await service.extract('u1', 'c1')
  assert.equal(first.created, 1)
  const second = await service.extract('u1', 'c1')
  assert.equal(second.created, 0)
  assert.equal(second.skipped, 1)
})

test('仅来自助手建议且无笔记证据的候选强制为 hypothesis', async () => {
  const model = new MemoryCandidateModel()
  const messages = {
    list: async () => [
      { id: 'am1', seq: 2, role: 'assistant', route: 'pet', content: '我建议你用大侧栏', status: 'completed', citations: [], warnings: [], createdAt: '' },
    ],
  }
  const gateway = {
    chatTask: async () => ({ content: JSON.stringify({ candidates: [{ kind: 'decision', subject: '布局', statement: '用大侧栏', confidence: 0.6, messageIds: ['am1'] }] }) }),
  }
  const service = new AssistantMemoryExtractorService(model as any, gateway as any, messages as any)
  await service.extract('u1', 'c1')
  assert.equal(model.docs[0].kind, 'hypothesis')
})

test('会话临时或关闭记忆时不提取', async () => {
  const model = new MemoryCandidateModel()
  const conversations = { getSettings: async () => ({ memoryEnabled: false, temporary: true }) }
  const service = new AssistantMemoryExtractorService(model as any, {} as any, {} as any, conversations as any)
  const result = await service.extract('u1', 'c1')
  assert.equal(result.created, 0)
  assert.equal(result.skipped, 0)
})

test('getSettings 失败时按允许提取降级', async () => {
  const model = new MemoryCandidateModel()
  const conversations = { getSettings: async () => { throw new Error('conversation not found') } }
  const messages = {
    list: async () => [
      { id: 'um1', seq: 1, role: 'user', route: 'rag', content: '结论是什么', status: 'completed', citations: [], warnings: [], createdAt: '' },
    ],
  }
  const gateway = {
    chatTask: async () => ({ content: JSON.stringify({ candidates: [{ kind: 'fact', subject: '主题', statement: '结论 X', confidence: 0.8, messageIds: ['um1'] }] }) }),
  }
  const service = new AssistantMemoryExtractorService(model as any, gateway as any, messages as any, conversations as any)
  const result = await service.extract('u1', 'c1')
  assert.equal(result.created, 1)
})
