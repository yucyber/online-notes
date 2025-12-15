import { jwtDecode } from 'jwt-decode'
import { User } from '@/types'

const TOKEN_KEY = 'notes_token'
const USER_KEY = 'notes_user'

// 设置token
export const setToken = (token: string): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, token)
    // Sync to cookie for Server Components (1 day expiration)
    document.cookie = `${TOKEN_KEY}=${token}; path=/; max-age=86400; SameSite=Lax`
  }
}

// 保存当前用户信息，方便客户端渲染时直接读取
export const setStoredUser = (user: User): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  }
}

// 获取token
export const getToken = (): string | null => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(TOKEN_KEY)
  }
  return null
}

// 移除token
export const removeToken = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    document.cookie = `${TOKEN_KEY}=; path=/; max-age=0`
  }
}

// 读取当前存储的用户
export const getStoredUser = (): User | null => {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    console.warn('Failed to parse stored user')
    localStorage.removeItem(USER_KEY)
    return null
  }
}

// 登录/注册后统一持久化凭据
export const persistAuthSession = (token: string, user: User): void => {
  setToken(token)
  setStoredUser(user)
}

// 检查是否已认证
export const isAuthenticated = (): boolean => {
  const token = getToken()
  if (!token) return false

  try {
    const decoded: { exp: number } = jwtDecode(token)
    return decoded.exp * 1000 > Date.now()
  } catch {
    return false
  }
}

// 获取当前用户信息
export const getCurrentUser = (): User | null => {
  const stored = getStoredUser()
  if (stored) return stored

  const token = getToken()
  if (!token) return null

  try {
    const decoded: { sub: string; email: string } = jwtDecode(token)
    return {
      id: decoded.sub,
      email: decoded.email,
      createdAt: '',
      updatedAt: '',
    }
  } catch {
    return null
  }
}

// 解析token过期时间
export const getTokenExpiration = (token: string): number | null => {
  try {
    const decoded: { exp: number } = jwtDecode(token)
    return decoded.exp * 1000
  } catch {
    return null
  }
}