'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import Link from 'next/link'
// 移除 useSearchParams，避免 Hook 上下文错误，改为从 window.location 解析
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Note, Category, Tag, NoteFilterParams } from '@/types'
import { fetchNotes, deleteNote, fetchCategories, fetchTags } from '@/lib/api'
import { Pagination, PageSizeSelect } from '@/components/ui/pagination'
import { formatDate, truncateText } from '@/utils'
import { Trash2, Plus, Edit, FileText } from 'lucide-react'
import dynamic from 'next/dynamic'
// 延迟加载重组件，减少初始 JS 体积与阻塞，提升 FCP/LCP
const SearchFilterBar = dynamic(() => import('@/components/SearchFilterBar'), { ssr: false })
const SmartRecommendations = dynamic(() => import('@/components/SmartRecommendations'), { ssr: false })

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
  const getSearchParams = () => {
    try { return new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '') } catch { return new URLSearchParams() }
  }
  const router = useRouter()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fallbackMsg, setFallbackMsg] = useState('')
  const [isCreateHovered, setIsCreateHovered] = useState(false)
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({})
  const [tagMap, setTagMap] = useState<Record<string, string>>({})
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [queryKey, setQueryKey] = useState<string>(() => {
    try { return new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').toString() } catch { return '' }
  })

  useEffect(() => {
    const controller = new AbortController()
    let aborted = false
    controller.signal.addEventListener('abort', () => { aborted = true })
    const loadNotesFast = async () => {
      try {
        setLoading(true)
        try { performance.mark('ConsoleListLoad:start') } catch { }
        const sp = (() => { try { return new URLSearchParams(queryKey || getSearchParams().toString()) } catch { return getSearchParams() } })()
        const isNlq = sp.get('nlq') === '1'
        const params: NoteFilterParams = {
          keyword: sp.get('keyword') || undefined,
          categoryId: sp.get('categoryId') || undefined,
          categoryIds: sp.getAll('categoryIds').length > 0 ? sp.getAll('categoryIds') : undefined,
          categoriesMode: (sp.get('categoriesMode') as 'any' | 'all') || undefined,
          tagIds: sp.getAll('tagIds').length > 0 ? sp.getAll('tagIds') : undefined,
          tagsMode: (sp.get('tagsMode') as 'any' | 'all') || undefined,
          startDate: sp.get('startDate') || undefined,
          endDate: sp.get('endDate') || undefined,
          status: (sp.get('status') as 'published' | 'draft') || undefined,
        }
        if (isNlq && (params.keyword || '')) {
          const mode = (sp.get('mode') as 'keyword' | 'vector' | 'hybrid') || 'hybrid'
          const nlqResp = await (await import('@/lib/api')).semanticSearch(params.keyword!, { mode, page, limit: size, categoryId: params.categoryId, tagIds: params.tagIds })
          const items = nlqResp.data || []
          const mapped = items.map((it: any, i: number) => ({
            id: it.id || it._id || `nlq-${String(it.title || '')}-${String(it.updatedAt || '')}`,
            title: it.title,
            content: it.preview,
            updatedAt: it.updatedAt,
            tags: [],
            status: 'published',
          })) as any
          const seen = new Set<string>()
          const unique = mapped.filter((n: any) => {
            const k = String(n.id || `nlq-${String(n.title || '')}-${String(n.updatedAt || '')}`)
            if (seen.has(k)) return false
            seen.add(k)
            return true
          })
          setNotes(unique)
          setTotal(Number(nlqResp.total || 0))
        } else {
          // 从后端获取分页后的数据（不在前端二次切片）
          const notesResp = await fetchNotes({ ...params, page, size }, controller.signal)
          const items = Array.isArray(notesResp.items) ? notesResp.items : []
          setNotes(items)
          setTotal(Number(notesResp.total || items.length || 0))
        }
        setError('')
        setFallbackMsg('')
        setLoading(false)
        try {
          performance.mark('ConsoleListLoad:end')
          performance.measure('ConsoleListLoad', 'ConsoleListLoad:start', 'ConsoleListLoad:end')
          const entry = performance.getEntriesByName('ConsoleListLoad').pop()
          const duration = entry?.duration
          const sid = (() => { try { return sessionStorage.getItem('lastSearchId') || undefined } catch { return undefined } })()
          const nextQuery = sp.toString()
          document.dispatchEvent(new CustomEvent('search:result', {
            detail: {
              searchId: sid,
              ok: true,
              count: (isNlq ? Number(total || 0) : Number(total || 0)),
              duration,
              query: nextQuery,
              time: new Date().toISOString(),
            }
          }))
          document.dispatchEvent(new CustomEvent('rum', {
            detail: { type: 'ui:search_results', name: 'SearchResults', value: duration, meta: { searchId: sid, count: Number(total || 0) } }
          }))
        } catch { }
        // 辅助数据异步加载，不影响首屏
        fetchCategories(controller.signal)
          .then((categoriesData) => {
            const mappedCategories = (categoriesData || []).reduce<Record<string, string>>((acc, category) => {
              const categoryId = extractId(category)
              if (categoryId) {
                acc[categoryId] = category.name
              }
              return acc
            }, {})
            setCategoryMap(mappedCategories)
          })
          .catch(() => void 0)
        fetchTags(controller.signal)
          .then((tagsData) => {
            const mappedTags = (tagsData || []).reduce<Record<string, string>>((acc, tag) => {
              const tagId = extractId(tag)
              if (tagId) {
                acc[tagId] = tag.name
              }
              return acc
            }, {})
            setTagMap(mappedTags)
          })
          .catch(() => void 0)
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
          // 如果是超时 (ECONNABORTED)，不应忽略，需提示用户
          if (!status && err.code !== 'ECONNABORTED') return
        }
        setError('加载笔记失败，请重试')
        console.error('Failed to load notes:', err)
        setLoading(false)
        try {
          performance.mark('ConsoleListLoad:end')
          performance.measure('ConsoleListLoad', 'ConsoleListLoad:start', 'ConsoleListLoad:end')
          const entry = performance.getEntriesByName('ConsoleListLoad').pop()
          const duration = entry?.duration
          const sid = (() => { try { return sessionStorage.getItem('lastSearchId') || undefined } catch { return undefined } })()
          const sp = getSearchParams()
          const nextQuery = sp.toString()
          document.dispatchEvent(new CustomEvent('search:result', {
            detail: {
              searchId: sid,
              ok: false,
              error: String(err?.message || 'error'),
              duration,
              query: nextQuery,
              time: new Date().toISOString(),
            }
          }))
          document.dispatchEvent(new CustomEvent('rum', {
            detail: { type: 'ui:search_results', name: 'SearchResultsError', value: duration, meta: { searchId: sid } }
          }))
        } catch { }
      }
    }
    loadNotesFast()
    return () => {
      controller.abort()
    }
  }, [page, size, queryKey])

  // 自动刷新与后台重验证联动：可见/聚焦/网络恢复触发；后台重验证事件直达更新
  useEffect(() => {
    let last = 0
    const tryRefresh = (reason: string) => {
      const now = Date.now()
      // 15s节流，避免频繁刷新
      if (now - last < 15_000) return
      last = now
      try {
        document.dispatchEvent(new CustomEvent('rum', { detail: { type: 'ui:auto_refresh', name: 'AutoRefresh', value: 1, meta: { reason } } }))
      } catch { }
      // 通过路由 refresh 触发数据重新加载
      router.refresh()
    }
    const onVisibility = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') tryRefresh('visibility') }
    const onFocus = () => tryRefresh('focus')
    const onOnline = () => tryRefresh('online')
    const onRevalidated = (e: any) => {
      try {
        const detail = e?.detail || {}
        const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
        const currentKey = `notes:${sp.toString()}`
        if (detail.key === currentKey && detail.payload) {
          const items = Array.isArray(detail.payload.items) ? detail.payload.items : []
          setNotes(items as any)
          setTotal(Number(detail.payload.total || items.length || 0))
        }
      } catch { }
    }
    const onFallback = (e: any) => {
      try {
        setFallbackMsg('语义检索接口不可用，已回退关键词模式')
      } catch { }
    }
    const onSearchTrigger = (e: any) => {
      try {
        const next = String(e?.detail?.nextQuery || '')
        setQueryKey(next)
      } catch { }
    }
    const onPopState = () => {
      try {
        const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
        setQueryKey(sp.toString())
      } catch { }
    }
    document.addEventListener('visibilitychange', onVisibility)
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus)
      window.addEventListener('online', onOnline)
      window.addEventListener('popstate', onPopState)
    }
    document.addEventListener('search:revalidated', onRevalidated as any)
    document.addEventListener('search:trigger', onSearchTrigger as any)
    document.addEventListener('search:fallback', onFallback as any)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('online', onOnline)
        window.removeEventListener('popstate', onPopState)
      }
      document.removeEventListener('search:revalidated', onRevalidated as any)
      document.removeEventListener('search:trigger', onSearchTrigger as any)
      document.removeEventListener('search:fallback', onFallback as any)
    }
  }, [router])

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
      {fallbackMsg && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          {fallbackMsg}
        </div>
      )}
      {error && notes.length === 0 && (
        <div className="rounded-md border p-3 text-sm flex items-center justify-between" style={{ color: 'var(--on-surface)', background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
          <span>{error}</span>
          <button
            onClick={() => {
              setError('')
              router.refresh()
            }}
            className="px-3 py-1 rounded"
            style={{ background: 'var(--primary-600)', color: '#fff' }}
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
          <p className="mt-2" style={{ color: 'var(--text-muted)' }}>管理和组织您的所有笔记</p>
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

          <div className="flex items-center justify-between mb-2">
            <PageSizeSelect size={size} onSizeChange={(next) => {
              const nextSize = Math.max(1, next)
              setSize(nextSize)
              setPage(1)
              try {
                const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
                sp.set('size', String(nextSize))
                sp.set('page', '1')
                if (typeof window !== 'undefined') {
                  window.history.replaceState(null, '', `${window.location.pathname}?${sp.toString()}`)
                }
                setQueryKey(sp.toString())
              } catch { }
            }} />
            <Pagination page={page} size={size} total={total} onPageChange={(next) => {
              const nextPage = Math.max(1, next)
              setPage(nextPage)
              try {
                const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
                sp.set('page', String(nextPage))
                sp.set('size', String(size))
                if (typeof window !== 'undefined') {
                  window.history.replaceState(null, '', `${window.location.pathname}?${sp.toString()}`)
                }
                setQueryKey(sp.toString())
              } catch { }
            }} />
          </div>
          {notes.length === 0 ? (
            <Card className="border-2 border-dashed" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', borderRadius: '16px' }}>
              <CardContent className="text-center py-16">
                <div
                  className="inline-flex p-4 mb-6"
                  style={{ borderRadius: '50%', backgroundColor: 'var(--surface-2)' }}
                >
                  <FileText className="h-12 w-12" style={{ color: 'var(--text-muted)' }} />
                </div>
                <h3 className="text-2xl font-bold mb-3" style={{ color: 'var(--on-surface)' }}>
                  没有找到笔记
                </h3>
                <p className="mb-2 text-lg" style={{ color: 'var(--text-muted)' }}>
                  尝试调整筛选条件或创建新笔记
                </p>
                {(() => {
                  const sp = getSearchParams()
                  const isNlq = sp.get('nlq') === '1'
                  if (isNlq) {
                    return <p className="mb-6" style={{ color: 'var(--text-muted)' }}>语义检索未命中（可能受阈值或过滤条件影响），可切换到“关键词”模式或降低阈值</p>
                  }
                  return null
                })()}
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
              {notes.map((note, i) => {
                const categoryLabel = getCategoryLabel(note, categoryMap)
                return (
                  <Card
                    key={note.id || `${String(note.title || 'note')}-${String(note.updatedAt || '')}-${i}`}
                    className="card-hover relative overflow-hidden group"
                    style={{ borderRadius: '22px', background: 'var(--surface-1)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border)', transition: 'all 0.3s ease' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = 'var(--shadow-lg)'
                      e.currentTarget.style.transform = 'translateY(-4px)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = 'var(--shadow-md)'
                      e.currentTarget.style.transform = 'none'
                    }}
                  >
                    <div
                      aria-hidden
                      className="absolute inset-x-10 top-0 h-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{ background: 'var(--primary-600)', filter: 'blur(1px)' }}
                    />
                    <CardHeader className="relative pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex justify-between items-start gap-2">
                        <CardTitle className="text-xl font-bold line-clamp-2 flex-1 group-hover:text-primary-600 transition-colors duration-200" style={{ color: 'var(--on-surface)' }}>
                          <Link href={`/dashboard/notes/${note.id}`} className="hover:text-primary-600 transition-colors">
                            {note.title || '无标题'}
                          </Link>
                        </CardTitle>
                        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                          <Link href={`/dashboard/notes/${note.id}/edit`} className="p-2 rounded-lg transition-all duration-200" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }} title="编辑">
                            <Edit className="h-4 w-4" />
                          </Link>
                          <button onClick={() => setPendingDeleteId(note.id)} className="p-2 rounded-lg transition-all duration-200" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }} title="删除">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4" style={{ position: 'relative' }}>
                      <div className="text-xs mb-4 font-medium flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                        <span
                          className="inline-flex h-2 w-2 rounded-full"
                          style={{ backgroundColor: '#34d399', boxShadow: '0 0 0 4px rgba(52,211,153,0.15)' }}
                        />
                        更新时间: {formatDate(note.updatedAt)}
                        {note.status === 'draft' && (
                          <span className="ml-auto text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--on-surface)', border: '1px solid var(--border)' }}>草稿</span>
                        )}
                      </div>
                      <div className="text-sm line-clamp-3 mb-4 leading-relaxed" style={{ color: 'var(--on-surface)' }}>
                        {truncateText(note.content.replace(/<[^>]+>/g, '').replace(/[#*`_~>\[\]()]/g, ''), 150)}
                      </div>
                      {note.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {note.tags.map((tag, idx) => {
                            const id = resolveTagId(tag)
                            const label = resolveTagLabel(tag)
                            if (!label) return null
                            const keySafe = id ? id : `${note.id}:${label}:${idx}`
                            return (
                              <span key={keySafe} className="px-3 py-1.5 text-xs font-medium rounded-full shadow-sm" style={{ background: 'var(--primary-50)', color: 'var(--primary-600)', border: '1px solid var(--primary-100)' }}>
                                {label}
                              </span>
                            )
                          })}
                        </div>
                      )}
                      <div className="mt-4 flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
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
            keyword: getSearchParams().get('keyword') || undefined,
            categoryId: getSearchParams().get('categoryId') || undefined,
            categoryIds: getSearchParams().getAll('categoryIds').length > 0 ? getSearchParams().getAll('categoryIds') : undefined,
            categoriesMode: (getSearchParams().get('categoriesMode') as 'any' | 'all') || undefined,
            tagIds: getSearchParams().getAll('tagIds').length > 0 ? getSearchParams().getAll('tagIds') : undefined,
            tagsMode: (getSearchParams().get('tagsMode') as 'any' | 'all') || undefined,
            startDate: getSearchParams().get('startDate') || undefined,
            endDate: getSearchParams().get('endDate') || undefined,
            status: (getSearchParams().get('status') as 'published' | 'draft') || undefined,
          }} />
        </div>
      </div>
      {pendingDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--overlay)' }}>
          <div className="rounded-xl shadow-xl w-[92%] max-w-md p-5 border" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', color: 'var(--on-surface)' }}>
            <h3 className="text-lg font-semibold mb-2">确认删除</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>确定要删除这条笔记吗？此操作无法撤销。</p>
            <div className="flex justify-end gap-3">
              <button
                className="px-4 py-2 rounded border"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
                onClick={() => setPendingDeleteId(null)}
              >
                取消
              </button>
              <button
                className="px-4 py-2 rounded"
                style={{ background: 'var(--primary-600)', color: '#fff' }}
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
