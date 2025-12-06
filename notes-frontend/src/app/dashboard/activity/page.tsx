'use client'
import { listAuditLogs } from '@/lib/api'
import { usePaginationSync } from '@/hooks/usePaginationSync'
import { Pagination, PageSizeSelect } from '@/components/ui/pagination'
import { useEffect, useState } from 'react'

export default function ActivityPage() {
  const [items, setItems] = useState<any[]>([])
  const { page, size, setPage, setSize } = usePaginationSync({ page: 1, size: 20 })
  const [total, setTotal] = useState(0)
  const load = async () => {
    const r = await listAuditLogs(undefined, undefined, undefined, page, size)
    setItems(r.items || [])
    setTotal(Number(r.total || 0))
  }
  useEffect(() => { load() }, [page, size])
  return (
    <div className="p-4 space-y-4">
      <div className="font-semibold">活动日志</div>
      <div className="flex items-center justify-between">
        <PageSizeSelect size={size} onSizeChange={setSize} />
        <Pagination page={page} size={size} total={total} onPageChange={setPage} />
      </div>
      <ul className="space-y-2">
        {items.map((e, i) => (
          <li key={i} className="text-sm border rounded px-3 py-2">{e.eventType} · {e.resourceType} · {new Date(e.createdAt).toLocaleString()}</li>
        ))}
        {items.length === 0 && <div className="text-sm text-gray-500">暂无日志</div>}
      </ul>
    </div>
  )
}
