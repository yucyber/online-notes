import axios from 'axios'
import { getToken, removeToken } from './auth'
import {
  User,
  LoginCredentials,
  Note,
  CreateNoteDto,
  UpdateNoteDto,
  Category,
  Tag,
  DashboardOverview,
  SavedFilter,
  CreateSavedFilterDto,
  NoteFilterParams,
} from '@/types'

// 创建axios实例
// 统一默认后端地址到 3001，与 `src/app/layout.tsx` 的预连接目标一致，避免首包握手到错误端口导致的 10–30ms 额外延迟
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 3000,
  withCredentials: false,
})

const RUM_ENDPOINT = process.env.NEXT_PUBLIC_RUM_ENDPOINT || ''
const emitRum = (detail: any) => {
  try { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('rum', { detail })) } catch { }
  try {
    if (!RUM_ENDPOINT) return
    const payload = JSON.stringify(detail || {})
    if (typeof navigator !== 'undefined' && (navigator as any).sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' })
        ; (navigator as any).sendBeacon(RUM_ENDPOINT, blob)
    } else {
      fetch(RUM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true })
    }
  } catch { }
}

// 只读列表缓存（SWR风格）：L1内存10s，L2会话存储30s
const NOTES_CACHE_TTL_MS = 10_000
const NOTES_SESSION_TTL_MS = 30_000
type NotesListPayload = { items: any[]; page: number; size: number; total: number }
const notesCache = new Map<string, { ts: number; payload: NotesListPayload }>()
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

// 请求拦截器添加token
api.interceptors.request.use(
  (config) => {
    const rid = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
      ; (config as any).__rid = rid
    config.headers['X-Request-ID'] = rid
    try {
      const sid = sessionStorage.getItem('lastSearchId')
      if (sid) {
        config.headers['X-Search-ID'] = sid
          ; (config as any).__searchId = sid
      }
    } catch { }
    const token = getToken()
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    ; (config as any).__startTime = Date.now()
    const enableLogs = (process.env.NEXT_PUBLIC_ENABLE_API_LOGS ?? '').toString() !== 'false' && process.env.NODE_ENV !== 'production'
    if (enableLogs && typeof config.url === 'string' && config.url.includes('/notes')) {
      console.log('API Request /notes', {
        url: config.url,
        method: config.method,
        params: config.params,
        time: new Date().toISOString(),
      })
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器处理错误
api.interceptors.response.use(
  (response) => {
    const cfg: any = response.config || {}
    const duration = cfg.__startTime ? Date.now() - cfg.__startTime : undefined
    const enableLogs = (process.env.NEXT_PUBLIC_ENABLE_API_LOGS ?? '').toString() !== 'false' && process.env.NODE_ENV !== 'production'
    if (enableLogs && typeof response.config.url === 'string' && response.config.url.includes('/notes')) {
      console.log('API Response /notes', {
        url: response.config.url,
        status: response.status,
        duration,
        time: new Date().toISOString(),
      })
    }
    // RUM: 成功请求指标采集（duration/状态码/路径）
    emitRum({ type: 'network', name: 'api:ok', value: duration, meta: { url: response.config?.url, method: response.config?.method, status: response.status, searchId: (response.config as any)?.__searchId } })
    const payload = response.data
    if (payload && typeof payload === 'object' && 'code' in payload && 'message' in payload && 'timestamp' in payload) {
      if (payload.code === 0) {
        return payload.data
      }
      const err = new Error(payload.message || 'API Error') as any
      err.__api = { code: payload.code, requestId: payload.requestId, timestamp: payload.timestamp }
      throw err
    }
    return payload
  },
  (error) => {
    const cfg: any = error.config || {}
    const duration = cfg.__startTime ? Date.now() - cfg.__startTime : undefined
    const status = error.response?.status
    const url: string = error.config?.url || ''
    const enableLogs = (process.env.NEXT_PUBLIC_ENABLE_API_LOGS ?? '').toString() !== 'false' && process.env.NODE_ENV !== 'production'
    if (enableLogs && typeof url === 'string' && url.includes('/notes')) {
      console.log('API Error /notes', {
        url,
        status,
        duration,
        message: error.message,
        time: new Date().toISOString(),
      })
    }
    // RUM: 错误请求指标采集（duration/状态码/路径/错误信息）
    emitRum({ type: 'network', name: 'api:error', value: duration, meta: { url, method: (error.config?.method || 'get'), status, message: error.message, searchId: (error.config as any)?.__searchId } })
    // 401统一处理：避免在登录/注册请求上拦截跳转，保留页面内错误处理逻辑
    if (status === 401) {
      const reqUrl = String(error.config?.url || '')
      const path = reqUrl.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
      const whitelist = [/^\/auth\/(login|register)/, /^\/health$/, /^\/invitations\//]
      const skip = Boolean((error.config as any)?.meta?.skipAuthRedirect) || String(error.config?.headers?.['X-Skip-Auth-Redirect'] || '') === '1'
      const whitelisted = whitelist.some(r => r.test(path)) || skip
      if (!whitelisted) {
        removeToken()
        if (typeof window !== 'undefined') {
          window.location.href = '/login'
        }
      }
    }
    // 简单只读请求重试（网络错误/5xx），最多2次，指数退避
    const method = (error.config?.method || 'get').toLowerCase()
    const canRetry = method === 'get' && (!error.response || (status && status >= 500))
    const retryCount = (error.config as any).__retryCount || 0
    if (canRetry && retryCount < 2) {
      const delay = 200 * Math.pow(2, retryCount)
      return new Promise((resolve) => setTimeout(resolve, delay)).then(() => {
        (error.config as any).__retryCount = retryCount + 1
        return api.request(error.config)
      })
    }
    // 超时事件上报
    const isTimeout = (error?.code === 'ECONNABORTED') || String(error?.message || '').toLowerCase().includes('timeout')
    if (isTimeout) {
      try {
        const evt = new CustomEvent('search:timeout', {
          detail: {
            searchId: (error.config as any)?.__searchId,
            url: error.config?.url,
            method: (error.config?.method || 'get'),
            timeout: error.config?.timeout ?? 3000,
            time: new Date().toISOString(),
          }
        })
        if (typeof document !== 'undefined') document.dispatchEvent(evt)
      } catch { }
    }
    return Promise.reject(error)
  }
)

// 认证相关API
export const authAPI = {
  login: (credentials: LoginCredentials) =>
    api.post<{ token: string; user: User }>('/auth/login', credentials).then(res => res as unknown as { token: string; user: User }),

  register: (data: LoginCredentials) =>
    api.post<{ token: string; user: User }>('/auth/register', data).then(res => res as unknown as { token: string; user: User }),

  getCurrentUser: () =>
    api.get<User>('/auth/me').then(res => res as unknown as User),
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
          } as Note
        })
        return { ...payload, items } as { items: Note[]; page: number; size: number; total: number }
      })
  },

  getById: (id: string) =>
    api.get<Note>(`/notes/${id}`).then(res => res as unknown as Note),

  create: (note: CreateNoteDto) =>
    api.post<Note>('/notes', note).then(res => res as unknown as Note),

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
    return api.get<Note[]>('/notes/recommendations', { params: sp }).then(res => res as unknown as Note[])
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
}

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
  search: (q: string, opts?: { mode?: 'keyword' | 'vector' | 'hybrid'; page?: number; limit?: number; threshold?: number; categoryId?: string; tagIds?: string[] }) => {
    const sp = new URLSearchParams()
    sp.set('q', q)
    if (opts?.mode) sp.set('mode', opts.mode)
    if (opts?.page) sp.set('page', String(opts.page))
    if (opts?.limit) sp.set('limit', String(opts.limit))
    if (opts?.threshold != null) sp.set('threshold', String(opts.threshold))
    if (opts?.categoryId) sp.set('categoryId', opts.categoryId)
    if (opts?.tagIds && opts.tagIds.length > 0) opts.tagIds.filter(Boolean).forEach(id => sp.append('tagIds', id))
    const isVectorLike = (opts?.mode === 'vector' || opts?.mode === 'hybrid')
    return api
      .get<SemanticSearchPage>('/v1/semantic/search', { params: sp, timeout: isVectorLike ? 5000 : 3000 })
      .then(res => res as unknown as SemanticSearchPage)
      .catch(async (error) => {
        const status = error?.response?.status
        if (status === 404 || status === 503) {
          try {
            document.dispatchEvent(new CustomEvent('rum', { detail: { type: 'ui:search_fallback', name: 'SearchFallback', value: 1, meta: { mode: opts?.mode || 'hybrid', status } } }))
            document.dispatchEvent(new CustomEvent('search:fallback', { detail: { mode: opts?.mode || 'hybrid', reason: status, q } }))
          } catch { }
          const page = Number(opts?.page || 1)
          const limit = Number(opts?.limit || 10)
          const list = await notesAPI.getAll({ keyword: q, page, size: limit, categoryId: opts?.categoryId, tagIds: opts?.tagIds })
          const items = (list.items || []).map((n: any) => ({
            id: String(n.id || n._id || ''),
            title: String(n.title || ''),
            preview: String(n.content || '').slice(0, 220),
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

export const aclAPI = {
  get: (noteId: string) => api.get(`/notes/${noteId}/acl`).then(res => res as unknown as { visibility: string; acl: { userId: string; role: string }[] }),
  add: (noteId: string, userId: string, role: 'editor' | 'viewer') => api.post(`/notes/${noteId}/acl`, { userId, role }).then(res => res as unknown as any),
  update: (noteId: string, userId: string, role: 'owner' | 'editor' | 'viewer') => api.patch(`/notes/${noteId}/acl/${userId}`, { role }).then(res => res as unknown as any),
  remove: (noteId: string, userId: string) => api.delete(`/notes/${noteId}/acl/${userId}`).then(res => res as unknown as any),
}

export const invitationsAPI = {
  create: (noteId: string, role: 'editor' | 'viewer', inviteeEmail?: string, ttlHours?: number) => api.post(`/invitations/notes/${noteId}`, { role, inviteeEmail, ttlHours }).then(res => res as unknown as { token: string; expiresAt: string }),
  list: (noteId: string) => api.get(`/invitations/notes/${noteId}`).then(res => res as unknown as any[]),
  preview: (token: string) => api.get(`/invitations/${token}`).then(res => res as unknown as { noteId: string; role: string; expiresAt: string }),
  accept: (token: string) => api.post(`/invitations/${token}/accept`, {}).then(res => res as unknown as any),
  revoke: (token: string) => api.delete(`/invitations/${token}`).then(res => res as unknown as any),
  mine: (status: 'pending' | 'accepted' | 'revoked' | 'expired' = 'pending') => api.get(`/invitations/mine`, { params: { status } }).then(res => res as unknown as any[]),
}

export const versionsAPI = {
  list: (noteId: string) => api.get(`/notes/${noteId}/versions`).then(res => res as unknown as any[]),
  snapshot: (noteId: string) => api.post(`/notes/${noteId}/versions`, {}).then(res => res as unknown as any),
  restore: (noteId: string, versionNo: number) => api.post(`/notes/${noteId}/versions/${versionNo}/restore`, {}).then(res => res as unknown as any),
}

export const auditAPI = {
  list: (resourceType?: string, resourceId?: string, eventType?: string, page: number = 1, size: number = 20) => api.get('/audit/logs', { params: { resourceType, resourceId, eventType, page, size } }).then(res => res as unknown as { items: any[]; page: number; size: number; total: number }),
}

export const notificationsAPI = {
  list: (page: number = 1, size: number = 20, type?: string, status?: string) => {
    const token = getToken()
    if (!token) {
      return Promise.resolve({ items: [], page, size, total: 0 }) as Promise<{ items: any[]; page: number; size: number; total: number }>
    }
    return api
      .get('/notifications', { params: { page, size, type, status }, headers: { 'X-Skip-Auth-Redirect': '1' } })
      .then(res => res as unknown as { items: any[]; page: number; size: number; total: number })
  },
  markRead: (id: string) =>
    api
      .patch(`/notifications/${id}/read`, {})
      .then(res => {
        // 通知全局刷新未读计数（用于顶部铃铛角标）
        try {
          const evt = new CustomEvent('notify:refresh', { detail: { source: 'markRead', id } })
          if (typeof document !== 'undefined') document.dispatchEvent(evt)
        } catch { }
        return res as unknown as any
      }),
}

export const commentsAPI = {
  list: (noteId: string, params?: { start?: number; end?: number; intersects?: boolean; blockId?: string; versionId?: string; limit?: number; cursor?: string }) =>
    api.get(`/notes/${noteId}/comments`, { params }).then(res => res as unknown as any[]),
  create: (noteId: string, start?: number, end?: number, text?: string, options?: { anchor?: any; blockId?: string; idempotencyKey?: string }) =>
    api.post(`/notes/${noteId}/comments`, { start, end, text, anchor: options?.anchor, blockId: options?.blockId }, { headers: options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : undefined }).then(res => res as unknown as any),
  reply: (commentId: string, text: string) => api.post(`/comments/${commentId}/replies`, { text }).then(res => res as unknown as any),
  delete: (commentId: string) => api.delete(`/comments/${commentId}`).then(res => res as unknown as { ok: boolean }),
}

export const noteLockAPI = {
  lock: (noteId: string) => api.post(`/notes/${noteId}/lock`, {}).then(res => res as unknown as any),
  unlock: (noteId: string) => api.delete(`/notes/${noteId}/lock`).then(res => res as unknown as any),
}

// 保存筛选相关API
export const savedFiltersAPI = {
  getAll: () =>
    api.get<SavedFilter[]>('/saved-filters').then(res => res as unknown as SavedFilter[]),

  create: (data: CreateSavedFilterDto) =>
    api.post<SavedFilter>('/saved-filters', data).then(res => res as unknown as SavedFilter),

  delete: (id: string) =>
    api.delete(`/saved-filters/${id}`).then(res => res as unknown as void),
}

// 分类相关API
export const categoriesAPI = {
  getAll: (signal?: AbortSignal) =>
    api.get<Category[]>('/categories', { signal }).then(res => {
      const data = res as unknown as any[]
      const mapped = data.map(item => ({ ...item, id: item.id || item._id })) as Category[]
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
      return { ...item, id: item.id || item._id } as Category
    }),

  update: (id: string, payload: Partial<{
    name: string
    description?: string
    color?: string
    parentId?: string | null
  }>) =>
    api.patch<Category>(`/categories/${id}`, payload).then(res => {
      const item = res as unknown as any
      return { ...item, id: item.id || item._id } as Category
    }),

  delete: (id: string) =>
    api.delete(`/categories/${id}`).then(res => res as unknown as void),
}

// 标签相关API
export const tagsAPI = {
  getAll: (signal?: AbortSignal) =>
    api.get<Tag[]>('/tags', { signal }).then(res => {
      const data = res as unknown as any[]
      return data.map(item => ({ ...item, id: item.id || item._id })) as Tag[]
    }),

  update: (id: string, payload: Partial<{ name: string; color: string }>) =>
    api.patch<Tag>(`/tags/${id}`, payload).then(res => {
      const item = res as unknown as any
      return { ...item, id: item.id || item._id } as Tag
    }),

  create: (name: string) =>
    api.post<Tag>('/tags', { name }).then(res => {
      const item = res as unknown as any
      return { ...item, id: item.id || item._id } as Tag
    }),

  bulkCreate: (names: string[]) =>
    api.post<{ created: Tag[]; skipped: string[] }>(`/tags/bulk`, { names }).then(res => res as unknown as { created: Tag[]; skipped: string[] }),

  merge: (sourceIds: string[], targetId: string) =>
    api.post<{ affectedNotes: number }>(`/tags/merge`, { sourceIds, targetId }).then(res => res as unknown as { affectedNotes: number }),

  delete: (id: string) =>
    api.delete(`/tags/${id}`, { params: { mode: 'remove' } }).then(res => res as unknown as void),
}

// 仪表盘相关 API
export const dashboardAPI = {
  getOverview: () =>
    api.get<DashboardOverview>('/dashboard/overview').then(res => res as unknown as DashboardOverview),
}

// 网络状态相关 API
export const networkAPI = {
  // 尝试 ping 健康检查端点，失败则回退到轻量请求
  ping: async (): Promise<{ ok: boolean; latency: number; status?: number }> => {
    const start = Date.now()
    try {
      const resp = await api.get('/health')
      const latency = Date.now() - start
      return { ok: true, latency, status: 200 }
    } catch (e: any) {
      // 回退：请求最小数据以检测连通性
      try {
        const start2 = Date.now()
        await api.get('/notes', { params: new URLSearchParams({ limit: '1' }) })
        const latency = Date.now() - start2
        return { ok: true, latency, status: 200 }
      } catch (err: any) {
        const latency = Date.now() - start
        const status = err?.response?.status
        return { ok: false, latency, status }
      }
    }
  },
}

// 导出常用API简化调用
export const login = authAPI.login
export const register = authAPI.register
export const fetchNotes = notesAPI.getAllCached
export const semanticSearch = semanticAPI.search
export const fetchNoteById = notesAPI.getById
export const createNote = notesAPI.create
export const updateNote = notesAPI.update
export const deleteNote = notesAPI.delete
export const fetchCategories = categoriesAPI.getAll
export const createCategory = categoriesAPI.create
export const updateCategory = categoriesAPI.update
export const deleteCategory = categoriesAPI.delete
export const fetchTags = tagsAPI.getAll
export const createTag = tagsAPI.create
export const deleteTag = tagsAPI.delete
export const fetchDashboardOverview = dashboardAPI.getOverview
export const fetchAcl = aclAPI.get
export const createInvitation = invitationsAPI.create
export const listInvitations = invitationsAPI.list
export const previewInvitation = invitationsAPI.preview
export const acceptInvitation = invitationsAPI.accept
export const revokeInvitation = invitationsAPI.revoke
export const listMyInvitations = invitationsAPI.mine
export const listNotifications = notificationsAPI.list
export const markNotificationRead = notificationsAPI.markRead
export const listVersions = versionsAPI.list
export const snapshotVersion = versionsAPI.snapshot
export const restoreVersion = versionsAPI.restore
export const listAuditLogs = auditAPI.list
export const listComments = commentsAPI.list
export const createComment = commentsAPI.create
export const replyComment = commentsAPI.reply
export const lockNote = noteLockAPI.lock
export const unlockNote = noteLockAPI.unlock
