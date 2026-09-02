import { streamAssistantReply, fetchConversationMessages } from '@/lib/assistant-stream-client'
import { TextDecoder, TextEncoder } from 'node:util'

// jsdom 测试环境缺 Node 全局流 API，显式注入（与 ai-writer.spec.ts 同一惯例）
Object.assign(global, { TextDecoder, TextEncoder })

// 用可控 chunk 序列模拟 SSE 响应体：每个 chunk 可能包含 0..N 个完整块，也可能跨块边界
function sseResponse(chunks: string[], status = 200): Response {
  let index = 0
  const encoder = new TextEncoder()
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => JSON.parse(chunks.join('')),
    body: {
      getReader: () => ({
        read: async () => index < chunks.length
          ? { done: false, value: encoder.encode(chunks[index++]) }
          : { done: true, value: undefined },
      }),
    },
  } as unknown as Response
}

describe('streamAssistantReply', () => {
  const originalFetch = global.fetch

  afterEach(() => { global.fetch = originalFetch })

  test('解析 started/status/delta/complete 事件并依次回调', async () => {
    const calls: string[] = []
    global.fetch = jest.fn(async (_url: string, init?: any) => {
      // 幂等键豁免守护：/api/assistant/chat 不得携带 Idempotency-Key（后端 IdempotencyInterceptor 响应级去重）
      expect(init?.headers?.['Idempotency-Key']).toBeUndefined()
      return sseResponse([
        'event: started\ndata: {"conversationId":"c1","userMessageId":"um1","assistantMessageId":"am1","requestId":"r1"}\n\n',
        'event: status\ndata: {"stage":"routing","message":"小助手正在回复"}\n\n',
        'event: delta\ndata: {"text":"你"}\n\n',
        'event: delta\ndata: {"text":"好"}\n\n',
        'event: complete\ndata: {"messageId":"am1","route":"pet","citations":[],"warnings":[]}\n\n',
      ])
    }) as any

    await streamAssistantReply({ requestId: 'r1', question: 'hi' }, {
      onStarted: () => calls.push('started'),
      onStatus: () => calls.push('status'),
      onDelta: (text) => calls.push(`delta:${text}`),
      onComplete: (data) => calls.push(`complete:${data.messageId}`),
    })

    expect(calls).toEqual(['started', 'status', 'delta:你', 'delta:好', 'complete:am1'])
    expect(fetch).toHaveBeenCalledWith('/api/assistant/chat', expect.objectContaining({ method: 'POST' }))
  })

  test('事件块跨 chunk 边界时仍能完整解析', async () => {
    const calls: string[] = []
    // 第一个事件被拆进两个 chunk：块头与 data 行不在同一 chunk 里
    global.fetch = jest.fn(async () => sseResponse([
      'event: delta\ndata: {"tex',
      't":"你"}\n\nevent: complete\ndata: {"messageId":"am1","route":"pet","citations":[],"warnings":[]}\n\n',
    ])) as any

    await streamAssistantReply({ requestId: 'r1', question: 'hi' }, {
      onDelta: (text) => calls.push(`delta:${text}`),
      onComplete: () => calls.push('complete'),
    })

    expect(calls).toEqual(['delta:你', 'complete'])
  })

  test('cancelled 与 error 事件分别回调 onCancelled/onError', async () => {
    const cancelled: string[] = []
    const errors: string[] = []
    global.fetch = jest.fn(async () => sseResponse([
      'event: cancelled\ndata: {"messageId":"am1","text":"部分文本","reason":"user_stopped"}\n\n',
      'event: error\ndata: {"code":"PROVIDER_UNAVAILABLE","message":"回答生成中断","retryable":true}\n\n',
    ])) as any

    await streamAssistantReply({ requestId: 'r1', question: 'hi' }, {
      onCancelled: (data) => cancelled.push(`${data.reason}:${data.text}`),
      onError: (code, message) => errors.push(`${code}:${message}`),
    })

    expect(cancelled).toEqual(['user_stopped:部分文本'])
    expect(errors).toEqual(['PROVIDER_UNAVAILABLE:回答生成中断'])
  })

  test('非 2xx 时解析错误 JSON 并抛出稳定错误文案', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({ error: '请求过于频繁' }),
    }) as unknown as Response) as any

    await expect(streamAssistantReply({ requestId: 'r1', question: 'hi' }, {})).rejects.toThrow('请求过于频繁')
  })

  test('AbortSignal 中断时静默结束不抛错', async () => {
    let aborted = false
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    global.fetch = jest.fn(async (_url: string, init?: any) => {
      const signal = init?.signal as AbortSignal
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: {
          getReader: () => ({
            read: async () => {
              // 模拟 signal abort 后底层流 reject AbortError（fetch 标准行为）
              if (!aborted && signal?.aborted) { aborted = true; throw abortError }
              return { done: true, value: undefined }
            },
          }),
        },
      } as unknown as Response
    }) as any

    const controller = new AbortController()
    controller.abort()
    await expect(streamAssistantReply({ requestId: 'r1', question: 'hi' }, {}, controller.signal)).resolves.toBeUndefined()
    expect(aborted).toBe(true)
  })

  test('fetch 请求阶段 Abort 时静默结束不抛错', async () => {
    // signal 在 fetch 尚未 resolve 时已 abort：原生 fetch 直接 reject AbortError，不得抛给调用方
    global.fetch = jest.fn(async () => { throw new DOMException('The operation was aborted.', 'AbortError') }) as any

    const controller = new AbortController()
    controller.abort()
    await expect(streamAssistantReply({ requestId: 'r1', question: 'hi' }, {}, controller.signal)).resolves.toBeUndefined()
  })
})

describe('fetchConversationMessages', () => {
  const originalFetch = global.fetch

  afterEach(() => { global.fetch = originalFetch })

  test('代理路由已解包时直接返回 items', async () => {
    const items = [{ id: 'm1', conversationId: 'c1', seq: 1, role: 'user', route: 'pet', content: 'hi', status: 'completed', citations: [], warnings: [] }]
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ items }) }) as unknown as Response) as any

    const result = await fetchConversationMessages('c1')

    expect(result.items).toEqual(items)
    expect(fetch).toHaveBeenCalledWith('/api/assistant/conversations/c1/messages', expect.objectContaining({ cache: 'no-store' }))
  })

  test('携带 afterSeq 并兼容后端信封解包', async () => {
    const items = [{ id: 'm2', conversationId: 'c1', seq: 2, role: 'assistant', route: 'pet', content: 'hello', status: 'completed', citations: [], warnings: [] }]
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: { items } }) }) as unknown as Response) as any

    const result = await fetchConversationMessages('c1', { afterSeq: 1 })

    expect(result.items).toEqual(items)
    expect(fetch).toHaveBeenCalledWith('/api/assistant/conversations/c1/messages?afterSeq=1', expect.anything())
  })

  test('非 2xx 时抛出稳定错误文案', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, statusText: 'Server Error' }) as unknown as Response) as any

    await expect(fetchConversationMessages('c1')).rejects.toThrow('会话消息加载失败')
  })
})
