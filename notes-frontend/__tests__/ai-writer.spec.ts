import { streamAIWriter } from '@/lib/ai-writer'
import { TextDecoder, TextEncoder } from 'util'

Object.assign(global, { TextDecoder, TextEncoder })

describe('streamAIWriter', () => {
  const originalFetch = global.fetch

  afterEach(() => { global.fetch = originalFetch })

  const response = (contentType: string, chunks: string[]) => ({
    ok: true,
    headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null },
    json: async () => JSON.parse(chunks.join('')),
    body: {
      getReader: () => {
        let index = 0
        return { read: async () => index < chunks.length
          ? { done: false, value: new TextEncoder().encode(chunks[index++]) }
          : { done: true, value: undefined } }
      },
    },
  } as unknown as Response)

  test('普通 JSON envelope 只输出 data.text', async () => {
    global.fetch = jest.fn().mockResolvedValue(response('application/json', [
      JSON.stringify({ code: 0, message: 'OK', data: { text: '润色结果' }, requestId: 'rid', timestamp: 'now' }),
    ]))
    const chunks: string[] = []

    await streamAIWriter({ context: '原文', type: 'polish', onChunk: (text) => chunks.push(text) })

    expect(chunks.join('')).toBe('润色结果')
  })

  test('纯文本流保持逐块输出', async () => {
    global.fetch = jest.fn().mockResolvedValue(response('text/event-stream', ['流式', '结果']))
    const chunks: string[] = []

    await streamAIWriter({ context: '原文', type: 'summary', onChunk: (text) => chunks.push(text) })

    expect(chunks.join('')).toBe('流式结果')
  })
})
