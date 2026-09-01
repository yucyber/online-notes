import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import ChatWindow from '@/components/ai/ChatWindow'
import { ASSISTANT_HISTORY_KEY } from '@/components/ai/assistant-history'

jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children: string }) => <>{children}</> }))
jest.mock('@/lib/app-toast', () => ({ appToast: { error: jest.fn(), dismiss: jest.fn() } }))

beforeEach(() => localStorage.clear())

test('检索意图在统一对话中自动使用 RAG 并持久化来源', async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: 'React Diff 是差异算法。[E1]', citations: [{ evidenceId: 'E1', noteId: 'note-1', noteTitle: 'React', chunkId: 'chunk-1', headingPath: ['前端'], excerpt: 'Diff 内容' }], planSummary: {}, warnings: [] }) })
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
  render(<ChatWindow isOpen onClose={() => undefined} />)
  expect(screen.queryByText('宠物聊天')).not.toBeInTheDocument()
  expect(screen.queryByText('知识助手')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '搜索笔记' })).toHaveAttribute('aria-pressed', 'false')
  fireEvent.change(screen.getByPlaceholderText('问问小助手…'), { target: { value: '帮我找之前的 React Diff 笔记' } })
  fireEvent.click(screen.getByLabelText('发送'))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/ai/rag/answer', expect.objectContaining({ method: 'POST' })))
  expect(await screen.findByText('React')).toBeInTheDocument()
  expect(screen.getAllByText('基于你的笔记').length).toBeGreaterThan(0)
  expect(localStorage.getItem(ASSISTANT_HISTORY_KEY)).toContain('"route":"rag"')
})

test('关闭再打开后仍呈现统一历史且初始空 state 不覆盖记录', async () => {
  localStorage.setItem(ASSISTANT_HISTORY_KEY, JSON.stringify([{
    id: 'saved-1', role: 'assistant', content: '之前保存的回答', route: 'pet', createdAt: '2026-09-01T00:00:00.000Z',
  }]))
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })

  const first = render(<ChatWindow isOpen onClose={() => undefined} />)
  expect(await screen.findByText('之前保存的回答')).toBeInTheDocument()
  expect(screen.getByText('轻松聊聊')).toBeInTheDocument()
  first.unmount()

  render(<ChatWindow isOpen onClose={() => undefined} />)
  expect(await screen.findByText('之前保存的回答')).toBeInTheDocument()
  expect(localStorage.getItem(ASSISTANT_HISTORY_KEY)).toContain('之前保存的回答')
})
