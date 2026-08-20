import { postTyped } from './client'
import type { User, LoginCredentials } from '@/types'

export const authAPI = {
  login: (credentials: LoginCredentials) =>
    postTyped<{ user: User }>('/auth/login', credentials),

  register: (data: LoginCredentials) =>
    postTyped<{ user: User }>('/auth/register', data),
}
