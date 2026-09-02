import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantGenerationService } from '../src/modules/assistant/assistant-generation.service'

test('retry 占位消息携带 retryOfMessageId', async () => {
  const calls: any[] = []
  const store = {
    conversations: {
      // brief 原 fakeStore 缺 get/setActiveRequest：当前 start 在指定 conversationId 时会调 get，
      // start 与 runGeneration finally 分别写/清空会话 activeRequestId，按 assistant-generation.test.ts 的 fakeStore 补齐。
      get: async () => ({ id: 'c1', title: 't', status: 'active' }),
      ensure: async () => ({ id: 'c1', isNew: false }),
      touch: async () => undefined,
      renameIfDefault: async (u: string, id: string, title: string) => { calls.push({ type: 'renameIfDefault', title }) },
      setActiveRequest: async () => undefined,
    },
    messages: {
      appendUser: async () => ({ messageId: 'um1', seq: 1 }),
      createPlaceholder: async (u: string, cid: string, route: string, requestId?: string, retryOf?: string) => { calls.push({ type: 'placeholder', retryOf }); return { messageId: 'am2', seq: 3 } },
      appendDelta: async () => undefined,
      finalize: async () => undefined,
      markCancelled: async () => undefined,
      markFailed: async () => undefined,
      list: async () => [],
      getByRequestId: async () => null,
    },
  }
  const service = new AssistantGenerationService(store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => ({ route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }) } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  await service.start({ userId: 'u1', conversationId: 'c1', requestId: 'req-2', question: '再问一次', forceRoute: 'rag', retryOfMessageId: 'am1' }, () => undefined)
  assert.equal(calls.some((c) => c.type === 'placeholder' && c.retryOf === 'am1'), true)
})
