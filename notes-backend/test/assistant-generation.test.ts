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
      // 模拟落库：占位消息创建后 (userId, requestId) 即可被查询到（真实仓储 create 后立即可见）。
      createPlaceholder: async (u: string, _c: string, _route: string, r?: string) => {
        if (r) byRequest.set(r, { id: 'am1', userId: u, status: 'pending' })
        return { messageId: 'am1', seq: 2 }
      },
      appendDelta: async (u: string, id: string, content: string) => { events.push({ type: 'delta', content }) },
      finalize: async (u: string, id: string, payload: any) => { events.push({ type: 'finalize', ...payload }) },
      markCancelled: async (u: string, id: string, content: string) => { events.push({ type: 'cancelled', content }) },
      markFailed: async () => undefined,
      list: async () => [],
      // (userId, requestId) 联合查询：requestId 命中但 userId 不匹配视为不存在（跨用户不可见）。
      getByRequestId: async (u: string, r: string) => {
        const doc = byRequest.get(r)
        return doc && doc.userId === u ? doc : null
      },
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
  store.byRequest.set(requestId, { userId, id: 'am1', status: 'completed' })
  await service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted.push(e))
  assert.equal(ragCalls, 1)
  assert.ok(emitted.some((e) => e.event === 'started'))
})

test('cancel 后消息标记 cancelled 且广播事件', async () => {
  const store = fakeStore()
  let releaseRag!: () => void
  const ragGate = new Promise<void>((resolve) => { releaseRag = resolve })
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async (_input: any, hooks: any) => {
      // 生成挂起在 gate 上：cancel 到达时消息已落库且生成仍在进行。
      await ragGate
      await hooks.onDelta('部分文本')
      return { route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }
    } } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  const emitted: any[] = []
  const done = service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted.push(e))
  await new Promise((r) => setTimeout(r, 10))
  // cancel 等待生成真正停止；先发起（挂起在 stop promise 上），再放行 gate，
  // 生成循环在下一个 delta 处发现取消标记 → cancelled 落库并广播 → stop resolve。
  const cancelPromise = service.cancel(requestId, userId)
  releaseRag()
  await cancelPromise
  await done
  // cancel 返回时生成已停止：最终消息为 cancelled 且只广播一次
  assert.equal(store.events.filter((e) => e.type === 'cancelled').length, 1)
  assert.equal(emitted.filter((e) => e.event === 'cancelled').length, 1)
})

test('cancel 校验请求归属：他人 userId 无法取消生成', async () => {
  const store = fakeStore()
  let releaseRag!: () => void
  const ragGate = new Promise<void>((resolve) => { releaseRag = resolve })
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async (_input: any, hooks: any) => {
      await ragGate
      await hooks.onDelta('部分文本')
      return { route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }
    } } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  const emitted: any[] = []
  const done = service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted.push(e))
  await new Promise((r) => setTimeout(r, 10))
  // 他人 userId 调用 cancel：(userId, requestId) 查无此人 → 静默返回，不写取消标记、不广播、不等待。
  await service.cancel(requestId, 'other-user')
  releaseRag()
  await done
  // cancel 静默返回（不等 stop），后台生成仍在收尾：等 runGeneration 完成最终落库后再断言。
  await new Promise((r) => setTimeout(r, 30))
  // 生成未被取消：最终落库 completed（finalize），全程无 cancelled 事件。
  assert.equal(store.events.some((e) => e.type === 'cancelled'), false)
  assert.ok(store.events.some((e) => e.type === 'finalize'))
  assert.equal(emitted.some((e) => e.event === 'cancelled'), false)
  assert.ok(emitted.some((e) => e.event === 'complete'))
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
