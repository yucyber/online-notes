import { act, renderHook, waitFor } from '@testing-library/react'

const mockCreateNote = jest.fn()
const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}))

jest.mock('@/lib/api', () => ({
  createNote: (...args: unknown[]) => mockCreateNote(...args),
  createTag: jest.fn(),
  fetchCategories: jest.fn().mockResolvedValue([]),
  fetchTags: jest.fn().mockResolvedValue([]),
}))

import { useNewNotePage } from '@/app/dashboard/notes/new/useNewNotePage'

describe('useNewNotePage save flow', () => {
  beforeEach(() => {
    mockCreateNote.mockReset()
    mockPush.mockReset()
  })

  test('blocks duplicate creates while the first request is pending', async () => {
    let resolveCreate!: (value: { id: string }) => void
    mockCreateNote.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve }))
    const { result } = renderHook(() => useNewNotePage())

    let first!: Promise<void>
    await act(async () => {
      first = result.current.handleSave('标题', '<p>正文</p>')
      void result.current.handleSave('标题', '<p>正文</p>')
    })

    expect(mockCreateNote).toHaveBeenCalledTimes(1)
    expect(result.current.saving).toBe(true)

    await act(async () => {
      resolveCreate({ id: 'note-1' })
      await first
    })
    expect(mockPush).toHaveBeenCalledWith('/dashboard/notes/note-1')
    expect(result.current.saving).toBe(false)
  })

  test('exposes a recoverable error when creation fails', async () => {
    mockCreateNote.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useNewNotePage())

    await act(async () => {
      await expect(result.current.handleSave('标题', '<p>正文</p>')).rejects.toThrow('创建笔记失败，请重试')
    })

    await waitFor(() => expect(result.current.saveError).toBe('创建笔记失败，请重试'))
    expect(result.current.currentContent).toBe('<p></p>')
  })
})
