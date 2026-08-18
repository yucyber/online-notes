import { useState, useRef, useEffect } from 'react'
import { PrototypeGlyph } from '@/components/ui/prototype-glyph'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { Note } from '@/types'
import { EditorSaveStatus } from './EditorSaveStatus'
import type { SaveState } from './useEditorAutoSave'

type Props = {
  note: Note
  editorMode: 'rich' | 'markdown'
  onOpenComments: () => void
  onOpenCollab: () => void
  onToggleProperties: () => void
  propertiesOpen: boolean
  saveState?: SaveState
  readOnly?: boolean
  collaborators?: Array<{ id: string; name?: string }>
  onChangeTitle?: (value: string) => Promise<void> | void
}

const COLLAB_AVATAR_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#3b82f6',
]

function avatarColor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return COLLAB_AVATAR_COLORS[hash % COLLAB_AVATAR_COLORS.length]
}

function avatarInitial(name?: string) {
  const text = (name || '?').trim()
  return text ? text.slice(0, 1).toUpperCase() : '?'
}

export function NoteEditorHeader({
  note,
  onOpenComments,
  onOpenCollab,
  onToggleProperties,
  propertiesOpen,
  saveState,
  readOnly = false,
  collaborators = [],
  onChangeTitle,
}: Props) {
  const shown = collaborators.slice(0, 3)
  const overflow = collaborators.length - shown.length
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.title)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(note.title)
  }, [note.title, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEdit = () => {
    if (readOnly || !onChangeTitle) return
    setDraft(note.title)
    setEditing(true)
  }

  const commit = async () => {
    if (!onChangeTitle) {
      setEditing(false)
      return
    }
    const next = draft.trim()
    if (next === note.title || next.length === 0) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onChangeTitle(next)
      setEditing(false)
    } catch {
      setDraft(note.title)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const placeholder = readOnly ? '查看笔记' : '未命名笔记'
  return (
    <header className="editor-header">
      <nav className="editor-header__breadcrumb" aria-label="编辑器面包屑">
        <Link href="/dashboard/notes">我的笔记</Link>
        <PrototypeGlyph name="chevron-right" className="h-3 w-3" />
        {editing ? (
          <input
            ref={inputRef}
            className="editor-title-input"
            value={draft}
            disabled={saving}
            maxLength={200}
            placeholder="未命名笔记"
            aria-label="编辑笔记标题"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraft(note.title)
                setEditing(false)
              }
            }}
          />
        ) : (
          <h1
            className={onChangeTitle && !readOnly ? 'editor-title-editable' : undefined}
            title={onChangeTitle && !readOnly ? '点击修改标题' : undefined}
            onClick={startEdit}
          >
            {note.title || placeholder}
          </h1>
        )}
      </nav>
      <div className="editor-header__actions">
        {collaborators.length > 0 && (
          <div className="editor-collab-avatars" aria-label="协作中的成员">
            {shown.map((user) => (
              <span
                key={user.id}
                className="editor-collab-avatar"
                style={{ background: avatarColor(user.id) }}
                title={user.name || '协作者'}
              >
                {avatarInitial(user.name)}
              </span>
            ))}
            {overflow > 0 && (
              <span className="editor-collab-avatar editor-collab-avatar--more">+{overflow}</span>
            )}
          </div>
        )}
        <EditorSaveStatus state={saveState || 'idle'} />
        <span className="editor-tooltip" data-tooltip="评论">
          <Button variant="ghost" size="icon" aria-label="打开评论" onClick={onOpenComments}><PrototypeGlyph name="comment" className="h-4 w-4" /></Button>
        </span>
        <span className="editor-tooltip" data-tooltip="协作成员">
          <Button variant="ghost" size="icon" aria-label="打开协作" onClick={onOpenCollab}><PrototypeGlyph name="users" className="h-4 w-4" /></Button>
        </span>
        <span className="editor-tooltip" data-tooltip="笔记属性">
          <Button variant="ghost" size="icon" aria-label="打开笔记属性" aria-expanded={propertiesOpen} onClick={onToggleProperties}><PrototypeGlyph name="settings" className="h-4 w-4" /></Button>
        </span>
      </div>
    </header>
  )
}
