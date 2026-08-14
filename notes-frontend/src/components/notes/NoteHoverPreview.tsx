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
    <div className="prototype-note-preview">
      <div className="prototype-note-preview__title line-clamp-1">
        {note.title || '无标题'}
      </div>
      <div className="prototype-note-preview__copy line-clamp-3">
        {note.summary || fallback}
      </div>
      {tags.length > 0 && (
        <div className="prototype-note-preview__tags">
          {tags.map((tag, idx) => {
            const id = resolveTagId(tag)
            const label = resolveTagLabel(tag)
            if (!label) return null
            const keySafe = id ? id : `${note.id}:${label}:${idx}`
            return (
              <span key={keySafe}>
                {label}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
