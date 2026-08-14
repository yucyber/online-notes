'use client'
import { listAuditLogs } from '@/lib/api'
import { usePaginationSync } from '@/hooks/usePaginationSync'
import { Pagination, PageSizeSelect } from '@/components/ui/pagination'
import { Fragment, useEffect, useState } from 'react'

const eventLabels: Record<string, string> = {
  invitation_created: '创建了协作邀请',
  invitation_accepted: '接受了协作邀请',
  comment_created: '添加了评论',
  comment_deleted: '删除了评论',
  note_created: '创建了笔记',
  note_updated: '更新了笔记',
}

function formatAuditEvent(event: any) {
  const action = eventLabels[event.eventType] || event.eventType || '执行了操作'
  const target = event.resourceType === 'note' ? '笔记' : (event.resourceType || '内容')
  return `${action} · ${target}`
}

export default function ActivityPage() {
  const [items, setItems] = useState<any[]>([])
  const { page, size, setPage, setSize } = usePaginationSync({ page: 1, size: 20 })
  const [total, setTotal] = useState(0)

  useEffect(() => {
    const load = async () => {
      const r = await listAuditLogs(undefined, undefined, undefined, page, size)
      setItems(r.items || [])
      setTotal(Number(r.total || 0))
    }
    load()
  }, [page, size])
  return (
    <div className="space-y-6">
      <div className="product-page-header"><h1 className="page-heading">活动日志</h1><p className="page-description">查看账户与内容的近期变更记录。</p></div>
      <div className="product-filter-bar"><button className="is-active">全部动作</button><button>协作</button><button>内容</button><button>最近 30 天</button></div>
      <ul className="product-timeline">
        {items.map((e, i) => {
          const date = new Date(e.createdAt)
          const dateLabel = date.toLocaleDateString()
          const previousLabel = i > 0 ? new Date(items[i - 1].createdAt).toLocaleDateString() : ''
          return <Fragment key={e.id || e._id || i}>{dateLabel !== previousLabel && <li className="prototype-timeline-date">{dateLabel === new Date().toLocaleDateString() ? '今天' : dateLabel}</li>}<li className="prototype-event"><b>{formatAuditEvent(e).split(' · ')[0]}</b><p>{e.resourceType === 'note' ? '笔记' : (e.resourceType || '内容')} · {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></li></Fragment>
        })}
        {items.length === 0 && <li className="px-4 py-12 text-center text-sm text-[var(--product-muted)]">暂无活动记录</li>}
      </ul>
      <div className="prototype-pager"><PageSizeSelect size={size} onSizeChange={setSize} /><Pagination page={page} size={size} total={total} onPageChange={setPage} /></div>
    </div>
  )
}
