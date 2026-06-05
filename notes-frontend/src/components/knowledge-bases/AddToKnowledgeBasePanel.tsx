'use client'

import { useEffect, useMemo, useState } from 'react'
import { BookMarked, Loader2, PlusCircle } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { knowledgeBasesAPI } from '@/lib/api'
import type { KnowledgeBase } from '@/types'

type AddToKnowledgeBasePanelProps = {
  noteIds: string[]
  onAdded?: () => void
}

export function AddToKnowledgeBasePanel({ noteIds, onAdded }: AddToKnowledgeBasePanelProps) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const uniqueNoteIds = useMemo(() => Array.from(new Set(noteIds.filter(Boolean))), [noteIds])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        setLoading(true)
        setError('')
        const data = await knowledgeBasesAPI.getAll()
        if (!mounted) return
        setKnowledgeBases(data)
        setSelectedKnowledgeBaseId((current) => current || data[0]?.id || '')
      } catch (err) {
        console.error('Failed to load knowledge bases', err)
        if (mounted) setError('知识库加载失败')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const handleAdd = async () => {
    if (!selectedKnowledgeBaseId || uniqueNoteIds.length === 0) return

    try {
      setAdding(true)
      setError('')
      await Promise.all(uniqueNoteIds.map((noteId) => knowledgeBasesAPI.addNote(selectedKnowledgeBaseId, noteId)))
      toast.success('已加入知识库，重复笔记会自动保持一份')
      onAdded?.()
    } catch (err) {
      console.error('Failed to add notes to knowledge base', err)
      setError('加入知识库失败，请稍后重试')
      toast.error('加入知识库失败')
    } finally {
      setAdding(false)
    }
  }

  const disabled = loading || adding || uniqueNoteIds.length === 0 || knowledgeBases.length === 0

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border px-3 py-2 sm:flex-row sm:items-center"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
    >
      <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--on-surface)' }}>
        <BookMarked className="h-4 w-4" />
        <span>加入知识库</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {uniqueNoteIds.length} 篇
        </span>
      </div>

      <label className="sr-only" htmlFor="knowledge-base-target">
        目标知识库
      </label>
      <select
        id="knowledge-base-target"
        aria-label="目标知识库"
        value={selectedKnowledgeBaseId}
        onChange={(event) => setSelectedKnowledgeBaseId(event.target.value)}
        disabled={loading || adding || knowledgeBases.length === 0}
        className="h-10 min-w-[180px] rounded-lg border px-3 text-sm"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
      >
        {knowledgeBases.length === 0 ? (
          <option value="">{loading ? '加载中...' : '暂无知识库'}</option>
        ) : (
          knowledgeBases.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))
        )}
      </select>

      <Button type="button" size="sm" disabled={disabled} onClick={handleAdd} className="whitespace-nowrap">
        {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
        加入知识库
      </Button>

      {error && (
        <span className="text-xs text-red-600" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
