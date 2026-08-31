import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import ChatWindow from '@/components/ai/ChatWindow'

jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children: string }) => <>{children}</> }))
jest.mock('@/lib/app-toast', () => ({ appToast: { error: jest.fn(), dismiss: jest.fn() } }))

test('知识助手使用独立非流式接口和独立历史', async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: 'React Diff 是差异算法。[E1]', citations: [{ evidenceId: 'E1', noteId: 'note-1', noteTitle: 'React', chunkId: 'chunk-1', headingPath: ['前端'], excerpt: 'Diff 内容' }], planSummary: {}, warnings: [] }) })
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
  render(<ChatWindow isOpen onClose={() => undefined} />)
  fireEvent.click(screen.getByText('知识助手'))
  fireEvent.change(screen.getByPlaceholderText('问问你的笔记…'), { target: { value: 'React Diff 是什么' } })
  fireEvent.click(screen.getByLabelText('发送'))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/ai/rag/answer', expect.objectContaining({ method: 'POST' })))
  expect(await screen.findByText('React')).toBeInTheDocument()
  expect(localStorage.getItem('ai_rag_history')).toContain('React Diff')
  expect(localStorage.getItem('ai_pet_history')).not.toContain('React Diff')
})
