import { postTyped } from './client'
import type { User, LoginCredentials, RegisterCredentials } from '@/types'

export const authAPI = {
  login: (credentials: LoginCredentials) =>
    postTyped<{ user: User }>('/auth/login', credentials),

  register: (data: RegisterCredentials) =>
    postTyped<{ user: User }>('/auth/register', data),

  sendEmailCode: (email: string) =>
    postTyped<{ message: string }>('/auth/email-code', { email }, { timeout: 15_000 }),
}
