'use client'

import Link from 'next/link'
import { PrototypeGlyph } from '@/components/ui/prototype-glyph'
import { formatDate } from '@/utils'
import { getCategoryLabel } from './notes-page-utils'
import { canWriteNote } from '@/components/editor/note-permissions'
import { NoteHoverPreview } from './NoteHoverPreview'
import { SearchHitEvidence } from './SearchHitEvidence'
import type { NoteWithSearchEvidence } from './useNotesPage'

type NotesListCardProps = {
  note: NoteWithSearchEvidence
  index: number
  categoryMap: Record<string, string>
  isSelectionMode: boolean
  selectedNoteIds: Set<string>
  onToggleSelection: (id: string) => void
  onRequestDelete: (id: string) => void
  resolveTagId: (tag: string | { id?: string; _id?: string }) => string
  resolveTagLabel: (tag: string | { name?: string; id?: string; _id?: string }) => string
  currentUserId: string
  searchQuery?: string
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
  searchQuery,
}: NotesListCardProps) {
  const categoryLabel = getCategoryLabel(note, categoryMap)
  const writable = canWriteNote(note, currentUserId)

  return (
    <div
      key={note.id || `${String(note.title || 'note')}-${String(note.updatedAt || '')}-${index}`}
      className={`prototype-note-row notes-list-item group ${isSelectionMode ? 'is-selection-mode grid-cols-[32px_minmax(0,1fr)] gap-1' : ''} ${isSelectionMode && selectedNoteIds.has(note.id) ? 'is-selected' : ''}`}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {isSelectionMode && (
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
        )}
      </div>

      {isSelectionMode && (
        <button
          type="button"
          aria-label={`${selectedNoteIds.has(note.id) ? '取消选择' : '选择'} ${note.title || '无标题'}`}
          aria-pressed={selectedNoteIds.has(note.id)}
          className="relative z-20 grid h-8 w-8 place-items-center self-center rounded-full"
          onClick={() => onToggleSelection(note.id)}
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${selectedNoteIds.has(note.id) ? 'border-blue-500 bg-blue-500' : 'border-gray-300 bg-white/80'}`}
          >
            {selectedNoteIds.has(note.id) && <PrototypeGlyph name="tasks" className="h-3.5 w-3.5 text-white" />}
          </span>
        </button>
      )}

      <div className="prototype-note-main">
        <div className="flex-1 min-w-0 overflow-hidden">
          <Link
            href={`/dashboard/notes/${note.id}`}
            className="prototype-note-title"
          >
            {note.title || '无标题'}
          </Link>
        </div>

        <div className="prototype-note-meta">
          <span>更新于 {formatDate(note.updatedAt)}</span>
          <span className="text-[var(--border)]">·</span>
          <span className="truncate max-w-[8rem]">{categoryLabel}</span>
          {note.tags.length > 0 && (
            <>
              <span className="text-[var(--border)]">·</span>
              <span className="truncate max-w-[8rem]">
                {note.tags.map((tag) => resolveTagLabel(tag)).filter(Boolean).join('、')}
              </span>
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

        <div className="prototype-row-actions">
          <Link
            href={`/dashboard/notes/${note.id}`}
            className="p-1.5 rounded-md transition-colors hover:bg-white"
            style={{ color: 'var(--text-muted)' }}
            title={writable ? '编辑' : '查看'}
          >
            <PrototypeGlyph name={writable ? 'edit' : 'eye'} className="h-3.5 w-3.5" />
          </Link>
          {writable && (
            <button
              onClick={() => onRequestDelete(note.id)}
              className="p-1.5 rounded-md transition-colors hover:bg-white"
              style={{ color: 'var(--text-muted)' }}
              title="删除"
            >
              <PrototypeGlyph name="trash" className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {note.searchEvidence?.bestChunk ? <SearchHitEvidence noteId={note.id} hit={note.searchEvidence.bestChunk} additionalCount={note.searchEvidence.additionalChunkHits} additionalHits={note.searchEvidence.additionalChunks} query={searchQuery} /> : null}

      {/* 语义搜索命中项已内联展示命中 Chunk 概要，hover 浮卡会遮挡下一列表项，不再渲染 */}
      {!note.searchEvidence?.bestChunk ? (
        <NoteHoverPreview
          note={note}
          categoryLabel={categoryLabel}
          resolveTagId={resolveTagId}
          resolveTagLabel={resolveTagLabel}
        />
      ) : null}
    </div>
  )
}
