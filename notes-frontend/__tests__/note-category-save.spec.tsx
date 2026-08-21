import { act, renderHook } from '@testing-library/react'
import { updateNote } from '@/lib/api'
import { useNoteSave } from '@/components/editor/useNoteSave'
import type { Note } from '@/types'

jest.mock('@/lib/api', () => ({
  updateNote: jest.fn(),
  createTag: jest.fn(),
}))

const updatedNote: Note = {
  id: 'note-1',
  title: '标题',
  content: '内容',
  categoryId: undefined,
  category: null,
  tags: [],
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  userId: 'user-1',
  status: 'published',
}

describe('note category save payloads', () => {
  it('明确发送 null 以清空已有分类', async () => {
    jest.mocked(updateNote).mockResolvedValue(updatedNote)
    const { result } = renderHook(() => useNoteSave({
      id: 'note-1',
      selectedCategory: '',
      selectedTags: [],
      tags: [],
      editorMode: 'rich',
      setNote: jest.fn(),
      setTags: jest.fn(),
    }))

    await act(async () => {
      await result.current.handleSave('标题', '内容')
    })

    expect(updateNote).toHaveBeenCalledWith('note-1', {
      title: '标题',
      content: '内容',
      categoryId: null,
      tags: [],
      status: 'published',
    })
  })
})
