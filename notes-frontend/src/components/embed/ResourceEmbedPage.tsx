'use client'
import { useState, useEffect, useRef } from 'react'

type Props<T> = {
  loader: () => Promise<T>
  renderer: (data: T) => React.ReactNode
  notFoundMessage?: string
}

// boards/mindmaps embed 页面共用的加载-渲染框架，用 ref 缓存 loader 引用避免无限循环
export function ResourceEmbedPage<T>({ loader, renderer, notFoundMessage = '未找到内容' }: Props<T>) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loaderRef = useRef(loader)

  useEffect(() => {
    loaderRef.current()
      .then((d) => setData(d))
      .catch(() => setError('加载失败'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-500 text-sm">{'加载中…'}</div>
  if (error) return <div className="flex items-center justify-center h-screen text-red-500 text-sm">{error}</div>
  if (!data) return <div className="flex items-center justify-center h-screen text-gray-500 text-sm">{notFoundMessage}</div>
  return <>{renderer(data)}</>
}
