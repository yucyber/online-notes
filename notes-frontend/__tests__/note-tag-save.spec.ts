import { mergeTagIds } from '@/app/dashboard/notes/new/new-note-utils'
import { parseTagNames, resolveTagIdsByNames } from '@/lib/tag-utils'

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

  it('supports Chinese commas, English commas, whitespace, and de-duplicates names', () => {
    expect(parseTagNames('技术，读书, 灵感  技术')).toEqual(['技术', '读书', '灵感'])
  })

  it('reuses existing tags and creates only missing tags', async () => {
    const create = jest.fn(async (name: string) => ({
      id: `created-${name}`,
      name,
      userId: 'user-1',
      createdAt: '2026-08-21T00:00:00.000Z',
    }))

    const result = await resolveTagIdsByNames(
      ['技术', '灵感'],
      [{ id: 'tag-tech', name: '技术', userId: 'user-1', createdAt: '2026-08-21T00:00:00.000Z' }],
      create,
    )

    expect(result.ids).toEqual(['tag-tech', 'created-灵感'])
    expect(result.created).toEqual([expect.objectContaining({ id: 'created-灵感', name: '灵感' })])
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith('灵感')
  })
})
