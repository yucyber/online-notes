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
      const [data, tags] = await Promise.all([
        fetchDashboardOverview(),
        fetchTags().catch(() => [] as Tag[]),
      ])
      setOverview(data)
      const map = (tags || []).reduce<Record<string, string>>((acc, t) => {
        if (t?.id) acc[t.id] = t.name
        return acc
      }, {})
      setTagMap(map)
    } catch (err) {
      console.error('Failed to load dashboard overview', err)
      setError('获取仪表盘数据失败，请稍后重试')
    } finally {
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
        <p className="text-gray-600 text-lg">
          快速了解知识库概况，继续完成您的创作与整理工作
        </p>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 text-sm text-red-600">
          <CardContent className="py-4 flex items-center justify-between">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={loadOverview}>
              重试
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {statCards.map((card) => (
          <Card
            key={card.label}
            className="card-hover bg-white border-gray-200 shadow-md hover:shadow-2xl"
          >
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-medium text-gray-500">
                {card.label}
              </CardTitle>
              <div
                className={`rounded-xl p-3 text-sm ${card.color} shadow-sm`}
                aria-hidden="true"
              >
                <card.icon className="h-6 w-6" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-gray-900 mb-1">
                {card.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-white shadow-md hover:shadow-2xl card-hover">
          <CardHeader className="flex flex-row items-center justify-between border-b border-gray-100 pb-4">
            <div>
              <CardTitle className="text-xl font-bold text-gray-900">最近编辑</CardTitle>
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
                <div
                  key={note.id}
                  className="group rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-5 hover:border-primary-400 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 ease-out cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <Link
                      href={`/dashboard/notes/${note.id}`}
                      className="text-lg font-bold text-gray-900 hover:text-primary-600 transition-colors duration-200 group-hover:text-primary-600"
                    >
                      {note.title || '无标题笔记'}
                    </Link>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {formatDate(note.updatedAt)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-gray-600 line-clamp-2 leading-relaxed">
                    {truncateText(note.preview || '', 120)}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    {note.category && note.category.id && note.category.name && (
                      <Link
                        href={`/dashboard/notes?categoryId=${note.category.id}`}
                        className="rounded-full bg-white px-3 py-1.5 text-gray-700 font-medium shadow-sm border hover:bg-gray-50"
                        style={{
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
                          className="rounded-full bg-primary-50 px-3 py-1.5 text-primary-700 font-medium shadow-sm hover:bg-primary-100"
                        >
                          #{content}
                        </Link>
                      ) : (
                        <span
                          key={`${content}-${idx}`}
                          className="rounded-full bg-primary-50 px-3 py-1.5 text-primary-700 font-medium shadow-sm opacity-80"
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
              <div className="text-center text-gray-500 py-6">
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
                <div
                  key={category.id}
                  className="group flex items-center justify-between rounded-xl border border-gray-200 bg-gradient-to-r from-white to-gray-50 px-5 py-4 hover:border-primary-400 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 ease-out cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="h-4 w-4 rounded-full shadow-sm ring-2 ring-white"
                      style={{ backgroundColor: category.color || '#CBD5F5' }}
                    />
                    <div>
                      <p className="font-bold text-gray-900 text-base">{category.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {category.noteCount ?? 0} 条笔记
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/dashboard/notes?categoryId=${category.id}`}
                    className="text-sm font-medium text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-primary-50 transition-all duration-200"
                  >
                    查看
                    <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              ))
            ) : (
              <div className="text-center text-gray-500 py-6">
                暂无分类数据，前往分类管理页面创建一个新的分类
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
