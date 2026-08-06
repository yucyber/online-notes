export type CollabStatus =
  | 'config-missing'
  | 'auth-missing'
  | 'auth-expired'
  | 'auth-failed'
  | 'connecting'
  | 'connected'
  | 'disconnected'

export const COLLAB_STATUS_META: Record<CollabStatus, { label: string; className: string; detail?: string }> = {
  'config-missing': { label: '协作配置缺失', className: 'text-red-600', detail: '已本地降级' },
  'auth-missing': { label: '协作需要登录', className: 'text-red-600', detail: '已本地降级' },
  'auth-expired': { label: '登录已过期，协作已暂停', className: 'text-red-600', detail: '请重新登录后重连' },
  'auth-failed': { label: '协作鉴权失败', className: 'text-red-600', detail: '请重新登录后重连' },
  connecting: { label: '连接中', className: 'text-yellow-600' },
  connected: { label: '已连接', className: 'text-green-600' },
  disconnected: { label: '已断开', className: 'text-red-600' },
}

export function colorFromString(s: string) {
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash)
  const c = (hash & 0x00ffffff).toString(16).toUpperCase()
  return '#' + '00000'.substring(0, 6 - c.length) + c
}

export function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  const bigint = parseInt(h, 16)
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 }
}

export function srgb(x: number) {
  x /= 255
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

export function sanitizeHTML(html: string) {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const dangerousTags = ['style', 'script', 'link', 'meta', 'title', 'iframe', 'object', 'embed']
    dangerousTags.forEach(tag => Array.from(doc.getElementsByTagName(tag)).forEach(el => el.remove()))
    const all = doc.body.querySelectorAll('*')
    all.forEach(el => {
      const className = el.getAttribute('class') || ''
      if (!className.includes('collaboration-cursor') && !className.includes('rounded')) {
        el.removeAttribute('style')
      }
      Array.from(el.attributes).forEach(attr => {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on')) el.removeAttribute(attr.name)
      })
    })
    const cleaned = doc.body.innerHTML || ''
    const looksPlain = !/[<][a-zA-Z]/.test(cleaned)
    if (looksPlain) {
      const text = doc.body.textContent || ''
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<p>${escaped}</p>`
    }
    return cleaned
  } catch {
    return html
  }
}
