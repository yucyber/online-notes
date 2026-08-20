import { parseNotesPagination } from '@/components/notes/notes-page-utils'
import { buildNotesQueryParams } from '@/components/notes/useNotesQuery'

describe('notes URL pagination', () => {
  it('reads and clamps page and size from the URL', () => {
    expect(parseNotesPagination(new URLSearchParams('page=3&size=20'))).toEqual({ page: 3, size: 20 })
    expect(parseNotesPagination(new URLSearchParams('page=0&size=999'))).toEqual({ page: 1, size: 100 })
  })

  it('falls back to the default pagination when URL values are invalid', () => {
    expect(parseNotesPagination(new URLSearchParams('page=bad&size='))).toEqual({ page: 1, size: 10 })
  })

  it('keeps filter parsing in one query boundary', () => {
    expect(buildNotesQueryParams(new URLSearchParams('keyword=graph&tagIds=t1&tagIds=t2&ids=n1,n2&status=draft'))).toEqual({
      keyword: 'graph',
      categoryId: undefined,
      tagIds: ['t1', 't2'],
      tagsMode: undefined,
      startDate: undefined,
      endDate: undefined,
      status: 'draft',
      ids: ['n1', 'n2'],
    })
  })
})
