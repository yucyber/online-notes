import { act, renderHook, waitFor } from '@testing-library/react'

const mockCreateNote = jest.fn()
const mockPush = jest.fn()
const mockFetchNotes = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}))

jest.mock('@/lib/api', () => ({
  createNote: (...args: unknown[]) => mockCreateNote(...args),
  createTag: jest.fn(),
  fetchCategories: jest.fn().mockResolvedValue([]),
  fetchTags: jest.fn().mockResolvedValue([]),
  fetchNotes: (...args: unknown[]) => mockFetchNotes(...args),
}))

import { useNewNotePage } from '@/app/dashboard/notes/new/useNewNotePage'

describe('useNewNotePage save flow', () => {
  beforeEach(() => {
    mockCreateNote.mockReset()
    mockPush.mockReset()
    mockFetchNotes.mockReset()
    mockFetchNotes.mockResolvedValue({ items: [{ id: 'existing-1', title: '已有笔记' }], page: 1, size: 100, total: 1 })
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
    expect(mockCreateNote).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }))
    expect(result.current.saving).toBe(true)

    await act(async () => {
      resolveCreate({ id: 'note-1' })
      await first
    })
    expect(mockPush).toHaveBeenCalledWith('/dashboard/notes/note-1')
    expect(result.current.saving).toBe(false)
  })

  test('loads the existing note directory for the shared workspace sidebar', async () => {
    const { result } = renderHook(() => useNewNotePage())

    await waitFor(() => expect(result.current.directoryNotes).toHaveLength(1))
    expect(mockFetchNotes).toHaveBeenCalledWith({ page: 1, size: 100 }, expect.any(AbortSignal))
    expect(result.current.directoryNotes[0].title).toBe('已有笔记')
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
