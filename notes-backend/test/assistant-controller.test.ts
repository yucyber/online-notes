import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantController } from '../src/modules/assistant/assistant.controller'

test('chat 端点把生成事件写出为 SSE 并保持打开直到终态再结束响应', async () => {
  const generation = {
    start: async (_input: any, emit: (event: any) => void) => {
      emit({ event: 'started', data: { conversationId: 'c1', userMessageId: 'um1', assistantMessageId: 'am1', requestId: 'r1' } })
      // start 模拟后台续跑：设置完成后返回，流仍在进行中。
    },
    // waitForTerminal 模拟终态到达后结束：resolve 前响应不得 end()。
    waitForTerminal: async () => {
      await new Promise((r) => setTimeout(r, 10))
      // 终态事件在 waitForTerminal resolve 之前经 emit 写出（真实实现由生成循环发出）。
    },
    cancel: async () => undefined,
  }
  const messages = { list: async () => [] }
  const controller = new AssistantController(generation as any, messages as any, {} as any, {} as any)
  let written = ''
  let endedAt = -1
  const res: any = {
    setHeader: (k: string, v: string) => { res.headers = { ...(res.headers || {}), [k]: v } },
    write: (chunk: string) => { written += chunk },
    end: () => { res.ended = true; endedAt = Date.now() },
    writableEnded: false,
    // mock 初始未结束状态：让 hold-open 断言（waitForTerminal 未 resolve 时响应仍未 end）可被严格相等断言正确判定。
    ended: false,
  }
  const p = controller.chat({ requestId: 'r1', question: 'hi', forceRoute: 'pet' }, res, { user: { id: 'u1' } } as any)
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(res.ended, false, 'waitForTerminal 未 resolve 前响应必须保持打开')
  await p
  assert.equal(res.headers['Content-Type'], 'text/event-stream; charset=utf-8')
  assert.ok(written.includes('event: started'))
  assert.equal(res.ended, true)
})

test('cancel 端点返回取消实际结果（透传 not_found/not_running/cancelled）', async () => {
  // M-4 修复：controller 不再固定回 cancelled:true，如实透传服务层结果，API 语义真实。
  const generation = {
    start: async () => undefined,
    cancel: async () => ({ cancelled: false, reason: 'not_running' as const }),
    waitForTerminal: async () => undefined,
  }
  const controller = new AssistantController(generation as any, { list: async () => [] } as any, {} as any, {} as any)
  const result = await controller.cancel('r1', { user: { id: 'u1' } } as any)
  assert.deepEqual(result, { cancelled: false, reason: 'not_running' })
})
