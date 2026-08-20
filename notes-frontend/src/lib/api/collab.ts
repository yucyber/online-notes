import api from './client'
import { getStoredUser } from '../auth'

export type NoteVisibility = 'private' | 'public'
export type AclRole = 'owner' | 'editor' | 'viewer'

export type Collaborator = {
  userId: string
  role: AclRole
  displayName?: string
  email?: string
  avatarUrl?: string
}

export type AclResponse = {
  visibility: NoteVisibility
  canManage: boolean
  acl: Collaborator[]
}

export type InvitationSummary = {
  id: string
  inviteeEmail?: string
  role: 'editor' | 'viewer'
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  createdAt: string
  expiresAt: string
}

export const aclAPI = {
  get: (noteId: string) => api.get(`/notes/${noteId}/acl`).then(res => res as unknown as AclResponse),
  add: (noteId: string, userId: string, role: 'editor' | 'viewer') => api.post(`/notes/${noteId}/acl`, { userId, role }).then(res => res as unknown as any),
  update: (noteId: string, userId: string, role: 'editor' | 'viewer') => api.patch(`/notes/${noteId}/acl/${userId}`, { role }).then(res => res as unknown as any),
  remove: (noteId: string, userId: string) => api.delete(`/notes/${noteId}/acl/${userId}`).then(res => res as unknown as any),
}

export const invitationsAPI = {
  create: (noteId: string, role: 'editor' | 'viewer', inviteeEmail?: string, ttlHours?: number) => api.post(`/invitations/notes/${noteId}`, { role, inviteeEmail, ttlHours }).then(res => res as unknown as { token: string; expiresAt: string }),
  list: (noteId: string) => api.get(`/invitations/notes/${noteId}`).then(res => res as unknown as InvitationSummary[]),
  preview: (token: string) => api.get(`/invitations/${token}`).then(res => res as unknown as { noteId: string; role: string; expiresAt: string }),
  accept: (token: string) => api.post(`/invitations/${token}/accept`, {}).then(res => res as unknown as any),
  revoke: (token: string) => api.delete(`/invitations/${token}`).then(res => res as unknown as any),
  mine: (status: 'pending' | 'accepted' | 'revoked' | 'expired' = 'pending') => api.get(`/invitations/mine`, { params: { status } }).then(res => res as unknown as any[]),
}

export const versionsAPI = {
  list: (noteId: string) => api.get(`/notes/${noteId}/versions`).then(res => res as unknown as any[]),
  snapshot: (noteId: string, name?: string) => api.post(`/notes/${noteId}/versions`, { name }).then(res => res as unknown as any),
  restore: (noteId: string, versionNo: number) => api.post(`/notes/${noteId}/versions/${versionNo}/restore`, {}).then(res => res as unknown as any),
}

export const auditAPI = {
  list: (resourceType?: string, resourceId?: string, eventType?: string, page: number = 1, size: number = 20) => api.get('/audit/logs', { params: { resourceType, resourceId, eventType, page, size } }).then(res => res as unknown as { items: any[]; page: number; size: number; total: number }),
}

export const notificationsAPI = {
  list: (page: number = 1, size: number = 20, type?: string, status?: string) => {
    const user = getStoredUser()
    if (!user) {
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

