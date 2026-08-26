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
  bestChunk?: SemanticChunkHit
  additionalChunkHits?: number
  additionalChunks?: SemanticChunkHit[]
}
export type SemanticChunkHit = {
  chunkId: string
  headingPath: string[]
  content: string
  score: number
  matchType: 'keyword' | 'semantic'
}
export type SemanticSearchPage = {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  data: SemanticSearchItem[]
}

export type SemanticSearchOpts = {
  mode?: 'keyword' | 'vector' | 'hybrid'
  page?: number
  limit?: number
  categoryId?: string
  tagIds?: string[]
}

// 语义搜索结果也做轻量客户端缓存（仅 sessionStorage，30s），与笔记列表 getAllCached 一致：
// 命中即先返回旧结果并后台重验证，避免离开/重进带搜索词时整页闪"正在整理笔记…"。
// 不做内存 Map，统一由 notes.clearNotesCache 在笔记增删改时清掉 cache: 前缀的缓存。
const SEARCH_SESSION_TTL_MS = 30_000

function buildSearchCacheKey(q: string, opts?: SemanticSearchOpts): string {
  const sp = new URLSearchParams()
  sp.set('q', q)
  if (opts?.mode) sp.set('mode', opts.mode)
  if (opts?.page) sp.set('page', String(opts.page))
  if (opts?.limit) sp.set('limit', String(opts.limit))
  if (opts?.categoryId) sp.set('categoryId', opts.categoryId)
  if (opts?.tagIds && opts.tagIds.length > 0) opts.tagIds.filter(Boolean).forEach((id) => sp.append('tagIds', id))
  return `semantic:${sp.toString()}`
}

function readSearchSessionCache(key: string): SemanticSearchPage | null {
  try {
    const raw = sessionStorage.getItem(`cache:${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (Date.now() - Number(parsed.ts || 0) > SEARCH_SESSION_TTL_MS) return null
    return parsed.payload as SemanticSearchPage
  } catch { return null }
}

function writeSearchSessionCache(key: string, payload: SemanticSearchPage) {
  try { sessionStorage.setItem(`cache:${key}`, JSON.stringify({ ts: Date.now(), payload })) } catch { }
}

export const semanticAPI = {
  search: (q: string, opts?: SemanticSearchOpts) => {
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

  // 缓存版：命中缓存先返回，后台静默重验证并更新缓存供下次命中。
  searchCached: async (q: string, opts?: SemanticSearchOpts): Promise<SemanticSearchPage> => {
    const key = buildSearchCacheKey(q, opts)
    const cached = readSearchSessionCache(key)
    if (cached) {
      ;(async () => {
        try {
          const latest = await semanticAPI.search(q, opts)
          writeSearchSessionCache(key, latest)
        } catch { }
      })()
      return cached
    }
    const data = await semanticAPI.search(q, opts)
    writeSearchSessionCache(key, data)
    return data
  },
}
