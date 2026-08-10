import type { Category } from '@/types'

export const DEFAULT_CATEGORY_COLOR = '#3B82F6'

export const defaultCategoryTemplates = [
  {
    name: '项目推进',
    description: '规划里程碑、风险与复盘记录，适合跨团队协作类内容',
    color: '#2563EB',
  },
  {
    name: '知识沉淀',
    description: '总结学习要点、代码片段或资料索引，方便后续复用',
    color: '#14B8A6',
  },
  {
    name: '灵感碎片',
    description: '随手记录创意、洞察或素材，后续统一梳理',
    color: '#F97316',
  },
]

export const emptyCategoryForm = {
  name: '',
  description: '',
  color: DEFAULT_CATEGORY_COLOR,
  parentId: '',
}

export type CategoryWithDatabaseId = Omit<Category, 'id'> & {
  id?: string | null
  _id?: string | { toString: () => string }
  parentId?: string | null
}

export type CategoryTemplate = {
  name: string
  description?: string
  color?: string
}

export const getCategoryErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object') {
    const axiosLikeError = error as { response?: { data?: { message?: string } } }
    if (axiosLikeError.response?.data?.message) return axiosLikeError.response.data.message
  }
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return fallback
}

export const extractCategoryData = <T,>(payload: T | { data: T }): T => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

export const normalizeCategory = (category: CategoryWithDatabaseId): Category => {
  const rawId = category.id ?? category._id
  const id =
    typeof rawId === 'string'
      ? rawId
      : typeof rawId === 'object' && rawId?.toString
        ? rawId.toString()
        : ''

  return {
    ...category,
    id,
    parentId: category.parentId ?? null,
  }
}

export const getDaysSinceCategoryUpdate = (date?: string) => {
  if (!date) return null
  const timestamp = Date.parse(date)
  if (Number.isNaN(timestamp)) return null
  return Math.max(0, Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24)))
}
