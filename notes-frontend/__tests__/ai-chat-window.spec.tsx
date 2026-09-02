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

  it('恢复会话慢于首次发送时不覆盖新会话消息', async () => {
    // 挂载恢复 c1 的请求被 gate 挂起，用户先发送触发 chat SSE（onStarted 新建 c2），随后恢复才 resolve
    localStorage.setItem('assistant_current_conversation_id', 'c1')
    let releaseRestore!: () => void
    const restoreGate = new Promise<void>((resolve) => { releaseRestore = resolve })
    let restoreStarted = false
    const encoder = new TextEncoder()
    const chatChunks = [
      'event: started\ndata: {"conversationId":"c2","userMessageId":"um2","assistantMessageId":"am2","requestId":"r2"}\n\n',
      'event: delta\ndata: {"text":"新会话回答"}\n\n',
      'event: complete\ndata: {"messageId":"am2","route":"pet","citations":[],"warnings":[]}\n\n',
    ]
    let chatIndex = 0
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/messages')) {
        restoreStarted = true
        await restoreGate
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'm1', conversationId: 'c1', seq: 1, role: 'assistant', route: 'pet', content: '旧会话消息', status: 'completed', citations: [], warnings: [], createdAt: '2026-09-01T00:00:00.000Z' }],
          }),
        } as unknown as Response
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        body: {
          getReader: () => ({
            read: async () => chatIndex < chatChunks.length
              ? { done: false, value: encoder.encode(chatChunks[chatIndex++]) }
              : { done: true, value: undefined },
          }),
        },
      } as unknown as Response
    })

    render(<ChatWindow isOpen onClose={() => undefined} />)
    await waitFor(() => expect(restoreStarted).toBe(true))
    const input = screen.getByPlaceholderText('问问小助手…')
    fireEvent.change(input, { target: { value: '你好' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await screen.findByText('新会话回答')
    expect(localStorage.getItem('assistant_current_conversation_id')).toBe('c2')

    // 恢复此刻才 resolve：旧会话快照不得覆盖新会话消息，ref 不得被改回
    await act(async () => { releaseRestore() })
    await waitFor(() => expect(screen.queryByText('旧会话消息')).not.toBeInTheDocument())
    expect(screen.getByText('新会话回答')).toBeInTheDocument()
    expect(localStorage.getItem('assistant_current_conversation_id')).toBe('c2')
  })

  it('恢复在发送后、onStarted 前 resolve 时不覆盖乐观消息', async () => {
    // 恢复 GET 与 chat POST 并发：恢复在"用户已发送、chat started 事件到达前"resolve，
    // 此时 ref 仍为 null——旧会话快照不得覆盖刚乐观追加的消息，流式内容需正常呈现
    localStorage.setItem('assistant_current_conversation_id', 'c1')
    let releaseRestore!: () => void
    const restoreGate = new Promise<void>((resolve) => { releaseRestore = resolve })
    let restoreStarted = false
    let releaseStarted!: () => void
    const startedGate = new Promise<void>((resolve) => { releaseStarted = resolve })
    const encoder = new TextEncoder()
    const chatChunks = [
      'event: started\ndata: {"conversationId":"c2","userMessageId":"um2","assistantMessageId":"am2","requestId":"r2"}\n\n',
      'event: delta\ndata: {"text":"新会话回答"}\n\n',
      'event: complete\ndata: {"messageId":"am2","route":"pet","citations":[],"warnings":[]}\n\n',
    ]
    let chatIndex = 0
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/messages')) {
        restoreStarted = true
        await restoreGate
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'm1', conversationId: 'c1', seq: 1, role: 'assistant', route: 'pet', content: '旧会话消息', status: 'completed', citations: [], warnings: [], createdAt: '2026-09-01T00:00:00.000Z' }],
          }),
        } as unknown as Response
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        body: {
          getReader: () => ({
            read: async () => {
              // 首个 chunk（started）等恢复 resolve 后再发，确保恢复落在发送后、onStarted 前
              if (chatIndex === 0) await startedGate
              return chatIndex < chatChunks.length
                ? { done: false, value: encoder.encode(chatChunks[chatIndex++]) }
                : { done: true, value: undefined }
            },
          }),
        },
      } as unknown as Response
    })

    render(<ChatWindow isOpen onClose={() => undefined} />)
    await waitFor(() => expect(restoreStarted).toBe(true))
    const input = screen.getByPlaceholderText('问问小助手…')
    fireEvent.change(input, { target: { value: '你好' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('你好')).toBeInTheDocument()

    // 恢复此刻 resolve：乐观消息不得被旧会话快照覆盖
    await act(async () => { releaseRestore() })
    expect(screen.getByText('你好')).toBeInTheDocument()
    expect(screen.queryByText('旧会话消息')).not.toBeInTheDocument()

    // started 随后到达：占位消息被替换为新会话消息，流式内容正常呈现
    await act(async () => { releaseStarted() })
    await screen.findByText('新会话回答')
    expect(localStorage.getItem('assistant_current_conversation_id')).toBe('c2')
  })

  it('服务端先发 error(CANCELLED) 再发 cancelled 时不短暂标 failed（M-1 回归）', async () => {
    // 真实 cancel 路径：服务端先广播 error{code:CANCELLED}（供旧客户端识别），随后落库 cancelled 并广播 cancelled 事件。
    // onError 对 CANCELLED 直接忽略，消息最终呈现 cancelled 而非 failed，避免闪烁"回答生成中断"。
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/cancel')) return { ok: true, status: 200, json: async () => ({ cancelled: true }) } as unknown as Response
      if (String(url).includes('/messages')) return { ok: true, status: 200, json: async () => ({ items: [] }) } as unknown as Response
      return sseResponse([
        'event: started\ndata: {"conversationId":"c1","userMessageId":"um1","assistantMessageId":"am1","requestId":"r1"}\n\n',
        'event: delta\ndata: {"text":"部分"}\n\n',
        'event: error\ndata: {"code":"CANCELLED","message":"已停止生成","retryable":false}\n\n',
        'event: cancelled\ndata: {"messageId":"am1","text":"部分","reason":"user_stopped"}\n\n',
      ])
    })

    render(<ChatWindow isOpen onClose={() => undefined} />)
    const input = screen.getByPlaceholderText('问问小助手…')
    fireEvent.change(input, { target: { value: '今天心情不错' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await screen.findByText('部分')
    await waitFor(() => expect(screen.queryByText('回答生成中断，请重试。')).not.toBeInTheDocument())
    expect(mockAppToastError).not.toHaveBeenCalled()
  })

  it('停止后 SSE 断开不再误报失败或弹 Toast', async () => {
    const encoder = new TextEncoder()
    const chunks = [
      'event: started\ndata: {"conversationId":"c1","userMessageId":"um1","assistantMessageId":"am1","requestId":"r1"}\n\n',
      'event: delta\ndata: {"text":"部分"}\n\n',
    ]
    let index = 0
    // 停止后才断开：第三次 read 挂起，等测试点击停止并释放 gate 再抛错
    let releaseBreak!: () => void
    const breakGate = new Promise<void>((resolve) => { releaseBreak = resolve })
    const reader = {
      read: async () => {
        if (index < chunks.length) return { done: false, value: encoder.encode(chunks[index++]) }
        await breakGate
        // 停止后服务端 SSE 断开（无 cancelled 事件）：读取阶段抛错模拟
        throw new Error('stream interrupted')
      },
    }
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/cancel')) return { ok: true, status: 200, json: async () => ({ cancelled: true }) } as unknown as Response
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
    await act(async () => { releaseBreak() })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).not.toBeInTheDocument())
    expect(screen.queryByText('回答生成中断，请重试。')).not.toBeInTheDocument()
    expect(mockAppToastError).not.toHaveBeenCalled()
  })

  it('流提前结束未收到终态事件时兜底标记失败', async () => {
    const encoder = new TextEncoder()
    const chunks = [
      'event: started\ndata: {"conversationId":"c1","userMessageId":"um1","assistantMessageId":"am1","requestId":"r1"}\n\n',
      'event: delta\ndata: {"text":"半截"}\n\n',
    ]
    let index = 0
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/messages')) return { ok: true, status: 200, json: async () => ({ items: [] }) } as unknown as Response
      return {
        ok: true, status: 200, statusText: 'OK',
        body: {
          getReader: () => ({
            read: async () => index < chunks.length
              ? { done: false, value: encoder.encode(chunks[index++]) }
              : { done: true, value: undefined },
          }),
        },
      } as unknown as Response
    })

    render(<ChatWindow isOpen onClose={() => undefined} />)
    const input = screen.getByPlaceholderText('问问小助手…')
    fireEvent.change(input, { target: { value: '今天心情不错' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await screen.findByText('半截')
    expect(await screen.findByText('回答生成中断，请重试。')).toBeInTheDocument()
  })
})
