'use client'
import { listAuditLogs } from '@/lib/api'
import { useEffect, useState } from 'react'

export default function ActivityPage() {
  const [items, setItems] = useState<any[]>([])
  const [page, setPage] = useState(1)
  const load = async (p = 1) => {
    const r = await listAuditLogs(undefined, undefined, undefined, p, 20)
    setItems(r.items || [])
    setPage(r.page)
  }
  useEffect(() => { load(1) }, [])
  return (
    <div className="p-4 space-y-4">
      <div className="font-semibold">活动日志</div>
      <ul className="space-y-2">
        {items.map((e, i) => (
          <li key={i} className="text-sm border rounded px-3 py-2">{e.eventType} · {e.resourceType} · {new Date(e.createdAt).toLocaleString()}</li>
        ))}
        {items.length === 0 && <div className="text-sm text-gray-500">暂无日志</div>}
      </ul>
    </div>
  )
}
