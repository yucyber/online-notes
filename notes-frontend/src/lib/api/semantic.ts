import api from './client'
import { notesAPI } from './notes'

// 语义检索（NLQ）相关 API
export type SemanticSearchItem = {
  id: string
  title: string
  preview: string
  score: number
  updatedAt: string
  matchedSegments?: Array<{ text: string; start?: number; end?: number }>
}
export type SemanticSearchPage = {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  data: SemanticSearchItem[]
}
export const semanticAPI = {
  search: (q: string, opts?: { mode?: 'keyword' | 'vector' | 'hybrid'; page?: number; limit?: number; categoryId?: string; tagIds?: string[] }) => {
    const sp = new URLSearchParams()
    sp.set('q', q)
    if (opts?.mode) sp.set('mode', opts.mode)
    if (opts?.page) sp.set('page', String(opts.page))
    if (opts?.limit) sp.set('limit', String(opts.limit))
    if (opts?.categoryId) sp.set('categoryId', opts.categoryId)
    if (opts?.tagIds && opts.tagIds.length > 0) opts.tagIds.filter(Boolean).forEach(id => sp.append('tagIds', id))
    const isVectorLike = (opts?.mode === 'vector' || opts?.mode === 'hybrid')
    return api
      .get<SemanticSearchPage>('/v1/semantic/search', { params: sp, timeout: isVectorLike ? 120000 : 10000 })
      .then(res => res as unknown as SemanticSearchPage)
      .catch(async (error) => {
        const status = error?.response?.status
        // Resilience only: notes list is already access-scoped on the backend (same ACL as notes.findAll).
        if (status === 404 || status === 503) {
          try {
            document.dispatchEvent(new CustomEvent('rum', { detail: { type: 'ui:search_fallback', name: 'SearchFallback', value: 1, meta: { mode: opts?.mode || 'hybrid', status } } }))
            document.dispatchEvent(new CustomEvent('search:fallback', { detail: { mode: opts?.mode || 'hybrid', reason: status, q } }))
          } catch { }
          const page = Number(opts?.page || 1)
          const limit = Number(opts?.limit || 10)
          const list = await notesAPI.getAll({
            keyword: q,
            page,
            size: limit,
            categoryId: opts?.categoryId,
            tagIds: opts?.tagIds,
            searchMode: 'regex',
          })
          const items = (list.items || []).map((n: any) => ({
            id: String(n.id || n._id || ''),
            title: String(n.title || ''),
            preview: String(n.content || n.preview || '').slice(0, 220),
            score: 0,
            updatedAt: String(n.updatedAt || ''),
          }))
          return {
            page: list.page,
            limit: list.size,
            total: list.total,
            totalPages: Math.max(1, Math.ceil(Number(list.total || 0) / Number(list.size || limit))),
            hasNext: (Number(list.page || page) * Number(list.size || limit)) < Number(list.total || 0),
            data: items,
          } as SemanticSearchPage
        }
        throw error
      })
  },
}
