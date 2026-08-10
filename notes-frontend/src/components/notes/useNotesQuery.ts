import type { NoteFilterParams } from '@/types'

type SearchParamsLike = {
  get(name: string): string | null
  getAll(name: string): string[]
}

export function buildNotesQueryParams(searchParams: SearchParamsLike): NoteFilterParams {
  const categoryIds = searchParams.getAll('categoryIds')
  const tagIds = searchParams.getAll('tagIds')
  const rawIds = searchParams.get('ids')

  return {
    keyword: searchParams.get('keyword') || undefined,
    categoryId: searchParams.get('categoryId') || undefined,
    categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
    categoriesMode: (searchParams.get('categoriesMode') as 'any' | 'all') || undefined,
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    tagsMode: (searchParams.get('tagsMode') as 'any' | 'all') || undefined,
    startDate: searchParams.get('startDate') || undefined,
    endDate: searchParams.get('endDate') || undefined,
    status: (searchParams.get('status') as 'published' | 'draft') || undefined,
    ids: rawIds ? rawIds.split(',').filter(Boolean) : undefined,
  }
}
