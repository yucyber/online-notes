'use client'
import { listAuditLogs } from '@/lib/api'
import { usePaginationSync } from '@/hooks/usePaginationSync'
import { Pagination, PageSizeSelect } from '@/components/ui/pagination'
import { Fragment, useEffect, useState } from 'react'

const eventLabels: Record<string, string> = {
  invitation_created: '创建了协作邀请',
  invitation_accepted: '接受了协作邀请',
  invitation_revoked: '撤销了协作邀请',
  comment_created: '添加了评论',
  comment_deleted: '删除了评论',
  comment_replied: '回复了评论',
  version_created: '保存了版本',
  version_restored: '还原了版本',
}

// 返回单行完整描述：动作 + 笔记名 + 邀请对象 + 权限
function formatAuditEvent(event: any) {
  const action = eventLabels[event.eventType] || event.eventType || '执行了操作'
  const note = event.noteTitle ? `《${event.noteTitle}》` : ''
  const after = event.after || {}
  const roleText = after.role
    ? (after.role === 'editor' ? '可编辑' : after.role === 'viewer' ? '只读' : after.role)
    : ''
  // 邀请事件补"对象 + 权限"
  if (after.role) {
    const who = after.inviteeEmail || (after.invitedUserId ? `用户 ${after.invitedUserId.slice(-6)}` : '')
    return `${action}${note}（${who ? `${who}，` : ''}权限：${roleText}）`
  }
  return `${action}${note}`
}

type FilterTab = 'all' | 'collab' | 'content' | 'recent'

export default function ActivityPage() {
  const [items, setItems] = useState<any[]>([])
  const { page, size, setPage, setSize } = usePaginationSync({ page: 1, size: 20 })
  const [total, setTotal] = useState(0)
  const [tab, setTab] = useState<FilterTab>('all')

  useEffect(() => {
    const load = async () => {
      const r = await listAuditLogs(undefined, undefined, undefined, page, size)
      setItems(r.items || [])
      setTotal(Number(r.total || 0))
    }
    load()
  }, [page, size])

  // 协作=邀请/评论；内容=版本；最近30天=时间窗。过滤为纯前端交互，不改变分页数据。
  const filtered = items.filter((e) => {
    if (tab === 'collab') return /^(invitation_|comment_)/.test(e.eventType || '')
    if (tab === 'content') return /^version_/.test(e.eventType || '')
    if (tab === 'recent') return new Date(e.createdAt) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    return true
  })

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: '全部动作' },
    { key: 'collab', label: '协作' },
    { key: 'content', label: '内容' },
    { key: 'recent', label: '最近 30 天' },
  ]

  return (
    <div className="space-y-6">
      <div className="product-page-header"><h1 className="page-heading">活动日志</h1><p className="page-description">查看账户与内容的近期变更记录。</p></div>
      <div className="product-filter-bar">{tabs.map(({ key, label }) => (
        <button key={key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>{label}</button>
      ))}</div>
      <ul className="product-timeline">
        {filtered.map((e, i) => {
          const date = new Date(e.createdAt)
          const dateLabel = date.toLocaleDateString()
          const previousLabel = i > 0 ? new Date(filtered[i - 1].createdAt).toLocaleDateString() : ''
          return <Fragment key={e.id || e._id || i}>{dateLabel !== previousLabel && <li className="prototype-timeline-date">{dateLabel === new Date().toLocaleDateString() ? '今天' : dateLabel}</li>}<li className="prototype-event"><b>{formatAuditEvent(e)}</b><p>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></li></Fragment>
        })}
        {filtered.length === 0 && <li className="px-4 py-12 text-center text-sm text-[var(--product-muted)]">暂无活动记录</li>}
      </ul>
      <div className="prototype-pager"><PageSizeSelect size={size} onSizeChange={setSize} /><Pagination page={page} size={size} total={total} onPageChange={setPage} /></div>
    </div>
  )
}
