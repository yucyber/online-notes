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
      if (k && k.startsWith('cache:notes:')) keys.push(k)
    }
    keys.forEach(k => sessionStorage.removeItem(k))
  } catch { }
}
const buildNotesKey = (params?: any) => {
  const sp = new URLSearchParams()
  if (params) {
    if (params.keyword) sp.set('keyword', params.keyword)
    if (params.categoryId) sp.set('categoryId', params.categoryId)
    if (Array.isArray(params.categoryIds)) params.categoryIds.filter(Boolean).forEach((id: string) => sp.append('categoryIds', id))
    if (params.categoriesMode) sp.set('categoriesMode', params.categoriesMode)
    if (Array.isArray(params.tagIds)) params.tagIds.filter(Boolean).forEach((id: string) => sp.append('tagIds', id))
    if (params.tagsMode) sp.set('tagsMode', params.tagsMode)
    if (params.startDate) sp.set('startDate', params.startDate)
    if (params.endDate) sp.set('endDate', params.endDate)
    if (params.status) sp.set('status', params.status)
    if (Array.isArray(params.ids)) params.ids.filter(Boolean).forEach((id: string) => sp.append('ids', id))
    const page = (params as any).page
    const size = (params as any).size ?? (params as any).limit
    if (page) sp.set('page', String(page))
    if (size) sp.set('size', String(size))
  }
  return `notes:${sp.toString()}`
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
  getAll: (params?: NoteFilterParams & { page?: number; size?: number; limit?: number }, signal?: AbortSignal) => {
    const sp = new URLSearchParams()
    if (params) {
      if (params.keyword) sp.set('keyword', params.keyword)
      if (params.categoryId) sp.set('categoryId', params.categoryId)
      if (params.categoryIds && params.categoryIds.length > 0) params.categoryIds.filter(Boolean).forEach(id => sp.append('categoryIds', id))
      if (params.categoriesMode) sp.set('categoriesMode', params.categoriesMode)
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
      const size = (params as any).size ?? (params as any).limit
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
          // 统一前端 Note 的稳定 id：优先使用后端提供的 id，其次 _id；两者都缺失时构造可读但稳定的占位符
          const id = raw.id || raw._id || `${String(raw.title || 'note')}-${String(raw.updatedAt || raw.createdAt || '')}`
          // 归一化分类与标签引用形态，减少 UI 分支判断
          const categoryId = raw.categoryId?.id || raw.categoryId?._id || raw.categoryId || undefined
          const category = raw.categoryId && typeof raw.categoryId === 'object' && (raw.categoryId.name || raw.categoryId.id || raw.categoryId._id)
            ? { id: String(raw.categoryId.id || raw.categoryId._id || categoryId), name: String(raw.categoryId.name || '') }
            : undefined
          const tags = Array.isArray(raw.tags)
            ? raw.tags.map((t: any) => {
              if (typeof t === 'string') return String(t)
              const tid = t?.id || t?._id
              return String(tid ?? '')
            })
            : []
          return {
            id: String(id),
            title: String(raw.title || ''),
            content: String(raw.content || ''),
            categoryId: categoryId ? String(categoryId) : undefined,
            categoryIds: Array.isArray(raw.categoryIds) ? raw.categoryIds.map((c: any) => String(c?.id || c?._id || c)) : undefined,
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
    postTyped<Note>('/notes', note),

  update: (id: string, note: UpdateNoteDto) =>
    api.put<Note>(`/notes/${id}`, note).then(res => res as unknown as Note),

  delete: (id: string) =>
    api.delete(`/notes/${id}`).then(res => res as unknown as void),

  getRecommendations: (currentNoteId?: string, limit: number = 5, context?: NoteFilterParams) => {
    const sp = new URLSearchParams()
    if (currentNoteId) sp.set('currentNoteId', currentNoteId)
    if (limit) sp.set('limit', String(limit))
    if (context) {
      if (context.keyword) sp.set('keyword', context.keyword)
      if (context.categoryId) sp.set('categoryId', context.categoryId)
      if (context.categoryIds && context.categoryIds.length > 0) context.categoryIds.filter(Boolean).forEach(id => sp.append('categoryIds', id))
      if (context.categoriesMode) sp.set('categoriesMode', context.categoriesMode)
      if (context.tagIds && context.tagIds.length > 0) context.tagIds.filter(Boolean).forEach(id => sp.append('tagIds', id))
      if (context.tagsMode) sp.set('tagsMode', context.tagsMode)
      if (context.startDate) sp.set('startDate', context.startDate)
      if (context.endDate) sp.set('endDate', context.endDate)
      if (context.status) sp.set('status', context.status)
    }
    return api.get<Note[]>('/notes/recommendations', { params: sp }).then(res => {
      const items = (res as unknown as any[]).map((raw: any) => ({
        ...raw,
        id: raw.id || raw._id || ''
      }))
      return items as Note[]
    })
  },
  // 带缓存与后台重验证
  getAllCached: async (params?: NoteFilterParams & { page?: number; size?: number; limit?: number }, signal?: AbortSignal) => {
    const key = buildNotesKey(params)
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
