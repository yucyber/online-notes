'use client'

import Link from 'next/link'
import { Check, Edit, Eye, Trash2 } from 'lucide-react'
import type { Note } from '@/types'
import { formatDate } from '@/utils'
import { getCategoryLabel } from './notes-page-utils'
import { canWriteNote } from '@/components/editor/note-permissions'
import { NoteHoverPreview } from './NoteHoverPreview'

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
  currentUserId: string
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
  currentUserId,
}: NotesListCardProps) {
  const categoryLabel = getCategoryLabel(note, categoryMap)
  const writable = canWriteNote(note, currentUserId)

  return (
    <div
      key={note.id || `${String(note.title || 'note')}-${String(note.updatedAt || '')}-${index}`}
      className={`notes-list-item relative group rounded-lg px-3 py-3.5 first:rounded-t-[var(--product-radius-md)] last:rounded-b-[var(--product-radius-md)] transition-colors duration-150 hover:bg-[var(--surface-2)] ${isSelectionMode && selectedNoteIds.has(note.id) ? 'ring-2 ring-blue-500' : ''}`}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {isSelectionMode && (
          <>
            <div
              role="button"
              tabIndex={0}
              className="absolute inset-0 z-10 cursor-pointer pointer-events-auto"
              onClick={(e) => {
                e.stopPropagation()
                onToggleSelection(note.id)
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleSelection(note.id) } }}
            />
            <div className="absolute top-3 left-3 z-20 pointer-events-none">
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${selectedNoteIds.has(note.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white/80'}`}
              >
                {selectedNoteIds.has(note.id) && <Check className="w-3.5 h-3.5 text-white" />}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3">
            <Link
              href={`/dashboard/notes/${note.id}`}
              className="text-[15px] font-semibold text-[var(--on-surface)] line-clamp-1 group-hover:text-[var(--primary-600)] transition-colors duration-200"
            >
              {note.title || '无标题'}
            </Link>
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] whitespace-nowrap flex-shrink-0">
              <span>更新于 {formatDate(note.updatedAt)}</span>
              <span className="text-[var(--border)]">·</span>
              <span className="truncate max-w-[8rem]">{categoryLabel}</span>
              {note.tags.length > 0 && (
                <>
                  <span className="text-[var(--border)]">·</span>
                  <span>标签 {note.tags.length}</span>
                </>
              )}
              {note.status === 'draft' && (
                <span
                  className="ml-1 px-1.5 py-0.5 rounded text-[11px]"
                  style={{ background: 'var(--surface-2)', color: 'var(--on-surface)', border: '1px solid var(--border)' }}
                >
                  草稿
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
          <Link
            href={`/dashboard/notes/${note.id}`}
            className="p-1.5 rounded-md transition-colors hover:bg-white"
            style={{ color: 'var(--text-muted)' }}
            title={writable ? '编辑' : '查看'}
          >
            {writable ? <Edit className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Link>
          {writable && (
            <button
              onClick={() => onRequestDelete(note.id)}
              className="p-1.5 rounded-md transition-colors hover:bg-white"
              style={{ color: 'var(--text-muted)' }}
              title="删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <NoteHoverPreview
        note={note}
        categoryLabel={categoryLabel}
        resolveTagId={resolveTagId}
        resolveTagLabel={resolveTagLabel}
      />
    </div>
  )
}
