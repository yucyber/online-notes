const mockGet = jest.fn()
const mockPatch = jest.fn()

jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    post: jest.fn(),
    delete: jest.fn(),
  },
  getTyped: jest.fn(),
  postTyped: jest.fn(),
}))

describe('notesAPI list cache', () => {
  beforeEach(() => {
    jest.resetModules()
    mockGet.mockReset()
    mockPatch.mockReset()
    sessionStorage.clear()
  })

  it('does not return a stale category after a note update succeeds', async () => {
    const staleList = {
      items: [{ id: 'note-1', title: 'Note', categoryId: undefined }],
      page: 1,
      size: 10,
      total: 1,
    }
    const freshList = {
      items: [{ id: 'note-1', title: 'Note', categoryId: 'category-1' }],
      page: 1,
      size: 10,
      total: 1,
    }
    mockGet.mockResolvedValueOnce(staleList).mockResolvedValueOnce(freshList)
    mockPatch.mockResolvedValue({ id: 'note-1', title: 'Note', categoryId: 'category-1' })

    const { notesAPI } = await import('@/lib/api/notes')
    await notesAPI.getAllCached({ page: 1, size: 10 })
    await notesAPI.update('note-1', { categoryId: 'category-1' })
    const result = await notesAPI.getAllCached({ page: 1, size: 10 })

    expect(result.items[0].categoryId).toBe('category-1')
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it('preserves category and tag names returned for a collaborator note', async () => {
    mockGet.mockResolvedValueOnce({
      items: [{
        id: 'note-1',
        title: '共享笔记',
        categoryId: 'category-1',
        category: { id: 'category-1', name: 'mcp', color: '#3b82f6' },
        tags: [{ id: 'tag-1', name: '协作', color: '#2f9e6e' }],
      }],
      page: 1,
      size: 10,
      total: 1,
    })

    const { notesAPI } = await import('@/lib/api/notes')
    const result = await notesAPI.getAll({ page: 1, size: 10 })

    expect(result.items[0].category?.name).toBe('mcp')
    expect(result.items[0].tags).toEqual([{ id: 'tag-1', name: '协作', color: '#2f9e6e' }])
  })

  it('uses the taxonomy response version in list cache keys', async () => {
    const { buildNotesCacheKey } = await import('@/lib/api/notes')

    expect(buildNotesCacheKey({ page: 1, size: 10 })).toBe('notes:taxonomy-v2:page=1&size=10')
  })
})
