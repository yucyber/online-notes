import { test } from 'node:test'
import assert = require('node:assert/strict')
import { EventEmitter } from 'node:events'
import { AssistantGenerationService } from '../src/modules/assistant/assistant-generation.service'

const userId = 'u1'
const requestId = 'req-1'

function fakeStore() {
  const byRequest = new Map<string, any>()
  const events: any[] = []
  const activeRequestCalls: Array<{ userId: string; conversationId: string; requestId: string | null }> = []
  return {
    events,
    activeRequestCalls,
    conversations: {
      ensure: async () => ({ id: 'c1', isNew: true }),
      get: async () => ({ id: 'c1', title: 't', status: 'active' }),
      touch: async () => undefined,
      // 记录 activeRequestId 写操作（start 写入 requestId、runGeneration finally 清空 null），供断言生成生命周期。
      setActiveRequest: async (userId: string, conversationId: string, requestId: string | null) => {
        activeRequestCalls.push({ userId, conversationId, requestId })
      },
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
      markFailed: async (u: string, id: string, content: string) => { events.push({ type: 'failed', content }) },
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

test('重放残留非终态消息（服务重启后）标记 failed 并补发 error 终态', async () => {
  // I-2 修复回归：重启后 emitters/running 为空，残留 streaming 消息不再 attach 空转，
  // 落库 failed（保留已流内容）并补发 error，DB 消息不会永久 streaming。
  const store = fakeStore()
  let ragCalls = 0
  store.byRequest.set(requestId, { id: 'am1', userId, role: 'assistant', status: 'streaming', content: '半截内容', conversationId: 'c1', route: 'rag', citations: [], warnings: [] })
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => { ragCalls += 1; return { route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } } } } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  const emitted: any[] = []
  await service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted.push(e))
  assert.equal(ragCalls, 0, 'stale 消息不得重新生成')
  assert.ok(emitted.some((e) => e.event === 'error' && e.data.code === 'GENERATION_INTERRUPTED'))
  assert.equal(emitted.some((e) => e.event === 'complete'), false)
  // DB 消息必须被落库标记 failed（保留已流内容），不再永久 streaming。
  assert.equal(store.events.some((e) => e.type === 'failed' && e.content === '半截内容'), true)
})

test('重放只剩 user 提问（appendUser 与 createPlaceholder 之间崩溃）不把提问当回答', async () => {
  // M-5 修复回归：崩溃窗口 getByRequestId 只命中 user 消息，重放不得补发 complete（否则前端把用户提问渲染为回答）。
  const store = fakeStore()
  let ragCalls = 0
  store.byRequest.set(requestId, { id: 'um1', userId, role: 'user', status: 'completed', content: 'q', conversationId: 'c1', route: 'rag', citations: [], warnings: [] })
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => { ragCalls += 1; return { route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } } } } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  const emitted: any[] = []
  await service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted.push(e))
  assert.equal(ragCalls, 0)
  assert.equal(emitted.some((e) => e.event === 'complete'), false, 'user-only 不得补发 complete')
  assert.ok(emitted.some((e) => e.event === 'error'))
})

test('生成结束后清空会话 activeRequestId', async () => {
  // R=1 评审补充：start 写入 requestId、runGeneration finally 清空 null，删除会话时不会误取消已结束的生成。
  const store = fakeStore()
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => ({ route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }) } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  await service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, () => undefined)
  // 等生成到达终态：runGeneration finally 先清空 activeRequestId 再 finish，waitForTerminal resolve 后断言才稳定。
  await service.waitForTerminal(requestId)
  const calls = store.activeRequestCalls
  assert.ok(calls.some((c) => c.requestId === requestId), 'start 应写入会话 activeRequestId')
  assert.equal(calls[calls.length - 1].requestId, null, '生成结束后应清空 activeRequestId')
})
