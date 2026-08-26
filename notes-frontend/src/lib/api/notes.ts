import api, { getTyped, postTyped } from './client'
import type { Note, CreateNoteDto, UpdateNoteDto, NoteFilterParams } from '@/types'

const NOTES_CACHE_TTL_MS = 10_000
const NOTES_SESSION_TTL_MS = 30_000
type NotesListPayload = { items: any[]; page: number; size: number; total: number }
const notesCache = new Map<string, { ts: number; payload: NotesListPayload }>()
export const clearNotesCache = () => {
  notesCache.clear()
  try {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      // 同时清掉 notes: 与 semantic: 两类搜索结果缓存，避免编辑笔记后语义检索命中旧结果。
      if (k && k.startsWith('cache:')) keys.push(k)
    }
    keys.forEach(k => sessionStorage.removeItem(k))
  } catch { }
}
export const buildNotesCacheKey = (params?: any) => {
  const sp = new URLSearchParams()
  if (params) {
    if (params.keyword) sp.set('keyword', params.keyword)
    if (params.categoryId) sp.set('categoryId', params.categoryId)
    if (Array.isArray(params.tagIds)) params.tagIds.filter(Boolean).forEach((id: string) => sp.append('tagIds', id))
    if (params.tagsMode) sp.set('tagsMode', params.tagsMode)
    if (params.startDate) sp.set('startDate', params.startDate)
    if (params.endDate) sp.set('endDate', params.endDate)
    if (params.status) sp.set('status', params.status)
    if (Array.isArray(params.ids)) params.ids.filter(Boolean).forEach((id: string) => sp.append('ids', id))
    const page = (params as any).page
    const size = (params as any).size
    if (page) sp.set('page', String(page))
    if (size) sp.set('size', String(size))
  }
  return `notes:taxonomy-v2:${sp.toString()}`
}
const readSessionCache = (key: string): NotesListPayload | null => {
  try {
    const raw = sessionStorage.getItem(`cache:${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const age = Date.now() - Number(parsed.ts || 0)
    if (age > NOTES_SESSION_TTL_MS) return null
    return parsed.payload as NotesListPayload
  } catch { return null }
}
const writeSessionCache = (key: string, payload: NotesListPayload) => {
  try { sessionStorage.setItem(`cache:${key}`, JSON.stringify({ ts: Date.now(), payload })) } catch { }
}

// 笔记相关API
export const notesAPI = {
  getAll: (params?: NoteFilterParams & { page?: number; size?: number }, signal?: AbortSignal) => {
    const sp = new URLSearchParams()
    if (params) {
      if (params.keyword) sp.set('keyword', params.keyword)
      if (params.categoryId) sp.set('categoryId', params.categoryId)
      if (params.tagIds && params.tagIds.length > 0) {
        params.tagIds.filter(Boolean).forEach(id => sp.append('tagIds', id))
      }
      if (params.tagsMode) sp.set('tagsMode', params.tagsMode)
      if (params.startDate) sp.set('startDate', params.startDate)
      if (params.endDate) sp.set('endDate', params.endDate)
      if (params.status) sp.set('status', params.status)
      if (params.searchMode) sp.set('searchMode', params.searchMode)
      if (params.ids && params.ids.length > 0) {
        // Join with comma to keep URL shorter and consistent with TopicClusters navigation
        sp.set('ids', params.ids.join(','))
      }
      const page = (params as any).page
      const size = (params as any).size
      if (page) sp.set('page', String(page))
      if (size) sp.set('size', String(size))
    }
    const enableLogs = (process.env.NEXT_PUBLIC_ENABLE_API_LOGS ?? '').toString() === '1' && process.env.NODE_ENV === 'development'
    if (enableLogs) {
      console.debug('API Request /notes', Object.fromEntries(sp.entries()))
    }
    return api
      .get<{ items: any[]; page: number; size: number; total: number }>('/notes', { params: sp, signal })
      .then((res) => {
        const payload = res as unknown as { items: any[]; page: number; size: number; total: number }
        const items = (payload.items || []).map((raw: any) => {
          const id = raw.id
          const categoryId = raw.categoryId
          // 共享笔记的 taxonomy 属于所有者，名称由笔记接口在 ACL 校验后随引用返回。
          const category = raw.category && typeof raw.category === 'object' && raw.category.name
            ? { id: String(raw.category.id || categoryId || ''), name: String(raw.category.name), color: raw.category.color }
            : undefined
          const tags = Array.isArray(raw.tags) ? raw.tags.map((tag: any) => (
            tag && typeof tag === 'object' && tag.name
              ? { id: String(tag.id || ''), name: String(tag.name), color: tag.color }
              : String(tag)
          )) : []
          return {
            id: String(id),
            title: String(raw.title || ''),
            content: String(raw.content || ''),
            categoryId: categoryId ? String(categoryId) : undefined,
            category: category ?? null,
            tags,
            createdAt: String(raw.createdAt || new Date().toISOString()),
            updatedAt: String(raw.updatedAt || raw.createdAt || new Date().toISOString()),
            userId: String(raw.userId || ''),
            status: raw.status || 'published',
            summary: raw.summary,
          } as Note
        })
        return { ...payload, items } as { items: Note[]; page: number; size: number; total: number }
      })
  },

  getById: (id: string) =>
    getTyped<Note>(`/notes/${id}`),

  create: (note: CreateNoteDto) =>
    postTyped<Note>('/notes', note).then((created) => {
      clearNotesCache()
      return created
    }),

  update: (id: string, note: UpdateNoteDto) =>
    api.patch<Note>(`/notes/${id}`, note).then((res) => {
      clearNotesCache()
      return res as unknown as Note
    }),

  delete: (id: string) =>
    api.delete(`/notes/${id}`).then((res) => {
      clearNotesCache()
      return res as unknown as void
    }),

  getRecommendations: (currentNoteId?: string, limit: number = 5, context?: NoteFilterParams) => {
    const sp = new URLSearchParams()
    if (currentNoteId) sp.set('currentNoteId', currentNoteId)
    if (limit) sp.set('limit', String(limit))
    if (context) {
      if (context.keyword) sp.set('keyword', context.keyword)
      if (context.categoryId) sp.set('categoryId', context.categoryId)
      if (context.tagIds && context.tagIds.length > 0) context.tagIds.filter(Boolean).forEach(id => sp.append('tagIds', id))
      if (context.tagsMode) sp.set('tagsMode', context.tagsMode)
      if (context.startDate) sp.set('startDate', context.startDate)
      if (context.endDate) sp.set('endDate', context.endDate)
      if (context.status) sp.set('status', context.status)
    }
    return api.get<Note[]>('/notes/recommendations', { params: sp }).then(res => {
      const items = (res as unknown as any[]).map((raw: any) => ({
        ...raw,
        id: raw.id || ''
      }))
      return items as Note[]
    })
  },
  // 带缓存与后台重验证
  getAllCached: async (params?: NoteFilterParams & { page?: number; size?: number }, signal?: AbortSignal) => {
    const key = buildNotesCacheKey(params)
    const now = Date.now()
    const mem = notesCache.get(key)
    const sid = (() => { try { return sessionStorage.getItem('lastSearchId') || undefined } catch { return undefined } })()
    if (mem && (now - mem.ts) <= NOTES_CACHE_TTL_MS) {
      try {
        const evt = new CustomEvent('search:cache_hit', { detail: { key, searchId: sid, ageMs: now - mem.ts, count: (mem.payload?.items?.length || 0) } })
        if (typeof document !== 'undefined') document.dispatchEvent(evt)
      } catch { }
      // 后台重验证
      ; (async () => {
        try {
          const latest = await notesAPI.getAll(params)
          notesCache.set(key, { ts: Date.now(), payload: latest as any })
          writeSessionCache(key, latest as any)
          try {
            const revEvt = new CustomEvent('search:revalidated', { detail: { key, searchId: sid, payload: latest } })
            if (typeof document !== 'undefined') document.dispatchEvent(revEvt)
          } catch { }
        } catch { }
      })()
      return mem.payload as unknown as { items: Note[]; page: number; size: number; total: number }
    }
    const ses = readSessionCache(key)
    if (ses) {
      ; (async () => {
        try {
          const latest = await notesAPI.getAll(params)
          notesCache.set(key, { ts: Date.now(), payload: latest as any })
          writeSessionCache(key, latest as any)
          try {
            const revEvt = new CustomEvent('search:revalidated', { detail: { key, searchId: sid, payload: latest } })
            if (typeof document !== 'undefined') document.dispatchEvent(revEvt)
          } catch { }
        } catch { }
      })()
      return ses as unknown as { items: Note[]; page: number; size: number; total: number }
    }
    const data = await notesAPI.getAll(params, signal)
    notesCache.set(key, { ts: Date.now(), payload: data as any })
    writeSessionCache(key, data as any)
    return data as unknown as { items: Note[]; page: number; size: number; total: number }
  },

  getRoomTicket: (noteId: string): Promise<{ ticket: string; role: 'writer' | 'reader'; expiresIn: number }> =>
    api.post(`/notes/${noteId}/room-ticket`).then((res: any) => res),
}
