import { mergeTagIds } from '@/app/dashboard/notes/new/new-note-utils'

describe('note tag save payloads', () => {
  it('merges newly created auxiliary tags into the payload and de-duplicates ids', () => {
    expect(mergeTagIds(['tag-1', 'tag-2'], ['tag-2', 'tag-created'])).toEqual([
      'tag-1',
      'tag-2',
      'tag-created',
    ])
  })

  it('does not add empty ids returned by a failed tag creation', () => {
    expect(mergeTagIds([], ['', 'tag-created', ''])).toEqual(['tag-created'])
  })
})
