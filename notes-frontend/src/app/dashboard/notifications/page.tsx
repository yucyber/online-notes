'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { listMyInvitations, listNotifications, markNotificationRead, previewInvitation, acceptInvitation } from '@/lib/api'
import { usePaginationSync } from '@/hooks/usePaginationSync'
import { Pagination, PageSizeSelect } from '@/components/ui/pagination'
import { Button } from '@/components/ui/button'

export default function NotificationsPage() {
  const router = useRouter()
  const [invites, setInvites] = useState<any[]>([])
  const [notes, setNotes] = useState<{ items: any[]; page: number; size: number; total: number } | null>(null)
  const { page, size, setPage, setSize } = usePaginationSync({ page: 1, size: 20 })
  const load = async () => {
    try {
      const iv = await listMyInvitations('pending')
      setInvites(iv || [])
      const ns = await listNotifications(page, size, undefined, 'unread')
      setNotes(ns)
    } catch {}
  }
  useEffect(() => { load() }, [page, size])

  const accept = async (tokenHashOrToken: string) => {
    try {
      // 直接跳转到接受页或调用接受接口
      // 此处尝试预览以获得明文token路径
      router.push(`/invitations/${tokenHashOrToken}/accept`)
    } catch {}
  }

  const markReadClick = async (id: string) => { await markNotificationRead(id); await load() }

  return (
    <div className="p-6 space-y-6">
      <div className="text-lg font-semibold">消息中心</div>
      <div className="space-y-3">
        <div className="text-sm font-medium">待接受邀请</div>
        <ul className="space-y-2">
          {invites.map((v, i) => (
            <li key={i} className="flex items-center justify-between border rounded px-3 py-2">
              <span className="text-sm">笔记 {v.noteId} · 角色 {v.role} · 截止 {new Date(v.expiresAt).toLocaleString()}</span>
              <div className="flex gap-2">
                <Button onClick={() => accept(v.hash)}>接受</Button>
              </div>
            </li>
          ))}
          {invites.length === 0 && <div className="text-sm text-gray-500">暂无待处理邀请</div>}
        </ul>
      </div>
      <div className="space-y-3">
        <div className="text-sm font-medium">未读通知</div>
        <div className="flex items-center justify-between">
          <PageSizeSelect size={size} onSizeChange={setSize} />
          <Pagination page={page} size={size} total={Number(notes?.total || 0)} onPageChange={setPage} />
        </div>
        <ul className="space-y-2">
          {(notes?.items || []).map((n: any) => (
            <li key={n.id || n._id} className="flex items-center justify-between border rounded px-3 py-2">
              <span className="text-sm">{n.type} · {new Date(n.createdAt).toLocaleString()}</span>
              <Button variant="outline" onClick={() => markReadClick(n.id || n._id)}>标记已读</Button>
            </li>
          ))}
          {(!notes || (notes.items || []).length === 0) && <div className="text-sm text-gray-500">暂无通知</div>}
        </ul>
      </div>
    </div>
  )
}
