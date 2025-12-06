'use client'

import { useEffect, useRef } from 'react'

type RumPayload = {
  type: 'web-vitals' | 'collab' | 'network'
  name: string
  value?: number
  noteId?: string
  meta?: Record<string, any>
  ts?: number
}

// 轻量 RUM 发送：优先使用 sendBeacon；若未配置后端端点则仅打印调试日志
function sendRum(payload: RumPayload) {
  const body = JSON.stringify({ ...payload, ts: payload.ts || Date.now() })
  const url = process.env.NEXT_PUBLIC_RUM_ENDPOINT
  try {
    if (url && typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon(url, body)
    } else {
      // 后端尚未接入时，先保留调试输出
      // eslint-disable-next-line no-console
      console.debug('[RUM]', payload)
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('RUM 发送失败', e)
  }
}

export default function RUMClient() {
  const clsValueRef = useRef(0)

  useEffect(() => {
    if (typeof PerformanceObserver !== 'undefined') {
      // LCP
      try {
        const lcpObs = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          const last = entries[entries.length - 1] as any
          if (last && typeof last.startTime === 'number') {
            sendRum({ type: 'web-vitals', name: 'LCP', value: Math.round(last.startTime) })
          }
        })
        lcpObs.observe({ type: 'largest-contentful-paint', buffered: true as any })
      } catch {}

      // FCP
      try {
        const fcpObs = new PerformanceObserver((list) => {
          list.getEntries().forEach((e) => {
            if ((e as any).name === 'first-contentful-paint') {
              sendRum({ type: 'web-vitals', name: 'FCP', value: Math.round(e.startTime) })
            }
          })
        })
        fcpObs.observe({ type: 'paint', buffered: true as any })
      } catch {}

      // CLS（累积）
      try {
        const clsObs = new PerformanceObserver((list) => {
          list.getEntries().forEach((e: any) => {
            if (!e.hadRecentInput) {
              clsValueRef.current += e.value
              sendRum({ type: 'web-vitals', name: 'CLS', value: Number(clsValueRef.current.toFixed(3)) })
            }
          })
        })
        clsObs.observe({ type: 'layout-shift', buffered: true as any })
      } catch {}

      // TTFB（从 navigation entry 推断）
      try {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
        if (nav) {
          const ttfb = Math.round(nav.responseStart)
          sendRum({ type: 'web-vitals', name: 'TTFB', value: ttfb })
        }
      } catch {}

      // FID（首输入延迟，INP 推荐但此处用 first-input 近似）
      try {
        const fidObs = new PerformanceObserver((list) => {
          const entry = list.getEntries()[0] as any
          if (entry) {
            const fid = Math.round(entry.processingStart - entry.startTime)
            sendRum({ type: 'web-vitals', name: 'FID', value: fid })
          }
        })
        fidObs.observe({ type: 'first-input', buffered: true as any })
      } catch {}
    }

    // 监听协作/网络等自定义事件（由业务触发）
    const onRumEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as RumPayload | undefined
      if (!detail) return
      sendRum(detail)
    }
    document.addEventListener('rum', onRumEvent as EventListener)
    return () => {
      document.removeEventListener('rum', onRumEvent as EventListener)
    }
  }, [])

  return null
}

