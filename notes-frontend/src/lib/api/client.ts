import axios from 'axios'
import { getToken, removeToken } from '../auth'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 3000,
  withCredentials: false,
})

const RUM_ENDPOINT = process.env.NEXT_PUBLIC_RUM_ENDPOINT || ''
export const emitRum = (detail: any) => {
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
    emitRum({ type: 'network', name: 'api:error', value: duration, meta: { url, method: (error.config?.method || 'get'), status, message: error.message, searchId: (error.config as any)?.__searchId } })
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

export default api
