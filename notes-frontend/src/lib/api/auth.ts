import api from './client'
import type { User, LoginCredentials } from '@/types'

// 认证相关API
export const authAPI = {
  login: (credentials: LoginCredentials) =>
    api.post<{ token: string; user: User }>('/auth/login', credentials).then(res => res as unknown as { token: string; user: User }),

  register: (data: LoginCredentials) =>
    api.post<{ token: string; user: User }>('/auth/register', data).then(res => res as unknown as { token: string; user: User }),

  getCurrentUser: () =>
    api.get<User>('/auth/me').then(res => res as unknown as User),
}
