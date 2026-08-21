'use client'
import { listAuditLogs } from '@/lib/api'
import { usePaginationSync } from '@/hooks/usePaginationSync'
import { Pagination, PageSizeSelect } from '@/components/ui/pagination'
import type { AuditEvent } from '@/types'
import { Fragment, useEffect, useState } from 'react'

const eventLabels: Record<string, string> = {
  invitation_created: '创建了协作邀请',
  invitation_accepted: '接受了协作邀请',
  invitation_revoked: '撤销了协作邀请',
  collaborator_role_changed: '调整了协作者权限',
  collaborator_removed: '移除了协作者',
  comment_created: '添加了评论',
  comment_deleted: '删除了评论',
  comment_replied: '回复了评论',
  version_created: '保存了版本',
  version_restored: '还原了版本',
  note_created: '创建了笔记',
  note_deleted: '删除了笔记',
}

// 返回 { title, meta }：主行"动作 + 笔记名"，副行"操作者 · 对象 · 权限"（按事件类型动态取舍）
function formatAuditEvent(event: AuditEvent): { title: string; meta?: string } {
  const action = eventLabels[event.eventType] || event.eventType || '执行了操作'
  // 笔记名优先用审计附加的 noteTitle；删除后笔记已不存在，回退到快照 after.title。
  const noteTitle = event.noteTitle || (event.after || {}).title
  const note = noteTitle ? `《${noteTitle}》` : ''
  const after = event.after || {}
  const roleText = after.role
    ? (after.role === 'editor' ? '可编辑' : after.role === 'viewer' ? '只读' : after.role)
    : ''
  // 副行构成：操作者 + （对象） + （权限）。各部分按事件类型动态取舍，避免空段。
  let subject = ''
  if (event.eventType === 'invitation_accepted') {
    subject = after.inviterName || after.inviterEmail || ''
  } else if (event.eventType === 'collaborator_role_changed' || event.eventType === 'collaborator_removed') {
    subject = after.displayName || after.email || ''
  } else if (after.role) {
    subject = after.inviteeName || after.inviteeEmail || ''
  }
  const metaParts = [event.actorName, subject, roleText].filter(Boolean)
  const meta = metaParts.join(' · ')
  return { title: `${action}${note}`, meta: meta || undefined }
}

type FilterTab = 'all' | 'collab' | 'notes' | 'recent'

export default function ActivityPage() {
  const [items, setItems] = useState<AuditEvent[]>([])
  const { page, size, setPage, setSize } = usePaginationSync({ page: 1, size: 20 })
  const [total, setTotal] = useState(0)
  const [tab, setTab] = useState<FilterTab>('all')

  // tab 过滤下推后端：协作=邀请/协作者/评论，笔记=版本/笔记生命周期，最近30天=时间窗。
  // 这样分页与 total 都基于过滤后的真实数据，避免客户端过滤导致分页不准。
  const tabFilter = (() => {
    if (tab === 'collab') return { eventTypePrefixes: ['invitation_', 'comment_', 'collaborator_'] }
    if (tab === 'notes') return { eventTypePrefixes: ['version_', 'note_'] }
    if (tab === 'recent') return { since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }
    return {}
  })()

  useEffect(() => {
    const load = async () => {
      const r = await listAuditLogs(undefined, undefined, undefined, tabFilter.eventTypePrefixes, tabFilter.since, page, size)
      setItems(r.items || [])
      setTotal(Number(r.total || 0))
    }
    load()
  }, [page, size, tab])

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: '全部动作' },
    { key: 'collab', label: '协作' },
    { key: 'notes', label: '笔记' },
    { key: 'recent', label: '最近 30 天' },
  ]

  return (
    <div className="space-y-6">
      <div className="product-page-header"><h1 className="page-heading">活动日志</h1><p className="page-description">查看账户与内容的近期变更记录。</p></div>
      <div className="product-filter-bar">{tabs.map(({ key, label }) => (
        <button key={key} className={tab === key ? 'is-active' : ''} onClick={() => { setTab(key); setPage(1) }}>{label}</button>
      ))}</div>
      <ul className="product-timeline">
        {items.map((e, i) => {
          const date = new Date(e.createdAt)
          const dateLabel = date.toLocaleDateString()
          const previousLabel = i > 0 ? new Date(items[i - 1].createdAt).toLocaleDateString() : ''
          const { title, meta } = formatAuditEvent(e)
          return <Fragment key={e.id || e._id || i}>{dateLabel !== previousLabel && <li className="prototype-timeline-date">{dateLabel === new Date().toLocaleDateString() ? '今天' : dateLabel}</li>}<li className="prototype-event"><b>{title}</b>{meta ? <small className="prototype-event-meta">{meta}</small> : null}<p>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></li></Fragment>
        })}
        {items.length === 0 && <li className="px-4 py-12 text-center text-sm text-[var(--product-muted)]">暂无活动记录</li>}
      </ul>
      <div className="prototype-pager"><PageSizeSelect size={size} onSizeChange={setSize} /><Pagination page={page} size={size} total={total} onPageChange={setPage} /></div>
    </div>
  )
}
