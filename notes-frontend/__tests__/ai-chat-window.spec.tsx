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

describe('ChatWindow 请求失败', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'TextDecoder', { configurable: true, value: TextDecoder })
  })

  beforeEach(() => {
    localStorage.clear()
    mockAppToastError.mockReset()
    mockAppToastDismiss.mockReset()
    mockFetch.mockReset()
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: mockFetch })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
  })

  it('显示中文内联错误，并允许从统一 Toast 重试原请求', async () => {
    const reader = {
      read: jest.fn()
        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('重试成功') })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    mockFetch.mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ ok: true, body: { getReader: () => reader } } as Response)

    render(<ChatWindow isOpen onClose={() => undefined} />)
    const input = screen.getByPlaceholderText('输入消息...')
    fireEvent.change(input, { target: { value: '继续生成' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByText('AI 生成失败，请稍后重试。')).toBeInTheDocument()
    expect(mockAppToastError).toHaveBeenCalledTimes(1)
    expect(mockAppToastError).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ai-pet:request',
      title: 'AI 生成失败',
      persistent: true,
      action: expect.objectContaining({ label: '重试生成' }),
    }))

    await act(async () => {
      mockAppToastError.mock.calls[0][0].action.onClick()
    })

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('重试成功')).toBeInTheDocument()
    expect(mockAppToastDismiss).toHaveBeenCalledWith('ai-pet:request')
  })
})
