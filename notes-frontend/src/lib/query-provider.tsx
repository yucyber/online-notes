'use client'

import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // 全局 QueryClient：staleTime 与既有手写列表缓存 TTL(10s) 对齐，避免迁移初期改变请求行为。
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
      },
    },
  }))

  // notes 写操作仍走 notesAPI（不经 RQ mutation），由 clearNotesCache 广播事件，让 RQ 的笔记查询统一失效。
  useEffect(() => {
    const invalidateNotes = () => { void client.invalidateQueries({ queryKey: ['notes'] }) }
    document.addEventListener('notes:cache-cleared', invalidateNotes)
    return () => document.removeEventListener('notes:cache-cleared', invalidateNotes)
  }, [client])

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
