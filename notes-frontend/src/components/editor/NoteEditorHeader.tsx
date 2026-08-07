import { ArrowLeft, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Note } from '@/types'

type Props = {
  note: Note
  editorMode: 'rich' | 'markdown'
  showSidebar: boolean
  onBack: () => void
  onModeChange: (event: React.ChangeEvent<HTMLSelectElement>) => void
  onVisibilityChange: (visibility: string) => void | Promise<void>
  onToggleSidebar: () => void
  onOpenCollab: () => void
}

export function NoteEditorHeader({
  note,
  editorMode,
  showSidebar,
  onBack,
  onModeChange,
  onVisibilityChange,
  onToggleSidebar,
  onOpenCollab,
}: Props) {
  return (
    <div className="sticky top-0 z-40 backdrop-blur border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="text-gray-500 hover:text-gray-700">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm" style={{ color: 'var(--on-surface)' }}>{"编辑笔记"}</span>
          <div className="hidden md:flex items-center gap-3 ml-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{"编辑器"}</span>
            <select className="rounded border px-2 py-1 text-xs" value={editorMode} onChange={onModeChange} style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}>
              <option value="rich">{"富文本（协同）"}</option>
              <option value="markdown">Markdown</option>
            </select>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{"可见性"}</span>
            <select
              className="rounded border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
              value={(note as any)?.visibility || 'private'}
              onChange={(event) => onVisibilityChange(event.target.value)}
            >
              <option value="private">{"仅自己"}</option>
              <option value="org">{"组织内"}</option>
              <option value="public">{"公开只读"}</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" aria-pressed={!showSidebar} onClick={onToggleSidebar} className="hover:bg-[var(--surface-2)]">
            {showSidebar ? (
              <span className="inline-flex items-center gap-1"><ChevronRight className="h-4 w-4" /> {"隐藏侧栏"}</span>
            ) : (
              <span className="inline-flex items-center gap-1"><ChevronLeft className="h-4 w-4" /> {"显示侧栏"}</span>
            )}
          </Button>
          <Button variant="ghost" size="icon" aria-label={"编辑笔记"} title={"编辑器"} onClick={onOpenCollab} className="hover:bg-[var(--surface-2)]">
            <Users className="h-5 w-5" />
            <span className="sr-only">{"协作"}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
