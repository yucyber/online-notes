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
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 3000,
})

// 请求拦截器添加token
api.interceptors.request.use(
  (config) => {
    const rid = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
      ; (config as any).__rid = rid
    config.headers['X-Request-ID'] = rid
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
  getAll: (params?: NoteFilterParams, signal?: AbortSignal) => {
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
    }
    console.log('Requesting /notes with params:', Object.fromEntries(sp.entries()))
    return api.get<Note[]>('/notes', { params: sp, signal }).then(res => res as unknown as Note[])
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
  list: (page: number = 1, size: number = 20, type?: string, status?: string) => api.get('/notifications', { params: { page, size, type, status } }).then(res => res as unknown as { items: any[]; page: number; size: number; total: number }),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`, {}).then(res => res as unknown as any),
}

export const commentsAPI = {
  list: (noteId: string) => api.get(`/notes/${noteId}/comments`).then(res => res as unknown as any[]),
  create: (noteId: string, start: number, end: number, text: string) => api.post(`/notes/${noteId}/comments`, { start, end, text }).then(res => res as unknown as any),
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
export const fetchNotes = notesAPI.getAll
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
