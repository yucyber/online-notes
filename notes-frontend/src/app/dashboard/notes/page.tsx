'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Note, Category, Tag, NoteFilterParams } from '@/types'
import { fetchNotes, deleteNote, fetchCategories, fetchTags } from '@/lib/api'
import { formatDate, truncateText } from '@/utils'
import { Trash2, Plus, Edit, FileText } from 'lucide-react'
import SearchFilterBar from '@/components/SearchFilterBar'
import SmartRecommendations from '@/components/SmartRecommendations'

const extractId = <T extends { id?: string; _id?: string }>(entity?: T | null) =>
  entity?.id || (entity as { _id?: string })?._id || ''

const getCategoryLabel = (note: Note, categoryMap: Record<string, string>) => {
  if (note.category && typeof note.category !== 'string') {
    const directName = note.category.name
    if (directName) return directName
    const inlineId = extractId(note.category as { id?: string; _id?: string })
    if (inlineId && categoryMap[inlineId]) {
      return categoryMap[inlineId]
    }
  }

  const categoryId =
    typeof note.category === 'string'
      ? note.category
      : typeof note.categoryId === 'string'
        ? note.categoryId
        : extractId(note.categoryId as unknown as { id?: string; _id?: string })

  if (categoryId && categoryMap[categoryId]) {
    return categoryMap[categoryId]
  }

  return categoryId || '未分类'
}

export default function NotesPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isCreateHovered, setIsCreateHovered] = useState(false)
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({})
  const [tagMap, setTagMap] = useState<Record<string, string>>({})
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let aborted = false
    controller.signal.addEventListener('abort', () => { aborted = true })
    const loadNotes = async () => {
      try {
        setLoading(true)
        const params: NoteFilterParams = {
          keyword: searchParams.get('keyword') || undefined,
          categoryId: searchParams.get('categoryId') || undefined,
          categoryIds: searchParams.getAll('categoryIds').length > 0 ? searchParams.getAll('categoryIds') : undefined,
          categoriesMode: (searchParams.get('categoriesMode') as 'any' | 'all') || undefined,
          tagIds: searchParams.getAll('tagIds').length > 0 ? searchParams.getAll('tagIds') : undefined,
          tagsMode: (searchParams.get('tagsMode') as 'any' | 'all') || undefined,
          startDate: searchParams.get('startDate') || undefined,
          endDate: searchParams.get('endDate') || undefined,
          status: (searchParams.get('status') as 'published' | 'draft') || undefined,
        }

        const [notesData, categoriesData, tagsData] = await Promise.all([
          fetchNotes(params, controller.signal),
          fetchCategories(controller.signal).catch(() => [] as Category[]),
          fetchTags(controller.signal).catch(() => [] as Tag[]),
        ])

        const mappedCategories = categoriesData.reduce<Record<string, string>>((acc, category) => {
          const categoryId = extractId(category)
          if (categoryId) {
            acc[categoryId] = category.name
          }
          return acc
        }, {})

        const mappedTags = tagsData.reduce<Record<string, string>>((acc, tag) => {
          const tagId = extractId(tag)
          if (tagId) {
            acc[tagId] = tag.name
          }
          return acc
        }, {})

        setNotes(notesData)
        setCategoryMap(mappedCategories)
        setTagMap(mappedTags)
        setError('')
      } catch (err: any) {
        if (aborted || controller.signal.aborted) {
          return
        }
        const message = String(err?.message || '')
        const code = String(err?.code || '')
        const name = String(err?.name || '')
        const isCanceled = Boolean(err?.__CANCEL__)
        const lower = message.toLowerCase()
        // 忽略路由/请求被取消的错误
        if (
          lower.includes('err_aborted') ||
          lower.includes('aborted') ||
          lower.includes('abort') ||
          lower.includes('cancel') ||
          code === 'ERR_CANCELED' ||
          name === 'AbortError' ||
          name === 'CanceledError' ||
          isCanceled
        ) {
          return
        }
        // axios 错误：无响应对象通常为取消或网络中断，忽略；仅对有响应码的请求报错
        if (axios.isAxiosError(err)) {
          const status = err.response?.status
          if (!status) return
        }
        setError('加载笔记失败，请重试')
        console.error('Failed to load notes:', err)
      } finally {
        setLoading(false)
      }
    }
    loadNotes()
    return () => {
      controller.abort()
    }
  }, [searchParams])

  const handleDelete = async (id: string) => {
    try {
      await deleteNote(id)
      setNotes(notes.filter(note => note.id !== id))
    } catch (err) {
      setError('删除失败，请重试')
      console.error('Failed to delete note:', err)
    } finally {
      setPendingDeleteId(null)
    }
  }

  const resolveTagId = (tag: string | { id?: string; _id?: string }) =>
    typeof tag === 'string' ? tag : extractId(tag)

  const resolveTagLabel = (tag: string | { name?: string; id?: string; _id?: string }) => {
    if (typeof tag === 'string') {
      return tagMap[tag] || tag
    }
    const id = extractId(tag)
    if (id && tagMap[id]) {
      return tagMap[id]
    }
    return tag.name || ''
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-900">我的笔记</h1>
          <Link href="/dashboard/notes/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              新建笔记
            </Button>
          </Link>
        </div>
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {error && notes.length === 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => {
              setError('')
              router.refresh()
            }}
            className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
          >
            重试
          </button>
        </div>
      )}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1
            className="text-4xl font-bold"
            style={{
              background: 'linear-gradient(to right, #111827, #2563eb, #111827)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            我的笔记
          </h1>
          <p className="text-gray-600 mt-2">管理和组织您的所有笔记</p>
        </div>
        <Link
          href="/dashboard/notes/new"
          className="relative inline-flex"
          style={{ borderRadius: '20px' }}
        >
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '20px',
              background: 'linear-gradient(120deg, rgba(59,130,246,0.65), rgba(147,51,234,0.55))',
              filter: isCreateHovered ? 'blur(18px)' : 'blur(26px)',
              opacity: isCreateHovered ? 0.85 : 0.5,
              transition: 'all 0.3s ease',
              pointerEvents: 'none',
            }}
          />
          <Button
            aria-label="新建笔记"
            className="relative flex items-center gap-3 font-semibold tracking-wide text-white"
            style={{
              background: 'linear-gradient(120deg, #5eead4, #2563eb 45%, #7c3aed)',
              borderRadius: '18px',
              padding: '0 32px',
              height: '52px',
              letterSpacing: '0.5px',
              boxShadow: isCreateHovered
                ? '0 30px 45px -25px rgba(37, 99, 235, 0.9)'
                : '0 20px 40px -28px rgba(37, 99, 235, 0.75)',
            }}
            onMouseEnter={() => setIsCreateHovered(true)}
            onMouseLeave={() => setIsCreateHovered(false)}
          >
            <span
              aria-hidden
              style={{
                position: 'absolute',
                width: '160%',
                height: '160%',
                background: 'radial-gradient(circle at 15% 15%, rgba(255,255,255,0.65), transparent 55%)',
                transform: isCreateHovered ? 'translateX(18%)' : 'translateX(-15%)',
                opacity: 0.9,
                transition: 'transform 0.45s ease',
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />
            <span
              className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full"
              style={{
                backgroundColor: 'rgba(255,255,255,0.18)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)',
                backdropFilter: 'blur(6px)',
              }}
            >
              <Plus className="h-5 w-5 text-white" />
            </span>
            <span className="relative z-10 text-base">新建笔记</span>
            <span
              className="relative z-10 hidden sm:inline-flex text-[11px] uppercase tracking-[0.35em]"
              style={{
                padding: '4px 10px',
                borderRadius: '999px',
                border: '1px solid rgba(255,255,255,0.35)',
                backgroundColor: 'rgba(255,255,255,0.15)',
              }}
            >
              快速创建
            </span>
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <SearchFilterBar />

          {error && notes.length === 0 && (
            <div className="p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          {notes.length === 0 ? (
            <Card
              className="border-2 border-dashed"
              style={{
                background: 'linear-gradient(to bottom right, #f9fafb, #ffffff)',
                borderColor: '#d1d5db',
                borderRadius: '16px',
              }}
            >
              <CardContent className="text-center py-16">
                <div
                  className="inline-flex p-4 mb-6"
                  style={{
                    borderRadius: '50%',
                    backgroundColor: '#f3f4f6',
                  }}
                >
                  <FileText className="h-12 w-12 text-gray-400" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3">
                  没有找到笔记
                </h3>
                <p className="text-gray-600 mb-6 text-lg">
                  尝试调整筛选条件或创建新笔记
                </p>
                <Link href="/dashboard/notes/new">
                  <Button>
                    <Plus className="mr-2 h-5 w-5" />
                    创建第一篇笔记
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {notes.map((note) => {
                const categoryLabel = getCategoryLabel(note, categoryMap)
                return (
                  <Card
                    key={note.id}
                    className="card-hover relative overflow-hidden group border-none"
                    style={{
                      borderRadius: '22px',
                      background: 'linear-gradient(145deg, rgba(248,250,252,0.95), rgba(226,232,240,0.9))',
                      boxShadow: '0 25px 50px -30px rgba(15,23,42,0.6)',
                      border: '1px solid rgba(148,163,184,0.2)',
                      transition: 'all 0.3s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = '0 35px 70px -35px rgba(37,99,235,0.6)'
                      e.currentTarget.style.transform = 'translateY(-4px)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 25px 50px -30px rgba(15,23,42,0.6)'
                      e.currentTarget.style.transform = 'none'
                    }}
                  >
                    <div
                      aria-hidden
                      className="absolute inset-x-10 top-0 h-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{
                        background: 'linear-gradient(90deg, rgba(59,130,246,0.6), rgba(147,51,234,0.6))',
                        filter: 'blur(1px)',
                      }}
                    />
                    <CardHeader
                      className="relative pb-4 border-b border-gray-100"
                      style={{
                        borderColor: 'rgba(226,232,240,0.7)',
                      }}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <CardTitle
                          className="text-xl font-bold line-clamp-2 flex-1 group-hover:text-primary-600 transition-colors duration-200"
                          style={{ color: '#0f172a' }}
                        >
                          <Link
                            href={`/dashboard/notes/${note.id}`}
                            className="hover:text-primary-600 transition-colors"
                          >
                            {note.title || '无标题'}
                          </Link>
                        </CardTitle>
                        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                          <Link
                            href={`/dashboard/notes/${note.id}/edit`}
                            className="p-2 text-gray-400 hover:text-primary-600 rounded-lg transition-all duration-200"
                            style={{ backgroundColor: 'rgba(226,232,240,0.6)' }}
                            title="编辑"
                          >
                            <Edit className="h-4 w-4" />
                          </Link>
                          <button
                            onClick={() => setPendingDeleteId(note.id)}
                            className="p-2 text-gray-400 hover:text-red-600 rounded-lg transition-all duration-200"
                            style={{ backgroundColor: 'rgba(248,250,252,0.9)' }}
                            title="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4" style={{ position: 'relative' }}>
                      <div className="text-xs text-gray-500 mb-4 font-medium flex items-center gap-2">
                        <span
                          className="inline-flex h-2 w-2 rounded-full"
                          style={{ backgroundColor: '#34d399', boxShadow: '0 0 0 4px rgba(52,211,153,0.15)' }}
                        />
                        更新时间: {formatDate(note.updatedAt)}
                        {note.status === 'draft' && (
                          <span className="ml-auto text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">草稿</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600 line-clamp-3 mb-4 leading-relaxed">
                        {truncateText(note.content.replace(/[#*`_~>\[\]()]/g, ''), 150)}
                      </div>
                      {note.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {note.tags.map((tag) => {
                            const label = resolveTagLabel(tag)
                            const key = resolveTagId(tag) || label
                            if (!label) return null
                            return (
                              <span
                                key={key}
                                className="px-3 py-1.5 text-xs font-medium rounded-full shadow-sm"
                                style={{
                                  background: 'rgba(59,130,246,0.12)',
                                  color: '#1d4ed8',
                                  border: '1px solid rgba(59,130,246,0.2)',
                                }}
                              >
                                {label}
                              </span>
                            )
                          })}
                        </div>
                      )}
                      <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <span className="inline-flex h-2 w-2 rounded-full bg-blue-400/60" />
                          分类：{categoryLabel}
                        </span>
                        <span>标签 {note.tags.length}</span>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <SmartRecommendations context={{
            keyword: searchParams.get('keyword') || undefined,
            categoryId: searchParams.get('categoryId') || undefined,
            categoryIds: searchParams.getAll('categoryIds').length > 0 ? searchParams.getAll('categoryIds') : undefined,
            categoriesMode: (searchParams.get('categoriesMode') as 'any' | 'all') || undefined,
            tagIds: searchParams.getAll('tagIds').length > 0 ? searchParams.getAll('tagIds') : undefined,
            tagsMode: (searchParams.get('tagsMode') as 'any' | 'all') || undefined,
            startDate: searchParams.get('startDate') || undefined,
            endDate: searchParams.get('endDate') || undefined,
            status: (searchParams.get('status') as 'published' | 'draft') || undefined,
          }} />
        </div>
      </div>
      {pendingDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-[92%] max-w-md p-5">
            <h3 className="text-lg font-semibold mb-2">确认删除</h3>
            <p className="text-sm text-gray-600 mb-5">确定要删除这条笔记吗？此操作无法撤销。</p>
            <div className="flex justify-end gap-3">
              <button
                className="px-4 py-2 rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
                onClick={() => setPendingDeleteId(null)}
              >
                取消
              </button>
              <button
                className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
                onClick={() => handleDelete(pendingDeleteId)}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
