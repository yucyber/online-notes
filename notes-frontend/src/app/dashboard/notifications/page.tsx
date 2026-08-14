'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { listMyInvitations, listNotifications, markNotificationRead } from '@/lib/api'
import { usePaginationSync } from '@/hooks/usePaginationSync'
import { Pagination, PageSizeSelect } from '@/components/ui/pagination'
import { Button } from '@/components/ui/button'

export default function NotificationsPage() {
  const router = useRouter()
  const [invites, setInvites] = useState<any[]>([])
  const [notes, setNotes] = useState<{ items: any[]; page: number; size: number; total: number } | null>(null)
  const { page, size, setPage, setSize } = usePaginationSync({ page: 1, size: 20 })
  const load = useCallback(async () => {
    try {
      const iv = await listMyInvitations('pending')
      setInvites(iv || [])
      const ns = await listNotifications(page, size, undefined, 'unread')
      setNotes(ns)
    } catch {}
  }, [page, size])
  useEffect(() => { void load() }, [load])

  const accept = async (tokenHashOrToken: string) => {
    try {
      // 直接跳转到接受页或调用接受接口
      // 此处尝试预览以获得明文token路径
      router.push(`/invitations/${tokenHashOrToken}/accept`)
    } catch {}
  }

  const markReadClick = async (id: string) => { await markNotificationRead(id); await load() }

  return (
    <div className="space-y-6">
      <div className="product-page-header"><h1 className="page-heading">消息中心</h1><p className="page-description">在一个收件箱中处理邀请和内容通知。</p></div>
      <div className="product-inbox-tabs"><button className="is-active">全部</button><button>邀请 {invites.length}</button><button>未读 {Number(notes?.total || 0)}</button></div>
      <section>
        <ul>
          {invites.map((v, i) => (
            <li key={v.hash || i} className="product-message-row">
              <span className="prototype-message-icon">↗</span>
              <span className="text-sm text-[var(--product-text-secondary)]">笔记 {v.noteId} · 权限 {v.role} · {new Date(v.expiresAt).toLocaleString()}</span>
              <div className="flex gap-2">
                <Button onClick={() => accept(v.hash)}>接受</Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section>
        {(notes?.items || []).length > 0 && <div className="prototype-pager">
          <PageSizeSelect size={size} onSizeChange={setSize} />
          <Pagination page={page} size={size} total={Number(notes?.total || 0)} onPageChange={setPage} />
        </div>}
        <ul>
          {(notes?.items || []).map((n: any) => (
            <li key={n.id || n._id} className="product-message-row">
              <span className="prototype-message-icon">✦</span>
              <span className="text-sm">{n.type} · {new Date(n.createdAt).toLocaleString()}</span>
              <Button variant="outline" onClick={() => markReadClick(n.id || n._id)}>标记已读</Button>
            </li>
          ))}
          {invites.length === 0 && (!notes || (notes.items || []).length === 0) && <li className="prototype-empty-focus"><strong>消息已处理完毕</strong><span>新的邀请和内容通知会显示在这里。</span></li>}
        </ul>
      </section>
    </div>
  )
}
