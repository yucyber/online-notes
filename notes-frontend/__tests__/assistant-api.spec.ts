import { renameConversation, setConversationStatus, searchAssistant, branchConversation, exportConversation } from '@/lib/assistant-api'

// jsdom 环境无 Node 全局 Fetch API（Response），沿用仓库既有惯例（assistant-stream-client.spec.ts 等）以普通对象模拟响应体
function jsonResponse(body: string, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body) } as unknown as Response
}

function blobResponse(): Response {
  return { ok: true, status: 200, blob: async () => new Blob(['{}']) } as unknown as Response
}

test('renameConversation 发送 PATCH', async () => {
  global.fetch = jest.fn(async () => jsonResponse('{}')) as any
  await renameConversation('c1', '新标题')
  expect(fetch).toHaveBeenCalledWith('/api/assistant/conversations/c1', expect.objectContaining({ method: 'PATCH' }))
})

test('setConversationStatus 发送对应动作', async () => {
  global.fetch = jest.fn(async () => jsonResponse('{}')) as any
  await setConversationStatus('c1', 'delete')
  expect(fetch).toHaveBeenCalledWith('/api/assistant/conversations/c1/delete', expect.objectContaining({ method: 'POST' }))
})

test('searchAssistant 解包 data', async () => {
  global.fetch = jest.fn(async () => jsonResponse(JSON.stringify({ data: { conversations: [{ id: 'c1', title: 'P3', updatedAt: '' }], messages: [] } }))) as any
  const result = await searchAssistant('P3')
  expect(result.conversations[0].id).toBe('c1')
})

test('branchConversation 发送 POST 并解包', async () => {
  global.fetch = jest.fn(async () => jsonResponse(JSON.stringify({ data: { id: 'b1' } }))) as any
  const result = await branchConversation('c1', 3)
  expect(fetch).toHaveBeenCalledWith('/api/assistant/conversations/c1/branch', expect.objectContaining({ method: 'POST' }))
  expect(result.id).toBe('b1')
})

test('exportConversation 触发带文件名下载', async () => {
  const revoke = jest.fn()
  URL.createObjectURL = jest.fn(() => 'blob:url')
  URL.revokeObjectURL = revoke
  // jsdom 无 document.createElement 拦截时用 spy
  const anchorSpy = jest.spyOn(document, 'createElement').mockReturnValueOnce({ href: '', download: '', click: jest.fn() } as any)
  global.fetch = jest.fn(async () => blobResponse()) as any
  await exportConversation('c1')
  expect(anchorSpy.mock.results[0].value.download).toBe('assistant-c1.jsonl')
  anchorSpy.mockRestore()
})
