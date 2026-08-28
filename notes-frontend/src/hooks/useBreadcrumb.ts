'use client'
import { useEffect } from 'react'

export interface BreadcrumbItem {
  label: string
  href?: string
}

export type BreadcrumbOverride = {
  items: BreadcrumbItem[]
  onRename?: (title: string) => Promise<void>
}

// 与 DashboardLayout 的 dashboard:breadcrumbs 事件对齐；依赖变化或卸载时自动恢复 URL 默认面包屑。
export function useBreadcrumb(override: BreadcrumbOverride | null) {
  useEffect(() => {
    if (!override) return
    document.dispatchEvent(new CustomEvent('dashboard:breadcrumbs', { detail: override }))
    return () => {
      document.dispatchEvent(new CustomEvent('dashboard:breadcrumbs', { detail: null }))
    }
  }, [override])
}
