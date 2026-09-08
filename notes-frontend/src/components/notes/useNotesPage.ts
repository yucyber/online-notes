'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import axios from 'axios'
import { toast } from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Note, NoteFilterParams } from '@/types'
import {
  createNote,
  deleteNote,
  fetchCategories,
  fetchNoteById,
  fetchTags,
  notesAPI,
  semanticAPI,
} from '@/lib/api'
import { extractId, parseNotesPagination } from './notes-page-utils'
import { buildNotesQueryParams } from './useNotesQuery'
import { removeNoteById, toggleIdInSet } from './useNotesBulkActions'
import type { SemanticChunkHit } from '@/lib/api/semantic'

export type NoteWithSearchEvidence = Note & {
  searchEvidence?: { bestChunk?: SemanticChunkHit; additionalChunkHits: number; additionalChunks: SemanticChunkHit[] }
}

type NotesPageData = { items: NoteWithSearchEvidence[]; total: number }

type NotesSearchParams = {
  get(name: string): string | null
  getAll(name: string): string[]
  toString(): string
}

const readSearchId = () => {
  try {
    return sessionStorage.getItem('lastSearchId') || undefined
  } catch {
    return undefined
  }
}

const isAbortError = (err: unknown, signal?: AbortSignal): boolean => {
  if (signal?.aborted) return true
  const e = err as { message?: string; code?: string; name?: string; __CANCEL__?: boolean }
  const message = String(e?.message || '').toLowerCase()
  const code = String(e?.code || '')
  const name = String(e?.name || '')
  return (
    message.includes('aborted') ||
    message.includes('abort') ||
    message.includes('cancel') ||
    code === 'ERR_CANCELED' ||
    name === 'AbortError' ||
    name === 'CanceledError' ||
    Boolean(e?.__CANCEL__)
  )
}

function dispatchLoadResult(input: { ok: boolean; query: string; total?: number; error?: string }) {
  try {
    performance.mark('ConsoleListLoad:end')
    performance.measure('ConsoleListLoad', 'ConsoleListLoad:start', 'ConsoleListLoad:end')
    const entry = performance.getEntriesByName('ConsoleListLoad').pop()
    const duration = entry?.duration
    const searchId = readSearchId()
    document.dispatchEvent(
      new CustomEvent('search:result', {
        detail: {
          searchId,
          ok: input.ok,
          count: input.ok ? Number(input.total || 0) : undefined,
          error: input.ok ? undefined : input.error,
          duration,
          query: input.query,
          time: new Date().toISOString(),
        },
      }),
    )
    document.dispatchEvent(
      new CustomEvent('rum', {
        detail: {
          type: 'ui:search_results',
          name: input.ok ? 'SearchResults' : 'SearchResultsError',
          value: duration,
          meta: input.ok ? { searchId, count: Number(input.total || 0) } : { searchId },
        },
      }),
    )
  } catch {}
}

async function loadNotesPageData(input: { sp: NotesSearchParams; page: number; size: number; signal?: AbortSignal }): Promise<NotesPageData> {
  const { sp, page, size, signal } = input
  const params: NoteFilterParams = buildNotesQueryParams(sp)
  const isNlq = sp.get('nlq') === '1'

  if (isNlq && (params.keyword || '')) {
    const mode = (sp.get('mode') as 'keyword' | 'vector' | 'hybrid') || 'hybrid'
    const nlqResp = await semanticAPI.search(params.keyword!, {
      mode,
      page,
      limit: size,
      categoryId: params.categoryId,
      tagIds: params.tagIds,
    })
    const mapped = (nlqResp.data || []).map((it: any) => ({
      id: String(it.id || it._id || `nlq-${String(it.title || '')}-${String(it.updatedAt || '')}`),
      title: String(it.title || ''),
      content: String(it.preview || ''),
      updatedAt: String(it.updatedAt || ''),
      tags: [],
      status: 'published' as const,
      searchEvidence: {
        bestChunk: it.bestChunk,
        additionalChunkHits: Number(it.additionalChunkHits || 0),
        additionalChunks: Array.isArray(it.additionalChunks) ? it.additionalChunks : [],
      },
    })) as unknown as NoteWithSearchEvidence[]
    const seen = new Set<string>()
    const unique = mapped.filter((note) => {
      const key = String(note.id || `nlq-${String(note.title || '')}-${String(note.updatedAt || '')}`)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return { items: unique, total: Number(nlqResp.total || 0) }
  }

  const notesResp = await notesAPI.getAll({ ...params, page, size }, signal)
  const items = Array.isArray(notesResp.items) ? notesResp.items as NoteWithSearchEvidence[] : []
  return { items, total: Number(notesResp.total || items.length || 0) }
}

export function useNotesPage() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const selectionKnowledgeBaseId = searchParams.get('select') === 'knowledge-base'
    ? searchParams.get('knowledgeBaseId') || ''
    : ''
  const [fallbackMsg, setFallbackMsg] = useState('')
  const [actionError, setActionError] = useState('')
  const [isCreateHovered, setIsCreateHovered] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const initialPagination = parseNotesPagination(searchParams)
  const [page, setPage] = useState(initialPagination.page)
  const [size, setSize] = useState(initialPagination.size)
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

  const isNlq = searchParams.get('nlq') === '1'
  const notesQueryKey = ['notes', isNlq ? 'semantic' : 'list', { query: searchParams.toString(), page, size }] as const

  const notesQuery = useQuery({
    queryKey: notesQueryKey,
    queryFn: async ({ signal }) => {
      try {
        performance.mark('ConsoleListLoad:start')
      } catch {}
      try {
        const data = await loadNotesPageData({ sp: searchParams, page, size, signal })
        setFallbackMsg('')
        dispatchLoadResult({ ok: true, total: data.total, query: searchParams.toString() })
        return data
      } catch (err) {
        if (!isAbortError(err, signal)) {
          dispatchLoadResult({ ok: false, query: searchParams.toString(), error: String((err as any)?.message || 'error') })
        }
        throw err
      }
    },
    staleTime: 10_000,
    retry: false,
  })

  const categoriesQuery = useQuery({
    queryKey: ['taxonomy', 'categories'],
    queryFn: () => fetchCategories(),
    staleTime: 30_000,
    retry: false,
  })
  const tagsQuery = useQuery({
    queryKey: ['taxonomy', 'tags'],
    queryFn: () => fetchTags(),
    staleTime: 30_000,
    retry: false,
  })

  const categoryMap = useMemo(() => {
    return (categoriesQuery.data || []).reduce<Record<string, string>>((acc, category) => {
      const categoryId = extractId(category)
      if (categoryId) acc[categoryId] = category.name
      return acc
    }, {})
  }, [categoriesQuery.data])

  const tagMap = useMemo(() => {
    return (tagsQuery.data || []).reduce<Record<string, string>>((acc, tag) => {
      const tagId = extractId(tag)
      if (tagId) acc[tagId] = tag.name
      return acc
    }, {})
  }, [tagsQuery.data])

  const notes = notesQuery.data?.items ?? []
  const total = notesQuery.data?.total ?? 0
  const loading = notesQuery.isPending
  const error = actionError || (notesQuery.isError ? '加载笔记失败，请重试' : '')

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
    document.addEventListener('search:fallback', onFallback)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('online', onOnline)
      }
      document.removeEventListener('search:fallback', onFallback)
    }
  }, [router])

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
      queryClient.setQueryData<NotesPageData>(notesQueryKey, (old) => old
        ? { items: [newNote as NoteWithSearchEvidence, ...old.items], total: old.total + 1 }
        : old)
      void queryClient.invalidateQueries({ queryKey: ['notes'] })
      router.refresh()
    } catch (saveError) {
      console.error('保存笔记失败:', saveError)
      toast.error('保存失败，内容已复制到剪贴板')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteNote(id)
      queryClient.setQueryData<NotesPageData>(notesQueryKey, (old) => old
        ? { ...old, items: removeNoteById(old.items, id), total: Math.max(0, old.total - 1) }
        : old)
      void queryClient.invalidateQueries({ queryKey: ['notes'] })
    } catch (err) {
      setActionError('删除失败，请重试')
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
    setActionError('')
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
