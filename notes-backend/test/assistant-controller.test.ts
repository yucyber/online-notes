import { test } from 'node:test'
import assert = require('node:assert/strict')
import { BadRequestException } from '@nestjs/common'
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

test('export 端点校验会话归属并把会话+消息写为 NDJSON 附件', async () => {
  const conversations = {
    get: async () => ({ id: 'c1', title: 'P3 设计', status: 'active', updatedAt: '2026-09-01T02:00:00.000Z' }),
  }
  const messages = {
    list: async () => [],
    listAll: async () => [
      { id: 'm1', conversationId: 'c1', seq: 1, role: 'user', route: 'rag', content: '结论？', status: 'completed', citations: [], createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'm2', conversationId: 'c1', seq: 2, role: 'assistant', route: 'rag', content: '统一入口 [E1]', status: 'completed', citations: [{ evidenceId: 'E1', noteId: 'n1', chunkId: 'c1', headingPath: [] }], createdAt: '2026-09-01T00:01:00.000Z' },
    ],
  }
  const controller = new AssistantController({} as any, messages as any, conversations as any, {} as any)
  let written = ''
  const headers: Record<string, string> = {}
  const res: any = {
    setHeader: (k: string, v: string) => { headers[k] = v },
    write: (chunk: string) => { written += chunk },
    end: () => { res.ended = true },
    writableEnded: false,
    ended: false,
  }
  await controller.exportConversation('c1', res, { user: { id: 'u1' } } as any)
  assert.equal(headers['Content-Type'], 'application/x-ndjson; charset=utf-8')
  assert.equal(headers['Content-Disposition'], 'attachment; filename="assistant-c1.jsonl"')
  assert.equal(res.ended, true)
  const lines = written.split('\n').filter(Boolean)
  assert.equal(lines.length, 4)
  assert.ok(lines[0].includes('"type":"conversation"') && lines[0].includes('"createdAt":"2026-09-01T02:00:00.000Z"'))
  assert.ok(lines[1].includes('"type":"message"') && lines[1].includes('"seq":1'))
  assert.ok(lines[2].includes('"type":"message"') && lines[2].includes('"seq":2'))
  assert.ok(lines[3].includes('"type":"citation"') && lines[3].includes('"messageSeq":2'))
})

test('export 端点会话不存在或不属于该用户时抛 404', async () => {
  const conversations = { get: async () => null }
  const messages = { list: async () => [], listAll: async () => [] }
  const controller = new AssistantController({} as any, messages as any, conversations as any, {} as any)
  await assert.rejects(
    () => controller.exportConversation('c1', {} as any, { user: { id: 'u1' } } as any),
    (error: any) => error?.name === 'NotFoundException' || /会话不存在/.test(String(error?.message ?? error)),
  )
})

test('管理端点无认证用户时抛 400（rename/archive/unarchive/delete/branch/checkpoint/cancel/settings 同守门）', async () => {
  const controller = new AssistantController({} as any, {} as any, {} as any, {} as any)
  const noUser = undefined as any
  await assert.rejects(() => controller.renameConversation('c1', '新标题', noUser), BadRequestException)
  await assert.rejects(() => controller.archive('c1', noUser), BadRequestException)
  await assert.rejects(() => controller.unarchive('c1', noUser), BadRequestException)
  await assert.rejects(() => controller.deleteConversation('c1', noUser), BadRequestException)
  await assert.rejects(() => controller.branch('c1', 5, noUser), BadRequestException)
  await assert.rejects(() => controller.checkpoint('c1', noUser), BadRequestException)
  await assert.rejects(() => controller.cancel('r1', noUser), BadRequestException)
  await assert.rejects(() => controller.listMessages('c1', undefined, undefined, noUser), BadRequestException)
  await assert.rejects(() => controller.updateConversationSettings('c1', { memoryEnabled: false }, noUser), BadRequestException)
})

test('settings 端点把 PATCH body 的 settings 透传给会话设置更新', async () => {
  // R1-4：正常路径断言——controller 不做多余加工，settings 未提供（undefined body）时按空对象透传。
  const calls: Array<{ id: string; settings: any }> = []
  const conversations = {
    updateSettings: async (_userId: string, id: string, settings: any) => {
      calls.push({ id, settings })
      return { memoryEnabled: settings.memoryEnabled !== false, temporary: Boolean(settings.temporary) }
    },
  }
  const controller = new AssistantController({} as any, {} as any, conversations as any, {} as any)
  const user = { user: { id: 'u1' } } as any
  const result = await controller.updateConversationSettings('c1', { memoryEnabled: false, temporary: true } as any, user)
  assert.deepEqual(result, { memoryEnabled: false, temporary: true })
  await controller.updateConversationSettings('c1', undefined as any, user)
  assert.deepEqual(calls[1].settings, {}, 'settings 缺省时透传空对象，由 service 保持原值')
})
