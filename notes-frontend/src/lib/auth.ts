import { User } from '@/types'

export const AUTH_CHANGED_EVENT = 'notes:auth-changed'

const USER_KEY = 'notes_user'

const emitAuthChanged = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT))
  }
}

// Cookie 由后端以 HttpOnly 方式设置，前端无法读取 token 值
// 用户信息存 localStorage 供客户端渲染使用
export const setStoredUser = (user: User): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    emitAuthChanged()
  }
}

export const getStoredUser = (): User | null => {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    localStorage.removeItem(USER_KEY)
    return null
  }
}

export const removeStoredUser = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(USER_KEY)
    emitAuthChanged()
  }
}

// 同步检查：有存储用户信息即视为已登录
// 服务端会真正验证 HttpOnly Cookie，此处仅用于客户端路由守卫
export const isAuthenticated = (): boolean => {
  return getStoredUser() !== null
}

export const getCurrentUser = (): User | null => {
  return getStoredUser()
}

// 登录/注册成功后持久化用户信息；token 由后端写入 HttpOnly Cookie，无需前端传递
export const persistAuthSession = (user: User): void => {
  setStoredUser(user)
}

// 登出：调用后端清除 Cookie，再清除本地用户信息
export const logout = async (): Promise<void> => {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  } catch {
    // 即使后端调用失败也清除本地状态
  }
  removeStoredUser()
}
