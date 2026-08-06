'use client'

import Link from 'next/link'
import { Check, Edit, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Note } from '@/types'
import { formatDate, truncateText } from '@/utils'
import { getCategoryLabel } from './notes-page-utils'
import { SummaryPreview } from './SummaryPreview'

type NotesListCardProps = {
  note: Note
  index: number
  categoryMap: Record<string, string>
  isSelectionMode: boolean
  selectedNoteIds: Set<string>
  onToggleSelection: (id: string) => void
  onRequestDelete: (id: string) => void
  resolveTagId: (tag: string | { id?: string; _id?: string }) => string
  resolveTagLabel: (tag: string | { name?: string; id?: string; _id?: string }) => string
}

export function NotesListCard({
  note,
  index,
  categoryMap,
  isSelectionMode,
  selectedNoteIds,
  onToggleSelection,
  onRequestDelete,
  resolveTagId,
  resolveTagLabel,
}: NotesListCardProps) {
  const categoryLabel = getCategoryLabel(note, categoryMap)

  return (
    <Card
      key={note.id || `${String(note.title || 'note')}-${String(note.updatedAt || '')}-${index}`}
      className={`card-hover relative group ${isSelectionMode && selectedNoteIds.has(note.id) ? 'ring-2 ring-blue-500' : ''}`}
      style={{
        borderRadius: '22px',
        background: 'var(--surface-1)',
        boxShadow: 'var(--shadow-md)',
        border: '1px solid var(--border)',
        transition: 'all 0.3s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-lg)'
        e.currentTarget.style.transform = 'translateY(-4px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-md)'
        e.currentTarget.style.transform = 'none'
      }}
    >
      <div className="absolute inset-0 rounded-[22px] overflow-hidden pointer-events-none">
        {isSelectionMode && (
          <>
            <div
              className="absolute inset-0 z-10 cursor-pointer pointer-events-auto"
              onClick={(e) => {
                e.stopPropagation()
                onToggleSelection(note.id)
              }}
            />
            <div className="absolute top-4 left-4 z-20 pointer-events-none">
              <div
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedNoteIds.has(note.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white/80'}`}
              >
                {selectedNoteIds.has(note.id) && <Check className="w-4 h-4 text-white" />}
              </div>
            </div>
          </>
        )}
        <div
          aria-hidden
          className="absolute inset-x-10 top-0 h-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ background: 'var(--primary-600)', filter: 'blur(1px)' }}
        />
      </div>
      <CardHeader className="relative pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex justify-between items-start gap-2">
          <CardTitle
            className="text-xl font-bold line-clamp-2 flex-1 group-hover:text-primary-600 transition-colors duration-200"
            style={{ color: 'var(--on-surface)' }}
          >
            <Link href={`/dashboard/notes/${note.id}`} className="hover:text-primary-600 transition-colors">
              {note.title || '无标题'}
            </Link>
          </CardTitle>
          <div className="flex items-center gap-1 ml-2 flex-shrink-0">
            <Link
              href={`/dashboard/notes/${note.id}`}
              className="p-2 rounded-lg transition-all duration-200"
              style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}
              title="编辑"
            >
              <Edit className="h-4 w-4" />
            </Link>
            <button
              onClick={() => onRequestDelete(note.id)}
              className="p-2 rounded-lg transition-all duration-200"
              style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}
              title="删除"
            >
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
            <span
              className="ml-auto text-xs px-1.5 py-0.5 rounded"
              style={{ background: 'var(--surface-2)', color: 'var(--on-surface)', border: '1px solid var(--border)' }}
            >
              草稿
            </span>
          )}
        </div>
        <SummaryPreview
          summary={note.summary}
          fallback={
            note.content
              ? truncateText(note.content.replace(/<[^>]+>/g, '').replace(/[#*`_~>\[\]()]/g, ''), 150)
              : '正在生成摘要...'
          }
        />
        {note.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {note.tags.map((tag, idx) => {
              const id = resolveTagId(tag)
              const label = resolveTagLabel(tag)
              if (!label) return null
              const keySafe = id ? id : `${note.id}:${label}:${idx}`
              return (
                <span
                  key={keySafe}
                  className="px-3 py-1.5 text-xs font-medium rounded-full shadow-sm"
                  style={{
                    background: 'var(--primary-50)',
                    color: 'var(--primary-600)',
                    border: '1px solid var(--primary-100)',
                  }}
                >
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
}
