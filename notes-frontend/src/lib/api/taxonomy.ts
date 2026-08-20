import api from './client'
import type { Category, Tag, SavedFilter, CreateSavedFilterDto } from '@/types'

// 保存筛选相关API
export const savedFiltersAPI = {
  getAll: () =>
    api.get<SavedFilter[]>('/saved-filters').then(res => res as unknown as SavedFilter[]),

  create: (data: CreateSavedFilterDto) =>
    api.post<SavedFilter>('/saved-filters', data).then(res => res as unknown as SavedFilter),
}

// 分类相关API
export const categoriesAPI = {
  getAll: (signal?: AbortSignal) =>
    api.get<Category[]>('/categories', { signal }).then(res => {
      const data = res as unknown as any[]
      const mapped = data.map(item => ({ ...item, id: item.id })) as Category[]
      console.log('Fetched categories:', mapped)
      return mapped
    }),

  create: (payload: {
    name: string
    description?: string
    color?: string
    parentId?: string | null
  }) =>
    api.post<Category>('/categories', payload).then(res => {
      const item = res as unknown as any
      return { ...item, id: item.id } as Category
    }),

  update: (id: string, payload: Partial<{
    name: string
    description?: string
    color?: string
    parentId?: string | null
  }>) =>
    api.patch<Category>(`/categories/${id}`, payload).then(res => {
      const item = res as unknown as any
      return { ...item, id: item.id } as Category
    }),

  delete: (id: string) =>
    api.delete(`/categories/${id}`).then(res => res as unknown as void),
}

// 标签相关API
export const tagsAPI = {
  getAll: (signal?: AbortSignal) =>
    api.get<Tag[]>('/tags', { signal }).then(res => {
      const data = res as unknown as any[]
      return data.map(item => ({ ...item, id: item.id })) as Tag[]
    }),

  update: (id: string, payload: Partial<{ name: string; color: string }>) =>
    api.patch<Tag>(`/tags/${id}`, payload).then(res => {
      const item = res as unknown as any
      return { ...item, id: item.id } as Tag
    }),

  create: (name: string) =>
    api.post<Tag>('/tags', { name }).then(res => {
      const item = res as unknown as any
      return { ...item, id: item.id } as Tag
    }),

  bulkCreate: (names: string[]) =>
    api.post<{ created: Tag[]; skipped: string[] }>(`/tags/bulk`, { names }).then(res => res as unknown as { created: Tag[]; skipped: string[] }),

  merge: (sourceIds: string[], targetId: string) =>
    api.post<{ affectedNotes: number }>(`/tags/merge`, { sourceIds, targetId }).then(res => res as unknown as { affectedNotes: number }),

  syncCounts: () =>
    api.post<{ total: number; updated: number }>('/tags/sync').then(res => res as unknown as { total: number; updated: number }),

  delete: (id: string) =>
    api.delete(`/tags/${id}`).then(res => res as unknown as void),
}
