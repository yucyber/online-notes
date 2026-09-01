import { test } from 'node:test'
import assert = require('node:assert/strict')
import { EventEmitter } from 'node:events'
import { AssistantGenerationService } from '../src/modules/assistant/assistant-generation.service'

const userId = 'u1'
const requestId = 'req-1'

function fakeStore() {
  const byRequest = new Map<string, any>()
  const events: any[] = []
  return {
    events,
    conversations: {
      ensure: async () => ({ id: 'c1', isNew: true }),
      get: async () => ({ id: 'c1', title: 't', status: 'active' }),
      touch: async () => undefined,
    },
    messages: {
      appendUser: async () => ({ messageId: 'um1', seq: 1 }),
      createPlaceholder: async () => ({ messageId: 'am1', seq: 2 }),
      appendDelta: async (u: string, id: string, content: string) => { events.push({ type: 'delta', content }) },
      finalize: async (u: string, id: string, payload: any) => { events.push({ type: 'finalize', ...payload }) },
      markCancelled: async (u: string, id: string, content: string) => { events.push({ type: 'cancelled', content }) },
      markFailed: async () => undefined,
      list: async () => [],
      getByRequestId: async () => byRequest.get(requestId) ?? null,
    },
    byRequest,
  }
}

test('同一 requestId 重复 start 不重复生成', async () => {
  const store = fakeStore()
  let ragCalls = 0
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => { ragCalls += 1; return { route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } } } } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  const emitted: any[] = []
  await service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted.push(e))
  store.byRequest.set(requestId, { id: 'am1', status: 'completed' })
  await service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted.push(e))
  assert.equal(ragCalls, 1)
  assert.ok(emitted.some((e) => e.event === 'started'))
})

test('cancel 后消息标记 cancelled 且广播事件', async () => {
  const store = fakeStore()
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async (input: any, hooks: any) => { await hooks.onDelta('部分文本'); return { route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } } } } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  const emitted: any[] = []
  const done = service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted.push(e))
  await service.cancel(requestId, userId)
  await done
  // cancel 返回时生成已停止：最终消息为 cancelled 且只广播一次
  assert.equal(store.events.filter((e) => e.type === 'cancelled').length, 1)
  assert.equal(emitted.filter((e) => e.event === 'cancelled').length, 1)
})

test('route 未指定时按问题路由 pet/rag', async () => {
  const store = fakeStore()
  let petCalled = false
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => ({ route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }) } as any,
    { chatPet: async () => { petCalled = true; return new ReadableStream({ start(c) { c.close() } }) } } as any,
    undefined as any,
  )
  await service.start({ userId, requestId: 'req-pet', question: '今天天气不错', forceRoute: undefined }, () => undefined)
  assert.equal(petCalled, true)
})
