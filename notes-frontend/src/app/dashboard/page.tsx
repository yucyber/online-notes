'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PrototypeGlyph } from '@/components/ui/prototype-glyph'
import { fetchDashboardOverview } from '@/lib/api'
import type { DashboardOverview } from '@/types'
import { formatDate } from '@/utils'

export default function DashboardPage() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadOverview = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      setOverview(await fetchDashboardOverview())
    } catch (err) {
      console.error('Failed to load dashboard overview', err)
      setError('获取仪表盘数据失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadOverview() }, [loadOverview])

  if (loading) return <div className="prototype-loading">加载仪表盘数据中...</div>

  const recentNotes = overview?.recentNotes || []
  const stats = [
    ['全部笔记', overview?.stats.notes ?? 0],
    ['本周更新', recentNotes.length],
    ['分类', overview?.stats.categories ?? 0],
    ['待继续草稿', recentNotes.filter((note: any) => note.status === 'draft').length],
  ] as const

  return <div>
    <header className="prototype-section-head">
      <div><p className="product-eyebrow">ONLINE NOTES</p><h1 className="page-heading">仪表盘</h1><p className="page-description">继续完成今天最重要的整理与写作。</p></div>
      <Link className="prototype-button prototype-button--primary" href={recentNotes[0]?.id ? `/dashboard/notes/${recentNotes[0].id}` : '/dashboard/notes/new'}><PrototypeGlyph name="pen" />继续写作</Link>
    </header>

    {error && <div className="prototype-error"><span>{error}</span><button onClick={loadOverview}>重试</button></div>}

    <div className="product-stat-strip">{stats.map(([label, value]) => <div key={label} className="product-stat"><b>{value}</b><span>{label}</span></div>)}</div>

    <div className="product-split-layout">
      <section>
        <div className="prototype-panel-head"><h2>最近笔记</h2><Link className="prototype-link-button" href="/dashboard/notes">查看全部</Link></div>
        <div className="prototype-plain-list">{recentNotes.length ? recentNotes.slice(0, 5).map((note) => <Link className="prototype-plain-row" key={note.id} href={`/dashboard/notes/${note.id}`}><span><b>{note.title || '无标题笔记'}</b><small>{note.category?.name || '未分类'} · {formatDate(note.updatedAt)}</small></span><small>{formatDate(note.updatedAt)}</small></Link>) : <div className="prototype-empty-row">暂无笔记</div>}</div>
      </section>
      <aside>
        <div className="prototype-panel-head"><h2>继续写作</h2></div>
        <div className="prototype-plain-list">{recentNotes.length ? recentNotes.slice(0, 3).map((note) => <Link className="prototype-plain-row" key={note.id} href={`/dashboard/notes/${note.id}`}><span><b>{note.title || '无标题笔记'}</b><small>约 3 分钟完成</small></span><span>→</span></Link>) : <Link className="prototype-plain-row" href="/dashboard/notes/new"><span><b>开始第一篇笔记</b><small>记录今天的想法</small></span><span>→</span></Link>}</div>
      </aside>
    </div>
  </div>
}
