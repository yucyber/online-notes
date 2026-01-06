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

      console.debug('[RUM]', payload)
    }
  } catch (e) {

    console.warn('RUM 发送失败', e)
  }
}

/**
 * RUMClient 组件用于在前端收集并上报 Web Vitals 性能指标（如 LCP、FCP、CLS、TTFB、FID），
 * 以及监听自定义 RUM 事件，便于前端性能监控与分析。
 *
 * - 通过 PerformanceObserver 监听并上报以下核心指标：
 *   - LCP（Largest Contentful Paint，最大内容绘制）
 *   - FCP（First Contentful Paint，首次内容绘制）
 *   - CLS（Cumulative Layout Shift，累积布局偏移）
 *   - TTFB（Time To First Byte，首字节时间）
 *   - FID（First Input Delay，首次输入延迟）
 * - 支持通过自定义事件（如协作、网络等）上报业务相关 RUM 数据。
 * - 组件本身不渲染任何内容，仅用于副作用。
 *
 * @component
 * @example
 * // 在应用入口处引入即可自动上报性能指标
 * <RUMClient />
 */
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
      } catch { }

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
      } catch { }

      // CLS（累积）
      try {
        const clsObs = new PerformanceObserver((list) => {
          // 遍历所有 layout-shift 条目
          list.getEntries().forEach((e: any) => {
            // 检查是否为用户未主动输入导致的布局偏移
            if (!e.hadRecentInput) {
              // 累加 CLS（累积布局偏移）值
              clsValueRef.current += e.value
              // CLS（累积布局偏移）发生时，发送当前累积值，保留三位小数
              sendRum({ type: 'web-vitals', name: 'CLS', value: Number(clsValueRef.current.toFixed(3)) })
            }
          })
        })
        // 监听 layout-shift 事件以捕获 CLS（累积布局偏移）
        clsObs.observe({ type: 'layout-shift', buffered: true as any })
      } catch { }

      // TTFB（从 navigation entry 推断）
      try {
        // TTFB（首字节时间，从 navigation entry 推断）
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
        if (nav) {
          // 取 responseStart 作为 TTFB 指标，单位为毫秒
          const ttfb = Math.round(nav.responseStart)
          sendRum({ type: 'web-vitals', name: 'TTFB', value: ttfb })
        }
      } catch { }

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
      } catch { }
    }

    // 监听协作/网络等自定义事件（由业务触发）
    /**
     * 处理 RUM（前端监控）事件：从事件对象中提取 `detail` 属性（应包含 RUM 数据），
     * 如果 `detail` 存在且有效，则发送 RUM 数据进行上报。
     *
     * @param e - 事件对象，预期为携带 `detail` 属性的 CustomEvent。
     * @remarks
     * `detail` 属性应为 RumPayload 类型或 undefined，包含 RUM 上报所需的数据。
     * 若未提供或无效，则不会发送任何 RUM 数据。
     */
    const onRumEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as RumPayload | undefined
      // 若事件未携带有效 detail，则不发送 RUM 数据
      if (!detail) return
      sendRum(detail)
    }
    // 监听自定义 rum 事件（如协作、网络等），用于业务侧主动上报 RUM 数据
    document.addEventListener('rum', onRumEvent as EventListener)
    return () => {
      document.removeEventListener('rum', onRumEvent as EventListener)
    }
  }, [])

  return null
}

