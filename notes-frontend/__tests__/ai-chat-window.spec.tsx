import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TextDecoder, TextEncoder } from 'node:util'
import ChatWindow from '@/components/ai/ChatWindow'

const mockAppToastError = jest.fn()
const mockAppToastDismiss = jest.fn()
const mockFetch = jest.fn()

jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children: string }) => <>{children}</> }))

jest.mock('@/lib/app-toast', () => ({
  appToast: {
    error: (...args: unknown[]) => mockAppToastError(...args),
    dismiss: (...args: unknown[]) => mockAppToastDismiss(...args),
  },
}))

// jsdom 测试环境缺 Node 全局流 API，显式注入（与 assistant-stream-client.spec.ts 同一惯例）
Object.assign(global, { TextDecoder, TextEncoder })

// 用可控 chunk 序列模拟 SSE 响应体
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

describe('ChatWindow 统一流式协议', () => {
  beforeEach(() => {
    localStorage.clear()
    mockAppToastError.mockReset()
    mockAppToastDismiss.mockReset()
    mockFetch.mockReset()
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: mockFetch })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
  })

  it('pet 消息走统一协议流式呈现并持久化当前会话 ID', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/messages')) return { ok: true, status: 200, json: async () => ({ items: [] }) } as unknown as Response
      return sseResponse([
        'event: started\ndata: {"conversationId":"c1","userMessageId":"um1","assistantMessageId":"am1","requestId":"r1"}\n\n',
        'event: delta\ndata: {"text":"你"}\n\n',
        'event: delta\ndata: {"text":"好"}\n\n',
        'event: complete\ndata: {"messageId":"am1","route":"pet","citations":[],"warnings":[]}\n\n',
      ])
    })

    render(<ChatWindow isOpen onClose={() => undefined} />)
    const input = screen.getByPlaceholderText('问问小助手…')
    fireEvent.change(input, { target: { value: '今天心情不错' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await screen.findByText('你好')
    expect(screen.getByText('轻松聊聊')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith('/api/assistant/chat', expect.objectContaining({ method: 'POST' }))
    expect(localStorage.getItem('assistant_current_conversation_id')).toBe('c1')
  })

  it('请求失败后标记失败态并可从 Toast 以新 requestId 重新回答', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network unavailable'))
      .mockImplementation(async (url: string) => {
        if (String(url).includes('/messages')) return { ok: true, status: 200, json: async () => ({ items: [] }) } as unknown as Response
        return sseResponse([
          'event: started\ndata: {"conversationId":"c1","userMessageId":"um1","assistantMessageId":"am1","requestId":"r2"}\n\n',
          'event: delta\ndata: {"text":"重试成功"}\n\n',
          'event: complete\ndata: {"messageId":"am1","route":"pet","citations":[],"warnings":[]}\n\n',
        ])
      })

    render(<ChatWindow isOpen onClose={() => undefined} />)
    const input = screen.getByPlaceholderText('问问小助手…')
    fireEvent.change(input, { target: { value: '继续生成' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByText('回答生成中断，请重试。')).toBeInTheDocument()
    expect(mockAppToastError).toHaveBeenCalledTimes(1)
    expect(mockAppToastError).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^assistant:/),
      title: '小助手请求失败',
      persistent: true,
      action: expect.objectContaining({ label: '重新回答' }),
    }))

    await act(async () => {
      mockAppToastError.mock.calls[0][0].action.onClick()
    })

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('重试成功')).toBeInTheDocument()
  })

  it('生成中点停止调用 cancel 端点且不携带 Idempotency-Key', async () => {
    // /chat 的流保持打开：先发 started + delta，等 cancel 后才下发 cancelled 事件
    let releaseCancelled!: () => void
    const cancelledGate = new Promise<void>((resolve) => { releaseCancelled = resolve })
    const encoder = new TextEncoder()
    const chunks = [
      'event: started\ndata: {"conversationId":"c1","userMessageId":"um1","assistantMessageId":"am1","requestId":"r1"}\n\n',
      'event: delta\ndata: {"text":"部分"}\n\n',
    ]
    let index = 0
    let cancelledSent = false
    const reader = {
      read: async () => {
        if (index < chunks.length) return { done: false, value: encoder.encode(chunks[index++]) }
        await cancelledGate
        if (!cancelledSent) {
          cancelledSent = true
          return { done: false, value: encoder.encode('event: cancelled\ndata: {"messageId":"am1","text":"部分","reason":"user_stopped"}\n\n') }
        }
        return { done: true, value: undefined }
      },
    }
    mockFetch.mockImplementation(async (url: string, init?: any) => {
      if (String(url).includes('/cancel')) {
        // 幂等键豁免守护：cancel 端点不得携带 Idempotency-Key
        expect(init?.headers?.['Idempotency-Key']).toBeUndefined()
        return { ok: true, status: 200, json: async () => ({ cancelled: true }) } as unknown as Response
      }
      if (String(url).includes('/messages')) return { ok: true, status: 200, json: async () => ({ items: [] }) } as unknown as Response
      return { ok: true, status: 200, statusText: 'OK', body: { getReader: () => reader } } as unknown as Response
    })

    render(<ChatWindow isOpen onClose={() => undefined} />)
    const input = screen.getByPlaceholderText('问问小助手…')
    fireEvent.change(input, { target: { value: '今天心情不错' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await screen.findByText('部分')
    fireEvent.click(screen.getByLabelText('停止生成'))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/assistant/generations/'),
      expect.objectContaining({ method: 'POST' }),
    ))
    releaseCancelled()
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).not.toBeInTheDocument())
  })

  it('新建对话清空界面并删除本地会话键', async () => {
    localStorage.setItem('assistant_current_conversation_id', 'c1')
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/messages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'm1', conversationId: 'c1', seq: 1, role: 'assistant', route: 'pet', content: '旧消息', status: 'completed', citations: [], warnings: [], createdAt: '2026-09-01T00:00:00.000Z' }],
          }),
        } as unknown as Response
      }
      throw new Error('unexpected call')
    })

    render(<ChatWindow isOpen onClose={() => undefined} />)
    await screen.findByText('旧消息')
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    expect(screen.queryByText('旧消息')).not.toBeInTheDocument()
    expect(screen.getByText('今天想聊点什么？')).toBeInTheDocument()
    expect(localStorage.getItem('assistant_current_conversation_id')).toBeNull()
  })
})
