import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TextDecoder, TextEncoder } from 'node:util'
import { AssistantWorkspace } from '@/components/assistant/AssistantWorkspace'

// jsdom 无 ReactMarkdown 依赖环境（SSR remark 等），按仓库惯例直出 children
jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children: string }) => <>{children}</> }))

// useSearchParams 只在挂载初读一次 ?conversation；测试统一走 initialConversationId
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}))

// jsdom 测试环境缺 Node 全局流 API，显式注入（与 ai-chat-window.spec 同一惯例）
Object.assign(global, { TextDecoder, TextEncoder })

function json(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, blob: async () => new Blob([JSON.stringify(body)]) } as unknown as Response
}

// 用可控 chunk 序列模拟 SSE 响应体（同 ai-chat-window.spec）
function sseResponse(chunks: string[], status = 200): Response {
  let index = 0
  const encoder = new TextEncoder()
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => ({}),
    body: {
      getReader: () => ({
        read: async () => index < chunks.length
          ? { done: false, value: encoder.encode(chunks[index++]) }
          : { done: true, value: undefined },
      }),
    },
  } as unknown as Response
}

function conversation(id: string, title: string, messageCount = 0, updatedAt = new Date().toISOString()) {
  return { id, title, status: 'active' as const, messageCount, updatedAt }
}

function message(over: Partial<{ id: string; conversationId: string; seq: number; role: 'user' | 'assistant'; route: 'pet' | 'rag'; content: string; status: 'completed' | 'failed' | 'cancelled' | 'pending' | 'streaming'; citations: any[]; warnings: string[]; createdAt: string }>) {
  return {
    id: 'm', conversationId: 'c1', seq: 1, role: 'user' as const, route: 'pet' as const, content: '',
    status: 'completed' as const, citations: [], warnings: [], createdAt: new Date().toISOString(),
    ...over,
  }
}

describe('AssistantWorkspace 三栏工作台', () => {
  let promptSpy: jest.SpyInstance | undefined
  // 记录 scrollIntoView 的 this（目标元素），用于验证消息定位
  const scrolled: Element[] = []

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    promptSpy?.mockRestore()
    promptSpy = undefined
    scrolled.length = 0
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: function (this: Element) { scrolled.push(this) },
    })
  })

  afterEach(() => {
    promptSpy?.mockRestore()
  })

  test('加载会话列表并选中当前会话，三栏均渲染', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (String(url) === '/api/assistant/conversations') return json({ items: [conversation('c1', '会话一', 2)] })
      if (String(url).includes('/messages')) return json({ items: [] })
      return json({})
    }) as any
    global.fetch = fetchMock
    render(<AssistantWorkspace initialConversationId="c1" />)
    await screen.findByText('会话一')
    // 左栏：会话列表导航
    expect(screen.getByRole('navigation', { name: '会话列表' })).toBeInTheDocument()
    // 中栏：共享输入区
    expect(screen.getByPlaceholderText('问问小助手…')).toBeInTheDocument()
    // 右栏：上下文面板 landmark
    expect(screen.getByRole('complementary', { name: '上下文面板' })).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/assistant/conversations', expect.anything()))
  })

  test('空会话显示空态文案', async () => {
    global.fetch = jest.fn(async () => json({ items: [] })) as any
    render(<AssistantWorkspace />)
    await screen.findByText(/今天想聊点什么/)
  })

  test('点击会话列表行切换当前会话并加载该会话消息', async () => {
    const c1Messages = [message({ id: 'u1', conversationId: 'c1', seq: 1, content: '第一问' })]
    const c2Messages = [message({ id: 'u2', conversationId: 'c2', seq: 1, content: '第二问' })]
    const fetchMock = jest.fn(async (url: string) => {
      const href = String(url)
      if (href === '/api/assistant/conversations') return json({ items: [conversation('c1', '会话一', 1), conversation('c2', '会话二', 1)] })
      if (href.includes('/c1/messages')) return json({ items: c1Messages })
      if (href.includes('/c2/messages')) return json({ items: c2Messages })
      return json({})
    }) as any
    global.fetch = fetchMock
    render(<AssistantWorkspace initialConversationId="c1" />)
    await screen.findByText('第一问')
    fireEvent.click(screen.getByRole('button', { name: /会话二 \d+ 条/ }))
    expect(await screen.findByText('第二问')).toBeInTheDocument()
    expect(screen.queryByText('第一问')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/c2/messages'), expect.anything())
  })

  // ==== 合并 Task 8：搜索接线 ====
  test('搜索输入 300ms 防抖后调用 searchAssistant，结果分标题/消息命中展示', async () => {
    const convList = [conversation('c1', '会话一', 2)]
    const searchResult = {
      conversations: [{ id: 'c2', title: '旧项目复盘', updatedAt: new Date().toISOString() }],
      messages: [
        { conversationId: 'c1', messageId: 'm3', seq: 3, role: 'assistant', snippet: '蓝色海豚对应的项目结论是 X', updatedAt: new Date().toISOString() },
      ],
    }
    let searchCalls = 0
    const fetchMock = jest.fn(async (url: string) => {
      const href = String(url)
      if (href === '/api/assistant/conversations') return json({ items: convList })
      if (href.includes('/search?q=')) { searchCalls += 1; return json({ data: searchResult }) }
      if (href.includes('/messages')) return json({ items: [] })
      return json({})
    }) as any
    global.fetch = fetchMock
    render(<AssistantWorkspace />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/assistant/conversations', expect.anything()))

    const input = screen.getByLabelText('搜索会话与消息')
    // 快速连输两段只应触发一次最终查询（防抖合并）
    fireEvent.change(input, { target: { value: '海' } })
    fireEvent.change(input, { target: { value: '海豚' } })
    await waitFor(() => expect(searchCalls).toBe(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/assistant/search?q=%E6%B5%B7%E8%B1%9A', expect.anything())

    // 标题命中与消息命中分开展示；消息命中带 snippet + 会话标题 + seq
    expect(await screen.findByText('标题命中')).toBeInTheDocument()
    expect(screen.getByText('消息命中')).toBeInTheDocument()
    expect(screen.getByText('旧项目复盘')).toBeInTheDocument()
    expect(screen.getByText(/蓝色海豚对应的项目结论是 X/)).toBeInTheDocument()
    expect(screen.getByText(/会话一 · 第 3 条/)).toBeInTheDocument()
  })

  test('点击消息命中切换到对应会话并滚动定位到该消息', async () => {
    const c1Messages = [
      message({ id: 'u1', conversationId: 'c1', seq: 1, content: '海豚问题' }),
      message({ id: 'm3', conversationId: 'c1', seq: 2, role: 'assistant', route: 'rag', content: '海豚的结论正文', status: 'completed' }),
      message({ id: 'u2', conversationId: 'c1', seq: 3, content: '再问' }),
    ]
    const searchResult = {
      conversations: [],
      messages: [{ conversationId: 'c1', messageId: 'm3', seq: 2, role: 'assistant', snippet: '海豚的结论正文', updatedAt: new Date().toISOString() }],
    }
    const fetchMock = jest.fn(async (url: string) => {
      const href = String(url)
      if (href === '/api/assistant/conversations') return json({ items: [conversation('c1', '会话一', 3)] })
      if (href.includes('/search?q=')) return json({ data: searchResult })
      if (href.includes('/messages')) return json({ items: c1Messages })
      return json({})
    }) as any
    global.fetch = fetchMock
    render(<AssistantWorkspace />)

    const input = screen.getByLabelText('搜索会话与消息')
    fireEvent.change(input, { target: { value: '海豚' } })
    await screen.findByText('消息命中')
    fireEvent.click(screen.getByText(/会话一 · 第 2 条/))
    // 命中点击后搜索收起、输入清空
    expect(input).toHaveValue('')
    expect(screen.queryByText('消息命中')).not.toBeInTheDocument()
    // 会话被加载，消息正文出现，且滚动定位到目标消息行
    expect(await screen.findByText('海豚的结论正文')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /会话一 \d+ 条/ })).toHaveAttribute('aria-current', 'true')
    await waitFor(() => expect(scrolled.some((el) => el.getAttribute('data-message-id') === 'm3')).toBe(true))
  })

  test('标题命中点击也切换到对应会话', async () => {
    const c2Messages = [message({ id: 'u9', conversationId: 'c2', seq: 1, content: '复盘正文' })]
    const searchResult = { conversations: [{ id: 'c2', title: '旧项目复盘', updatedAt: new Date().toISOString() }], messages: [] }
    const fetchMock = jest.fn(async (url: string) => {
      const href = String(url)
      if (href === '/api/assistant/conversations') return json({ items: [conversation('c1', '会话一'), conversation('c2', '旧项目复盘', 1)] })
      if (href.includes('/search?q=')) return json({ data: searchResult })
      if (href.includes('/c2/messages')) return json({ items: c2Messages })
      return json({ items: [] })
    }) as any
    global.fetch = fetchMock
    render(<AssistantWorkspace />)
    const input = screen.getByLabelText('搜索会话与消息')
    fireEvent.change(input, { target: { value: '复盘' } })
    // 下拉标题命中按钮的可见名恰为会话标题，与侧栏行（标题 + N 条）区分
    fireEvent.click(await screen.findByRole('button', { name: '旧项目复盘' }))
    expect(await screen.findByText('复盘正文')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /旧项目复盘 \d+ 条/ })).toHaveAttribute('aria-current', 'true')
  })

  // ==== 合并 Task 8：管理回调接线 ====
  test('重命名会话成功后刷新列表显示新标题', async () => {
    const convList = [conversation('c1', '会话一', 2)]
    promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('重命名后的标题')
    const fetchMock = jest.fn(async (url: string, init?: any) => {
      const href = String(url)
      if (href === '/api/assistant/conversations') return json({ items: convList })
      if (href === '/api/assistant/conversations/c1' && init?.method === 'PATCH') {
        convList[0] = { ...convList[0], title: '重命名后的标题' }
        return json({})
      }
      if (href.includes('/messages')) return json({ items: [] })
      return json({})
    }) as any
    global.fetch = fetchMock
    render(<AssistantWorkspace initialConversationId="c1" />)
    await screen.findByText('会话一')
    fireEvent.click(screen.getByRole('button', { name: /重命名 会话一/ }))
    expect(await screen.findByText('重命名后的标题')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/assistant/conversations/c1', expect.objectContaining({ method: 'PATCH' }))
  })

  test('归档会话后从列表移除', async () => {
    const convList = [conversation('c1', '会话一'), conversation('c2', '会话二')]
    const fetchMock = jest.fn(async (url: string, init?: any) => {
      const href = String(url)
      if (href === '/api/assistant/conversations') return json({ items: convList })
      if (href === '/api/assistant/conversations/c1/archive') return json({})
      if (href.includes('/messages')) return json({ items: [] })
      return json({})
    }) as any
    global.fetch = fetchMock
    render(<AssistantWorkspace />)
    await screen.findByText('会话一')
    fireEvent.click(screen.getByRole('button', { name: /归档 会话一/ }))
    await waitFor(() => expect(screen.queryByText('会话一')).not.toBeInTheDocument())
    expect(screen.getByText('会话二')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/assistant/conversations/c1/archive', expect.objectContaining({ method: 'POST' }))
  })

  test('删除当前会话后从列表移除并清空当前选择', async () => {
    const convList = [conversation('c1', '会话一', 1), conversation('c2', '会话二')]
    const c1Messages = [message({ id: 'u1', content: '要被删除的消息' })]
    const fetchMock = jest.fn(async (url: string, init?: any) => {
      const href = String(url)
      if (href === '/api/assistant/conversations') return json({ items: convList })
      if (href === '/api/assistant/conversations/c1/delete') return json({})
      if (href.includes('/messages')) return json({ items: c1Messages })
      return json({})
    }) as any
    global.fetch = fetchMock
    render(<AssistantWorkspace initialConversationId="c1" />)
    await screen.findByText('要被删除的消息')
    fireEvent.click(screen.getByRole('button', { name: /删除 会话一/ }))
    await waitFor(() => expect(screen.queryByText('会话一')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/assistant/conversations/c1/delete', expect.objectContaining({ method: 'POST' }))
    // 当前会话被删后回到空态，原会话消息不再展示
    expect(await screen.findByText(/今天想聊点什么/)).toBeInTheDocument()
    expect(screen.queryByText('要被删除的消息')).not.toBeInTheDocument()
  })

  // ==== 合并 Task 8：导出按钮 ====
  test('有当前会话时显示导出按钮，点击调用导出接口', async () => {
    URL.createObjectURL = jest.fn(() => 'blob:assistant-export')
    URL.revokeObjectURL = jest.fn()
    const fetchMock = jest.fn(async (url: string) => {
      const href = String(url)
      if (href === '/api/assistant/conversations/c1/export') return json({ lines: [] })
      if (href === '/api/assistant/conversations') return json({ items: [conversation('c1', '会话一', 1)] })
      if (href.includes('/messages')) return json({ items: [] })
      return json({})
    }) as any
    global.fetch = fetchMock
    render(<AssistantWorkspace initialConversationId="c1" />)
    await screen.findByText('会话一')
    fireEvent.click(await screen.findByRole('button', { name: '导出会话' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/assistant/conversations/c1/export', expect.anything()))
  })

  test('无当前会话时不显示导出按钮', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      const href = String(url)
      if (href === '/api/assistant/conversations') return json({ items: [conversation('c1', '会话一', 1)] })
      return json({})
    }) as any
    global.fetch = fetchMock
    render(<AssistantWorkspace />)
    await screen.findByText('会话一')
    expect(screen.queryByRole('button', { name: '导出会话' })).not.toBeInTheDocument()
  })

  // ==== 合并 Task 8：失败回答重试 ====
  test('failed 消息显示重新回答，点击以 retryOfMessageId 重发且原失败保留', async () => {
    const c1Messages = [
      message({ id: 'u1', conversationId: 'c1', seq: 1, role: 'user', route: 'rag', content: '帮我查海豚项目结论' }),
      message({ id: 'am1', conversationId: 'c1', seq: 2, role: 'assistant', route: 'rag', content: '部分内容', status: 'failed' }),
    ]
    let chatCalls = 0
    const fetchMock = jest.fn(async (url: string) => {
      const href = String(url)
      if (href === '/api/assistant/conversations') return json({ items: [conversation('c1', '会话一', 2)] })
      if (href.includes('/messages')) return json({ items: c1Messages })
      if (href === '/api/assistant/chat') {
        chatCalls += 1
        return sseResponse([
          'event: started\ndata: {"conversationId":"c1","userMessageId":"um2","assistantMessageId":"am2","requestId":"r2"}\n\n',
          'event: delta\ndata: {"text":"重试成功"}\n\n',
          'event: complete\ndata: {"messageId":"am2","route":"rag","citations":[],"warnings":[]}\n\n',
        ])
      }
      return json({})
    }) as any
    global.fetch = fetchMock
    render(<AssistantWorkspace initialConversationId="c1" />)
    await screen.findByText('部分内容')
    expect(screen.getByText('回答生成中断，请重试。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新回答' }))
    // 原失败消息保留、新回答流式呈现
    expect(await screen.findByText('重试成功')).toBeInTheDocument()
    expect(screen.getByText('部分内容')).toBeInTheDocument()
    expect(screen.getAllByText('回答生成中断，请重试。')).toHaveLength(1)
    // 重发携带 retryOfMessageId 与原问题
    await waitFor(() => expect(chatCalls).toBe(1))
    const chatCall = fetchMock.mock.calls.find(([u]: any) => String(u) === '/api/assistant/chat')!
    const body = JSON.parse(chatCall[1].body)
    expect(body).toMatchObject({ conversationId: 'c1', question: '帮我查海豚项目结论', retryOfMessageId: 'am1' })
  })
})
