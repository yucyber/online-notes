'use client'
import { useCallback, useEffect, useState } from 'react'

// 不依赖 next/navigation 的 useSearchParams，改为使用 window.location 与 History API 做分页参数同步
export function usePaginationSync(
  defaults: { page: number; size: number } = { page: 1, size: 20 }
) {
  // 不依赖 next/navigation 的 Hook，完全使用 History API 与 window 维护 URL 与状态

  const [page, setPageState] = useState<number>(defaults.page)
  const [size, setSizeState] = useState<number>(defaults.size)

  const parseFromLocation = useCallback(() => {
    const search = typeof window !== 'undefined' ? window.location.search : ''
    const sp = new URLSearchParams(search)
    const nextPage = Math.max(1, parseInt(sp.get('page') || '', 10) || defaults.page)
    const nextSize = Math.max(1, parseInt(sp.get('size') || '', 10) || defaults.size)
    setPageState(nextPage)
    setSizeState(nextSize)
  }, [defaults.page, defaults.size])

  // 初始化与监听浏览器回退/前进事件保持同步
  useEffect(() => {
    parseFromLocation()
    const onPop = () => parseFromLocation()
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', onPop)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('popstate', onPop)
      }
    }
  }, [parseFromLocation])

  const replaceUrl = useCallback(
    (nextPage: number, nextSize: number) => {
      if (typeof window === 'undefined') return
      const currentSearch = window.location.search
      const params = new URLSearchParams(currentSearch)
      params.set('page', String(Math.max(1, nextPage)))
      params.set('size', String(Math.max(1, nextSize)))
      const pathname = window.location.pathname
      window.history.replaceState(null, '', `${pathname}?${params.toString()}`)
    },
    []
  )

  const setPage = useCallback(
    (next: number) => {
      const nextPage = Math.max(1, next)
      setPageState(nextPage)
      replaceUrl(nextPage, size)
    },
    [replaceUrl, size]
  )

  const setSize = useCallback(
    (next: number) => {
      const nextSize = Math.max(1, next)
      setSizeState(nextSize)
      // 调整每页大小时回到第一页
      setPageState(1)
      replaceUrl(1, nextSize)
    },
    [replaceUrl]
  )

  return { page, size, setPage, setSize }
}
