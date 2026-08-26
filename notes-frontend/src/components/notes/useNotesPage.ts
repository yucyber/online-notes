'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import axios from 'axios'
import { toast } from 'react-hot-toast'
import type { Note, NoteFilterParams } from '@/types'
import {
  clearNotesCache,
  createNote,
  deleteNote,
  fetchCategories,
  fetchNoteById,
  fetchNotes,
  fetchTags,
} from '@/lib/api'
import { extractId, parseNotesPagination } from './notes-page-utils'
import { buildNotesQueryParams } from './useNotesQuery'
import { removeNoteById, toggleIdInSet } from './useNotesBulkActions'
import { buildNotesCacheKey } from '@/lib/api/notes'

export function useNotesPage() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const selectionKnowledgeBaseId = searchParams.get('select') === 'knowledge-base'
    ? searchParams.get('knowledgeBaseId') || ''
    : ''
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fallbackMsg, setFallbackMsg] = useState('')
  const [isCreateHovered, setIsCreateHovered] = useState(false)
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({})
  const [tagMap, setTagMap] = useState<Record<string, string>>({})
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const initialPagination = parseNotesPagination(searchParams)
  const [page, setPage] = useState(initialPagination.page)
  const [size, setSize] = useState(initialPagination.size)
  const [total, setTotal] = useState(0)
  // 保存最新 total 供加载 effect 派发事件时读取，避免把 total 加入 deps 触发重复请求
  const totalRef = useRef(total)
  totalRef.current = total
  const [isSelectionMode, setIsSelectionMode] = useState(() => Boolean(selectionKnowledgeBaseId))
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [showSummaryDialog, setShowSummaryDialog] = useState(false)
  const [summaryResult, setSummaryResult] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(false)

  useEffect(() => {
    const next = parseNotesPagination(searchParams)
    setPage((current) => current === next.page ? current : next.page)
    setSize((current) => current === next.size ? current : next.size)
  }, [searchParams])

  useEffect(() => {
    // 每次筛选条件变化产生新的 AbortController；前一次未完成的请求被取消，防止慢响应覆盖最新结果。
    const controller = new AbortController()
    let aborted = false
    controller.signal.addEventListener('abort', () => {
      aborted = true
    })

    const loadNotesFast = async () => {
      try {
        setLoading(true)
        try {
          performance.mark('ConsoleListLoad:start')
        } catch {}

        const sp = searchParams
        const isNlq = sp.get('nlq') === '1'
        const params: NoteFilterParams = buildNotesQueryParams(sp)

        if (isNlq && (params.keyword || '')) {
          const mode = (sp.get('mode') as 'keyword' | 'vector' | 'hybrid') || 'hybrid'
          const nlqResp = await (await import('@/lib/api')).semanticSearchCached(params.keyword!, {
            mode,
            page,
            limit: size,
            categoryId: params.categoryId,
            tagIds: params.tagIds,
          })
          const items = nlqResp.data || []
          const mapped = items.map((it: any) => ({
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
          const sid = (() => {
            try {
              return sessionStorage.getItem('lastSearchId') || undefined
            } catch {
              return undefined
            }
          })()
          const nextQuery = sp.toString()
          document.dispatchEvent(
            new CustomEvent('search:result', {
              detail: {
                searchId: sid,
                ok: true,
                count: Number(totalRef.current || 0),
                duration,
                query: nextQuery,
                time: new Date().toISOString(),
              },
            }),
          )
          document.dispatchEvent(
            new CustomEvent('rum', {
              detail: {
                type: 'ui:search_results',
                name: 'SearchResults',
                value: duration,
                meta: { searchId: sid, count: Number(totalRef.current || 0) },
              },
            }),
          )
        } catch {}

        fetchCategories(controller.signal)
          .then((categoriesData) => {
            const mappedCategories = (categoriesData || []).reduce<Record<string, string>>((acc, category) => {
              const categoryId = extractId(category)
              if (categoryId) acc[categoryId] = category.name
              return acc
            }, {})
            setCategoryMap(mappedCategories)
          })
          .catch(() => void 0)

        fetchTags(controller.signal)
          .then((tagsData) => {
            const mappedTags = (tagsData || []).reduce<Record<string, string>>((acc, tag) => {
              const tagId = extractId(tag)
              if (tagId) acc[tagId] = tag.name
              return acc
            }, {})
            setTagMap(mappedTags)
          })
          .catch(() => void 0)
      } catch (err: any) {
        if (aborted || controller.signal.aborted) return

        const message = String(err?.message || '')
        const code = String(err?.code || '')
        const name = String(err?.name || '')
        const isCanceled = Boolean(err?.__CANCEL__)
        const lower = message.toLowerCase()

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

        if (axios.isAxiosError(err)) {
          const status = err.response?.status
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
          const sid = (() => {
            try {
              return sessionStorage.getItem('lastSearchId') || undefined
            } catch {
              return undefined
            }
          })()
          const nextQuery = searchParams.toString()
          document.dispatchEvent(
            new CustomEvent('search:result', {
              detail: {
                searchId: sid,
                ok: false,
                error: String(err?.message || 'error'),
                duration,
                query: nextQuery,
                time: new Date().toISOString(),
              },
            }),
          )
          document.dispatchEvent(
            new CustomEvent('rum', {
              detail: {
                type: 'ui:search_results',
                name: 'SearchResultsError',
                value: duration,
                meta: { searchId: sid },
              },
            }),
          )
        } catch {}
      }
    }

    void loadNotesFast()
    return () => controller.abort()
  }, [page, size, searchParams, pathname])

  useEffect(() => {
    let last = 0
    const tryRefresh = (reason: string) => {
      const now = Date.now()
      if (now - last < 15_000) return
      last = now
      try {
        document.dispatchEvent(
          new CustomEvent('rum', {
            detail: { type: 'ui:auto_refresh', name: 'AutoRefresh', value: 1, meta: { reason } },
          }),
        )
      } catch {}
      router.refresh()
    }

    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') tryRefresh('visibility')
    }
    const onFocus = () => tryRefresh('focus')
    const onOnline = () => tryRefresh('online')
    const onRevalidated = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail || {}
        const currentKey = buildNotesCacheKey({
          ...buildNotesQueryParams(searchParams),
          page,
          size,
        })
        if (detail.key === currentKey && detail.payload) {
          const items = Array.isArray(detail.payload.items) ? detail.payload.items : []
          setNotes(items)
          setTotal(Number(detail.payload.total || items.length || 0))
        }
      } catch {}
    }
    const onFallback = () => {
      try {
        setFallbackMsg('语义检索接口不可用，已回退关键词模式')
      } catch {}
    }

    document.addEventListener('visibilitychange', onVisibility)
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus)
      window.addEventListener('online', onOnline)
    }
    document.addEventListener('search:revalidated', onRevalidated)
    document.addEventListener('search:fallback', onFallback)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('online', onOnline)
      }
      document.removeEventListener('search:revalidated', onRevalidated)
      document.removeEventListener('search:fallback', onFallback)
    }
  }, [page, router, searchParams, size])

  const toggleSelectionMode = () => {
    setIsSelectionMode((prev) => !prev)
    setSelectedNoteIds(new Set())
  }

  const toggleNoteSelection = (id: string) => {
    setSelectedNoteIds((prev) => toggleIdInSet(prev, id))
  }

  const handleGenerateSummary = async () => {
    if (selectedNoteIds.size < 1) {
      toast.error('请至少选择 1 篇笔记')
      return
    }

    setShowSummaryDialog(true)
    setSummaryLoading(true)
    setSummaryResult('')

    try {
      const selectedNotes = await Promise.all(Array.from(selectedNoteIds).map((id) => fetchNoteById(id)))
      const response = await axios.post('/api/ai/summary', { notes: selectedNotes })
      setSummaryResult(response.data.summary)
    } catch (err: any) {
      console.error(err)
      toast.error(err.response?.data?.error || '生成摘要失败')
      setSummaryResult('生成失败，请重试。')
    } finally {
      setSummaryLoading(false)
    }
  }

  const handleSaveSummary = async () => {
    if (!summaryResult) return

    try {
      navigator.clipboard.writeText(summaryResult)
      const newNote = await createNote({
        title: `聚合摘要 - ${new Date().toLocaleString()}`,
        content: summaryResult,
        status: 'draft',
        tags: [],
      })

      toast.success('摘要已保存为新笔记')
      setShowSummaryDialog(false)
      clearNotesCache()
      setNotes((prev) => [newNote, ...prev])
      setTotal((prev) => prev + 1)
      router.refresh()
      document.dispatchEvent(
        new CustomEvent('search:revalidated', {
          detail: { key: `notes:${searchParams.toString()}`, payload: null },
        }),
      )
    } catch (saveError) {
      console.error('保存笔记失败:', saveError)
      toast.error('保存失败，内容已复制到剪贴板')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteNote(id)
      setNotes((prev) => removeNoteById(prev, id))
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
    if (typeof tag === 'string') return tagMap[tag] || ''
    const id = extractId(tag)
    if (id && tagMap[id]) return tagMap[id]
    return tag.name || ''
  }

  const handlePageSizeChange = (next: number) => {
    const nextSize = Math.max(1, next)
    setSize(nextSize)
    setPage(1)
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('size', String(nextSize))
    sp.set('page', '1')
    router.replace(`${pathname}?${sp.toString()}`)
  }

  const handlePageChange = (next: number) => {
    const nextPage = Math.max(1, next)
    setPage(nextPage)
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('page', String(nextPage))
    sp.set('size', String(size))
    router.push(`${pathname}?${sp.toString()}`)
  }

  const clearError = () => {
    setError('')
    router.refresh()
  }

  return {
    searchParams,
    notes,
    loading,
    error,
    fallbackMsg,
    isCreateHovered,
    setIsCreateHovered,
    categoryMap,
    tagMap,
    pendingDeleteId,
    setPendingDeleteId,
    page,
    size,
    total,
    selectionKnowledgeBaseId,
    isSelectionMode,
    selectedNoteIds,
    setSelectedNoteIds,
    showSummaryDialog,
    setShowSummaryDialog,
    summaryResult,
    summaryLoading,
    toggleSelectionMode,
    toggleNoteSelection,
    handleGenerateSummary,
    handleSaveSummary,
    handleDelete,
    resolveTagId,
    resolveTagLabel,
    handlePageSizeChange,
    handlePageChange,
    clearError,
  }
}
