import { ChevronRight, MessageSquare, Settings2, Users } from 'lucide-react'
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
}

export function NoteEditorHeader({
  note,
  onOpenComments,
  onOpenCollab,
  onToggleProperties,
  propertiesOpen,
  saveState,
  readOnly = false,
}: Props) {
  return (
    <header className="editor-header">
      <nav className="editor-header__breadcrumb" aria-label="编辑器面包屑">
        <Link href="/dashboard/notes">我的笔记</Link>
        <ChevronRight className="h-3 w-3" aria-hidden />
        <h1>{note.title || (readOnly ? '查看笔记' : '未命名笔记')}</h1>
      </nav>
      <div className="editor-header__actions">
        <EditorSaveStatus state={saveState || 'idle'} />
        <span className="editor-tooltip" data-tooltip="评论">
          <Button variant="ghost" size="icon" aria-label="打开评论" onClick={onOpenComments}><MessageSquare className="h-4 w-4" aria-hidden /></Button>
        </span>
        <span className="editor-tooltip" data-tooltip="协作成员">
          <Button variant="ghost" size="icon" aria-label="打开协作" onClick={onOpenCollab}><Users className="h-4 w-4" aria-hidden /></Button>
        </span>
        <span className="editor-tooltip" data-tooltip="笔记属性">
          <Button variant="ghost" size="icon" aria-label="打开笔记属性" aria-expanded={propertiesOpen} onClick={onToggleProperties}><Settings2 className="h-4 w-4" aria-hidden /></Button>
        </span>
      </div>
    </header>
  )
}
