import { ArrowLeft, FileText, PanelLeftClose, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Note } from '@/types'

type Props = {
  collapsed: boolean
  notes?: Note[]
  currentNoteId?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  onOpenNote?: (id: string) => void
  onBack: () => void
  onToggle: () => void
  restoreButtonRef?: React.RefObject<HTMLButtonElement>
  children?: React.ReactNode
}

export function EditorWorkspaceSidebar({
  collapsed,
  notes = [],
  currentNoteId,
  searchValue = '',
  onSearchChange,
  onOpenNote,
  onBack,
  onToggle,
  restoreButtonRef,
  children,
}: Props) {
  if (collapsed) {
    return (
      <aside id="editor-left-navigation" className="editor-left-navigation editor-left-navigation--collapsed" aria-label="编辑器导航">
        <Button ref={restoreButtonRef} type="button" variant="ghost" size="icon" aria-label="展开左侧导航" title="展开左侧导航" onClick={onToggle} onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onToggle()
        }}>
          <FileText className="h-4 w-4" aria-hidden />
        </Button>
      </aside>
    )
  }

  const visibleNotes = notes.filter((note) => note.title?.toLocaleLowerCase().includes(searchValue.trim().toLocaleLowerCase()))

  return (
    <aside id="editor-left-navigation" className="editor-left-navigation" aria-label="编辑器导航">
      <div className="editor-workspace-sidebar">
        <div className="editor-workspace-sidebar__brand">
          <span className="editor-workspace-sidebar__mark" aria-hidden>N</span>
          <span><strong>在线笔记</strong><small>专注编辑</small></span>
          <Button type="button" variant="ghost" size="icon" className="editor-workspace-sidebar__mobile-close" aria-label="关闭左侧导航抽屉" onClick={onToggle}>
            <PanelLeftClose className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <label className="editor-workspace-sidebar__search">
          <Search className="h-4 w-4" aria-hidden />
          <span className="sr-only">搜索笔记</span>
          <input type="search" value={searchValue} onChange={(event) => onSearchChange?.(event.target.value)} aria-label="搜索笔记" placeholder="搜索笔记" />
        </label>

        <nav className="editor-note-directory" aria-label="笔记目录">
          <div className="editor-note-directory__heading">笔记目录</div>
          {visibleNotes.map((note) => (
            <button
              key={note.id}
              type="button"
              className="editor-note-directory__item"
              data-active={note.id === currentNoteId}
              aria-current={note.id === currentNoteId ? 'page' : undefined}
              onClick={() => onOpenNote?.(note.id)}
            >
              <FileText className="h-4 w-4" aria-hidden />
              <span>{note.title || '未命名笔记'}</span>
            </button>
          ))}
          {visibleNotes.length === 0 && <p className="editor-note-directory__empty">暂无匹配笔记</p>}
        </nav>

        <div className="editor-workspace-sidebar__footer">
          <Button type="button" variant="ghost" className="editor-workspace-sidebar__nav-item" aria-label="返回工作台" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden /><span>返回工作台</span>
          </Button>
        </div>
      </div>
      {children}
    </aside>
  )
}
