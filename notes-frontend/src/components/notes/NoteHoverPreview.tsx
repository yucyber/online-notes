'use client'

import type { Note } from '@/types'
import { truncateText } from '@/utils'

type Props = {
  note: Note
  categoryLabel: string
  resolveTagId: (tag: string | { id?: string; _id?: string }) => string
  resolveTagLabel: (tag: string | { name?: string; id?: string; _id?: string }) => string
}

// 列表项 hover 浮卡：展示标题、摘要前若干字与标签，替代常驻摘要。
export function NoteHoverPreview({ note, categoryLabel, resolveTagId, resolveTagLabel }: Props) {
  const fallback = note.content
    ? truncateText(note.content.replace(/<[^>]+>/g, '').replace(/[#*`_~>\[\]()]/g, ''), 80)
    : '正在生成摘要...'
  const tags = note.tags.slice(0, 4)

  return (
    <div className="absolute left-3 top-full z-30 mt-2 w-[280px] rounded-xl border border-[var(--border)] bg-white p-3.5 opacity-0 shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition-all duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none translate-y-[-4px] group-hover:translate-y-0">
      <div className="mb-1.5 line-clamp-1 text-[14px] font-semibold text-[var(--on-surface)]">
        {note.title || '无标题'}
      </div>
      <div className="line-clamp-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
        {note.summary || fallback}
      </div>
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((tag, idx) => {
            const id = resolveTagId(tag)
            const label = resolveTagLabel(tag)
            if (!label) return null
            const keySafe = id ? id : `${note.id}:${label}:${idx}`
            return (
              <span
                key={keySafe}
                className="rounded-full border border-[var(--primary-100)] px-2 py-0.5 text-[11px] font-medium"
                style={{ background: 'var(--primary-50)', color: 'var(--primary-600)' }}
              >
                {label}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
