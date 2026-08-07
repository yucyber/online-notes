import type { Note } from '@/types'

export const extractId = <T extends { id?: string; _id?: string }>(entity?: T | null) =>
  entity?.id || (entity as { _id?: string })?._id || ''

export function parseNotesPagination(searchParams: { get(name: string): string | null }) {
  const rawPage = Number.parseInt(searchParams.get('page') || '', 10)
  const rawSize = Number.parseInt(searchParams.get('size') || '', 10)
  return {
    page: Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1,
    size: Number.isFinite(rawSize) ? Math.min(100, Math.max(1, rawSize)) : 10,
  }
}

export const getCategoryLabel = (note: Note, categoryMap: Record<string, string>) => {
  if (note.category && typeof note.category !== 'string') {
    const directName = note.category.name
    if (directName) return directName
    const inlineId = extractId(note.category as { id?: string; _id?: string })
    if (inlineId && categoryMap[inlineId]) {
      return categoryMap[inlineId]
    }
  }

  const categoryId =
    typeof note.category === 'string'
      ? note.category
      : typeof note.categoryId === 'string'
        ? note.categoryId
        : extractId(note.categoryId as unknown as { id?: string; _id?: string })

  if (categoryId && categoryMap[categoryId]) {
    return categoryMap[categoryId]
  }

  return categoryId || '未分类'
}
