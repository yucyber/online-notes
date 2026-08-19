const mockGet = jest.fn()
const mockPut = jest.fn()

jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
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
    mockPut.mockReset()
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
    mockPut.mockResolvedValue({ id: 'note-1', title: 'Note', categoryId: 'category-1' })

    const { notesAPI } = await import('@/lib/api/notes')
    await notesAPI.getAllCached({ page: 1, size: 10 })
    await notesAPI.update('note-1', { categoryId: 'category-1' })
    const result = await notesAPI.getAllCached({ page: 1, size: 10 })

    expect(result.items[0].categoryId).toBe('category-1')
    expect(mockGet).toHaveBeenCalledTimes(2)
  })
})
