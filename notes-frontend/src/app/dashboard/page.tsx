'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchDashboardOverview, fetchTags } from '@/lib/api'
import type { DashboardOverview, Tag } from '@/types'
import { formatDate, truncateText } from '@/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  NotebookPen,
  FolderTree,
  Tags as TagsIcon,
  RefreshCcw,
  ArrowRight,
} from 'lucide-react'
import { TopicClusters } from '@/components/dashboard/TopicClusters'

export default function DashboardPage() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tagMap, setTagMap] = useState<Record<string, string>>({})

  const resolveTagId = (tag: { id?: string; _id?: string } | string) => {
    if (typeof tag === 'string') return tag
    return tag.id || tag._id || ''
  }

  const resolveTagLabel = (tag: { name?: string; id?: string; _id?: string } | string) => {
    if (typeof tag === 'string') return tagMap[tag] || tag
    const id = tag.id || tag._id || ''
    return tag.name || (id ? (tagMap[id] || '') : '')
  }

  const loadOverview = async () => {
    try {
      setLoading(true)
      setError('')
      // 优先加载核心概览，尽快结束首屏阻塞，提高 FCP/LCP
      const data = await fetchDashboardOverview()
      setOverview(data)
      setLoading(false)
      // 标签映射异步加载，不阻塞首屏
      fetchTags()
        .then((tags) => {
          const map = (tags || []).reduce<Record<string, string>>((acc, t) => {
            if (t?.id) acc[t.id] = t.name
            return acc
          }, {})
          setTagMap(map)
        })
        .catch(() => void 0)
    } catch (err) {
      console.error('Failed to load dashboard overview', err)
      setError('获取仪表盘数据失败，请稍后重试')
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOverview()
  }, [])

  const statCards = [
    {
      label: '总笔记数',
      value: overview?.stats.notes ?? 0,
      icon: NotebookPen,
      color: 'bg-blue-500/10 text-blue-600',
    },
    {
      label: '分类数',
      value: overview?.stats.categories ?? 0,
      icon: FolderTree,
      color: 'bg-green-500/10 text-green-600',
    },
    {
      label: '标签数',
      value: overview?.stats.tags ?? 0,
      icon: TagsIcon,
      color: 'bg-indigo-500/10 text-indigo-600',
    },
  ]

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <RefreshCcw className="h-6 w-6 animate-spin" />
          加载仪表盘数据中...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col gap-3">
        <h1
          className="text-4xl font-bold"
          style={{
            background: 'linear-gradient(to right, #111827, #2563eb, #111827)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          仪表盘
        </h1>
        <p className="text-lg" style={{ color: 'var(--text-muted)' }}>
          快速了解知识库概况，继续完成您的创作与整理工作
        </p>
      </div>

      {error && (
        <Card className="text-sm" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--on-surface)' }}>
          <CardContent className="py-4 flex items-center justify-between">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={loadOverview}>重试</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {statCards.map((card) => (
          <Card key={card.label} className="card-hover" style={{ borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{card.label}</CardTitle>
              <div aria-hidden style={{ background: 'var(--surface-2)', color: 'var(--primary-600)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, boxShadow: 'var(--shadow-sm)' }}>
                <card.icon className="h-6 w-6" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold mb-1" style={{ color: 'var(--on-surface)' }}>{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <TopicClusters />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="card-hover" style={{ boxShadow: 'var(--shadow-md)', borderColor: 'var(--border)' }}>
          <CardHeader className="flex flex-row items-center justify-between border-b pb-4" style={{ borderColor: 'var(--border)' }}>
            <div>
              <CardTitle className="text-xl font-bold" style={{ color: 'var(--on-surface)' }}>最近编辑</CardTitle>
              <CardDescription className="mt-1">按更新时间倒序展示最近 5 条笔记</CardDescription>
            </div>
            <Link href="/dashboard/notes/new">
              <Button variant="default" size="sm">
                新建笔记
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            {overview?.recentNotes.length ? (
              overview.recentNotes.map((note) => (
                <div key={note.id} className="group rounded-xl p-5 transition-all duration-300 ease-out cursor-pointer" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <Link
                      href={`/dashboard/notes/${note.id}`}
                      className="text-lg font-bold transition-colors duration-200 group-hover:text-primary-600"
                      style={{ color: 'var(--on-surface)' }}
                    >
                      {note.title || '无标题笔记'}
                    </Link>
                    <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                      {formatDate(note.updatedAt)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm line-clamp-2 leading-relaxed" style={{ color: 'var(--on-surface)' }}>
                    {truncateText(note.preview || '', 120)}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    {note.category && note.category.id && note.category.name && (
                      <Link
                        href={`/dashboard/notes?categoryId=${note.category.id}`}
                        className="rounded-full px-3 py-1.5 font-medium shadow-sm border"
                        style={{
                          background: 'var(--surface-1)',
                          color: 'var(--on-surface)',
                          borderColor: `${note.category.color || '#e5e7eb'}40`,
                          backgroundColor: `${note.category.color || '#e5e7eb'}15`
                        }}
                      >
                        {note.category.name}
                      </Link>
                    )}
                    {note.tags.map((tag, idx) => {
                      const id = resolveTagId(tag as any)
                      const label = resolveTagLabel(tag as any)
                      const content = label || id || '标签'
                      return id ? (
                        <Link
                          key={id}
                          href={`/dashboard/notes?tagIds=${id}`}
                          className="rounded-full px-3 py-1.5 font-medium shadow-sm"
                          style={{ background: 'var(--primary-50)', color: 'var(--primary-600)', border: '1px solid var(--primary-100)' }}
                        >
                          #{content}
                        </Link>
                      ) : (
                        <span
                          key={`${content}-${idx}`}
                          className="rounded-full px-3 py-1.5 font-medium shadow-sm opacity-80"
                          style={{ background: 'var(--primary-50)', color: 'var(--primary-600)', border: '1px solid var(--primary-100)' }}
                          title="该标签暂不可点击"
                        >
                          #{content}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6" style={{ color: 'var(--text-muted)' }}>
                暂无笔记内容，点击右上角「新建笔记」开始创作
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-white shadow-md hover:shadow-2xl card-hover">
          <CardHeader className="flex flex-row items-center justify-between border-b border-gray-100 pb-4">
            <div>
              <CardTitle className="text-xl font-bold text-gray-900">分类概览</CardTitle>
              <CardDescription className="mt-1">了解不同知识领域下的笔记数量</CardDescription>
            </div>
            <Link href="/dashboard/categories">
              <Button variant="outline" size="sm">
                管理分类
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            {overview?.topCategories.length ? (
              overview.topCategories.map((category) => (
                <div key={category.id} className="group flex items-center justify-between rounded-xl px-5 py-4 transition-all duration-300 ease-out cursor-pointer" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
                  <div className="flex items-center gap-4">
                    <div
                      className="h-4 w-4 rounded-full shadow-sm ring-2"
                      style={{ backgroundColor: category.color || '#CBD5F5' }}
                    />
                    <div>
                      <p className="font-bold text-base" style={{ color: 'var(--on-surface)' }}>{category.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {category.noteCount ?? 0} 条笔记
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/dashboard/notes?categoryId=${category.id}`}
                    className="text-sm font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-200"
                    style={{ color: 'var(--primary-600)' }}
                  >
                    查看
                    <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              ))
            ) : (
              <div className="text-center py-6" style={{ color: 'var(--text-muted)' }}>
                暂无分类数据，前往分类管理页面创建一个新的分类
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
