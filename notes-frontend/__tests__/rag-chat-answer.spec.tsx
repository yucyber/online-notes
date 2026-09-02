import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TextDecoder, TextEncoder } from 'node:util'
import ChatWindow from '@/components/ai/ChatWindow'

jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children: string }) => <>{children}</> }))
jest.mock('@/lib/app-toast', () => ({ appToast: { error: jest.fn(), dismiss: jest.fn() } }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

// jsdom 测试环境缺 Node 全局流 API，显式注入（与 assistant-stream-client.spec.ts 同一惯例）
Object.assign(global, { TextDecoder, TextEncoder })

// 用可控 chunk 序列模拟 SSE 响应体：started → status → delta → complete
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

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
})

test('发送检索问题后流式呈现回答并在完成后显示引用与警告', async () => {
  const fetchMock = jest.fn(async (url: string) => {
    if (String(url).includes('/messages')) return { ok: true, status: 200, json: async () => ({ items: [] }) } as unknown as Response
    return sseResponse([
      'event: started\ndata: {"conversationId":"c1","userMessageId":"um1","assistantMessageId":"am1","requestId":"r1"}\n\n',
      'event: status\ndata: {"stage":"routing","message":"正在检索你的笔记"}\n\n',
      'event: delta\ndata: {"text":"结论 [E1]"}\n\n',
      'event: complete\ndata: {"messageId":"am1","route":"rag","citations":[{"evidenceId":"E1","noteId":"n1","noteTitle":"React","chunkId":"c1","headingPath":[],"excerpt":"Diff"}],"warnings":[],"planSummary":{"intent":"explain","tools":[],"graphHops":0,"rerankApplied":false}}\n\n',
    ])
  }) as jest.Mock
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock })

  render(<ChatWindow isOpen onClose={() => undefined} />)
  const input = screen.getByPlaceholderText('问问小助手…')
  fireEvent.change(input, { target: { value: '帮我找之前的 React Diff 笔记' } })
  fireEvent.keyDown(input, { key: 'Enter' })

  await screen.findByText(/结论 \[E1\]/)
  await screen.findByText('React')
  expect(fetchMock).toHaveBeenCalledWith('/api/assistant/chat', expect.objectContaining({ method: 'POST' }))
  expect(localStorage.getItem('assistant_current_conversation_id')).toBe('c1')
})

test('挂载时从服务端恢复当前会话消息', async () => {
  localStorage.setItem('assistant_current_conversation_id', 'c1')
  const fetchMock = jest.fn(async (url: string) => {
    if (String(url).includes('/messages')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{
            id: 'm1', conversationId: 'c1', seq: 1, role: 'assistant', route: 'rag',
            content: '之前保存的回答 [E1]', status: 'completed',
            citations: [{ evidenceId: 'E1', noteId: 'n1', noteTitle: 'React', chunkId: 'c1', headingPath: [], excerpt: 'Diff' }],
            warnings: [], createdAt: '2026-09-01T00:00:00.000Z',
          }],
        }),
      } as unknown as Response
    }
    throw new Error('unexpected call')
  }) as jest.Mock
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock })

  render(<ChatWindow isOpen onClose={() => undefined} />)
  expect(await screen.findByText('之前保存的回答 [E1]')).toBeInTheDocument()
  expect(screen.getByText('基于你的笔记')).toBeInTheDocument()
  expect(await screen.findByText('React')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith('/api/assistant/conversations/c1/messages', expect.objectContaining({ cache: 'no-store' }))
})
