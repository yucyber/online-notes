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
  const renameCalls: Array<{ userId: string; conversationId: string; title: string }> = []
  // 会话标题登记：模拟 renameIfDefault 的原子条件——仅标题仍为默认"新对话"时自动标题才生效。
  const titles: Record<string, string> = { c1: '新对话' }
  // create 调用次数：新建会话语义（无 conversationId / id 失效）断言用。
  let createCalls = 0
  return {
    events,
    activeRequestCalls,
    renameCalls,
    titles,
    get createCalls() { return createCalls },
    conversations: {
      // 新建会话语义：start 无 conversationId 或 id 失效时走 create（不复用最近 active 会话）。
      create: async () => { createCalls += 1; return { id: 'c1', isNew: true } },
      get: async (_u: string, id: string) => ({ id, title: titles[id] ?? '新对话', status: 'active' }),
      touch: async () => undefined,
      // 模拟服务端 renameIfDefault：标题已非默认（如用户手动改名）时不记录、不覆盖。
      renameIfDefault: async (userId: string, conversationId: string, title: string) => {
        if (titles[conversationId] === '新对话') {
          titles[conversationId] = title
          renameCalls.push({ userId, conversationId, title })
        }
      },
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

test('生成成功后自动标题：以问题前 24 字调用 renameIfDefault', async () => {
  // R=1 建议：成功 + 默认标题会话 → 自动标题收到截断后的问题前缀（fakeStore 记录 renameIfDefault 参数）。
  const store = fakeStore()
  const question = '这是一段超过二十四个字符的中文问题文本用来验证自动标题截断行为'
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => ({ route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }) } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  await service.start({ userId, requestId: 'req-title', question, forceRoute: 'rag' }, () => undefined)
  // 等生成到达终态：renameIfDefault 在 runGeneration 收尾（finish 前）执行，waitForTerminal resolve 后断言才稳定。
  await service.waitForTerminal('req-title')
  assert.equal(store.renameCalls.length, 1)
  assert.equal(store.renameCalls[0].conversationId, 'c1')
  assert.equal(store.renameCalls[0].title, question.slice(0, 24), '标题应为问题前 24 字（截断）')
})

test('取消的生成不触发自动标题', async () => {
  // R=1 建议：completed=false（取消）路径不得调用 renameIfDefault，避免失败问答污染会话标题。
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
  const done = service.start({ userId, requestId: 'req-title-cancel', question: 'q', forceRoute: 'rag' }, (e) => emitted.push(e))
  await new Promise((r) => setTimeout(r, 10))
  // cancel 等待生成真正停止（stop promise 在 finish 时 resolve），返回后自动标题路径已走完，可安全断言。
  const cancelPromise = service.cancel('req-title-cancel', userId)
  releaseRag()
  await cancelPromise
  await done
  assert.equal(store.renameCalls.length, 0, '取消路径不得自动重命名')
})

test('会话已有标题时自动标题不覆盖（get 路径成功也不改名）', async () => {
  // R=1 建议：conversationId 指定走 get 路径（无 isNew）；生成期间用户已手动改名 → renameIfDefault 条件不命中，标题保留。
  const store = fakeStore()
  store.titles.c1 = '用户手动改的标题'
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => ({ route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }) } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  await service.start({ userId, conversationId: 'c1', requestId: 'req-titled', question: 'q', forceRoute: 'rag' }, () => undefined)
  await service.waitForTerminal('req-titled')
  assert.equal(store.renameCalls.length, 0, '标题已非默认时不自动改名')
  assert.equal(store.titles.c1, '用户手动改的标题')
})

test('无 conversationId（新建会话空白态）时每次发消息都新建会话而非复用最近会话', async () => {
  // 回归：旧实现无 conversationId 走 ensure 复用最近 active，导致"新建会话"后的消息全部落入第一段会话，
  // 会话记录永远只有一段。修复后 start 应走 conversations.create 开启独立新会话。
  const store = fakeStore()
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => ({ route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }) } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  await service.start({ userId, requestId: 'req-fresh-1', question: 'q1', forceRoute: 'rag' }, () => undefined)
  await service.start({ userId, requestId: 'req-fresh-2', question: 'q2', forceRoute: 'rag' }, () => undefined)
  await service.waitForTerminal('req-fresh-2')
  assert.equal(store.createCalls, 2, '无会话连续发消息应各自新建独立会话')
})

test('conversationId 失效（get 返回 null）时新建会话而非复用最近会话', async () => {
  // 回归：id 指向已归档/删除/无权限会话时不得静默回退到最新 active（否则新消息落入无关旧会话），应开启新会话。
  let ensureCalled = false
  let createCalls = 0
  const conversations = {
    // ensure 若被调用说明仍走旧"复用最近会话"语义：置 throw 显式暴露回归。
    ensure: async () => { ensureCalled = true; throw new Error('ensure should not be used') },
    create: async () => { createCalls += 1; return { id: 'c2', isNew: true } },
    get: async () => null,
    touch: async () => undefined,
    renameIfDefault: async () => undefined,
    setActiveRequest: async () => undefined,
  }
  const messages = {
    appendUser: async () => ({ messageId: 'um1', seq: 1 }),
    createPlaceholder: async () => ({ messageId: 'am1', seq: 2 }),
    appendDelta: async () => undefined,
    finalize: async () => undefined,
    markCancelled: async () => undefined,
    markFailed: async () => undefined,
    list: async () => [],
    getByRequestId: async () => null,
  }
  const service = new AssistantGenerationService(
    conversations as any, messages as any,
    { streamRagAnswer: async () => ({ route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }) } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  const emitted: any[] = []
  await service.start({ userId, conversationId: 'c-stale', requestId: 'req-stale', question: 'q', forceRoute: 'rag' }, (e) => emitted.push(e))
  await service.waitForTerminal('req-stale')
  assert.equal(createCalls, 1, 'conversationId 失效时应新建会话')
  assert.equal(ensureCalled, false, '不得走 ensure 复用最近会话')
  assert.ok(emitted.some((e) => e.event === 'started' && e.data.conversationId === 'c2'))
})

test('生成进行中重连：attach 补发 resume 快照（全量 content）后续收后续 delta', async () => {
  // C 方案核心：刷新页面后用同 requestId 重新 POST chat，running.has 命中 attach，
  // attach 补发 resume 事件携带当前已生成全量 content，重连者以此为起点续收后续 delta，无内容断裂。
  const store = fakeStore()
  let releaseDelta2!: () => void
  const delta2Gate = new Promise<void>((resolve) => { releaseDelta2 = resolve })
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async (_input: any, hooks: any) => {
      await hooks.onDelta('hello ')
      await delta2Gate
      await hooks.onDelta('world')
      return { route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }
    } } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )

  const emitted1: any[] = []
  const done = service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted1.push(e))
  // 等第一个 delta 流出（onDelta('hello ') 完成）
  await new Promise((r) => setTimeout(r, 30))

  // 重连：同 requestId 重新 start，命中 running → attach
  const emitted2: any[] = []
  await service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted2.push(e))

  // 重连者应收到 resume 快照（全量已生成 content）
  const resumeEvent = emitted2.find((e) => e.event === 'resume')
  assert.ok(resumeEvent, '重连应补发 resume 快照事件')
  assert.equal(resumeEvent.data.content, 'hello ', 'resume 应含当前全量已生成 content')
  assert.equal(resumeEvent.data.assistantMessageId, 'am1', 'resume 应携带 assistantMessageId')

  // 放行第二个 delta：重连者应收到后续 delta
  releaseDelta2()
  // waitForTerminal 等生成真正结束（包含 runGeneration 内 onDelta world 的全部异步路径）
  await service.waitForTerminal(requestId)
  const deltaEvents2 = emitted2.filter((e: any) => e.event === 'delta')
  assert.ok(deltaEvents2.some((e) => e.data.text === 'world'), '重连者应续收 resume 后的 delta')
  assert.ok(emitted2.some((e) => e.event === 'complete'), '重连者应收到 complete')
})

test('生成已结束后重连：走 stale 路径补发 complete（而非重新生成）', async () => {
  // 生成结束后 running 已清，重连命中 getByRequestId → 终态消息 → 补发 complete，不重复生成。
  const store = fakeStore()
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => ({ route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }) } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  await service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, () => undefined)
  await service.waitForTerminal(requestId)
  // 模拟 DB 里该消息已是 completed（finalize 落库后的状态）
  store.byRequest.set(requestId, { id: 'am1', userId, role: 'assistant', status: 'completed', content: '完整回答', conversationId: 'c1', route: 'rag', citations: [], warnings: [] })
  const emitted2: any[] = []
  await service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted2.push(e))
  assert.ok(emitted2.some((e) => e.event === 'complete'), '终态重连应补发 complete')
  assert.equal(emitted2.some((e) => e.event === 'resume'), false, '终态重连不应发 resume')
})

test('complete 已广播但 finish 未执行时 attach 补发终态，不因错过 complete 而断流', async () => {
  // 「连续刷新两次断掉」根因回归：runGeneration 终态 emit 后、finish() 前仍有 DB 收尾 await
  // （finally 里 setActiveRequest(null)），此窗口 running 仍为 true。新 attach 订阅已错过 complete →
  // 连接随 finish 关闭但前端没收到终态 → 兜底标 failed。修复：终态先记录进 terminalEvents，attach 优先补发。
  const store = fakeStore()
  // 挂住 finally 的 setActiveRequest(null)：让 runGeneration 停在终态已广播、finish 未执行的窗口。
  let releaseCleanup!: () => void
  const cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve })
  const conversations = {
    ...store.conversations,
    setActiveRequest: async (_u: string, _c: string, requestId: string | null) => {
      // 首次写入 requestId（start 内）不挂；finally 清空（null）时挂住制造窗口。
      if (requestId === null) await cleanupGate
    },
  }
  const service = new AssistantGenerationService(
    conversations as any, store.messages as any,
    { streamRagAnswer: async (_input: any, hooks: any) => {
      await hooks.onDelta('内容一')
      await hooks.onDelta('内容二')
      return { route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }
    } } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  const emitted1: any[] = []
  const done = service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted1.push(e))
  // 等 runGeneration 走完 finalize + complete 广播，停在 finally 的 cleanupGate（窗口开启）
  await new Promise((r) => setTimeout(r, 60))

  // 窗口内 attach（模拟刷新重连撞进竞态）：应补发已广播的 complete，而非只发 resume 后断流
  const emitted2: any[] = []
  await service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted2.push(e))
  assert.ok(emitted2.some((e) => e.event === 'complete'), '窗口内 attach 应补发已广播的 complete')
  assert.equal(emitted2.some((e) => e.event === 'resume'), false, '终态已广播时不应再发 resume')

  // 放行清理：生成完整收尾
  releaseCleanup()
  await done
  assert.equal(emitted1.filter((e) => e.event === 'complete').length, 1, '原订阅者只收一次 complete')
})
