import { ArrowLeft, FileText, PanelLeftClose, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  collapsed: boolean
  onBack: () => void
  onOpenNotes: () => void
  onToggle: () => void
  restoreButtonRef?: React.RefObject<HTMLButtonElement>
  children?: React.ReactNode
}

export function EditorWorkspaceSidebar({ collapsed, onBack, onOpenNotes, onToggle, restoreButtonRef, children }: Props) {
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

  return (
    <aside id="editor-left-navigation" className="editor-left-navigation" aria-label="编辑器导航">
      <div className="editor-workspace-sidebar">
        <div className="editor-workspace-sidebar__brand">
          <span className="editor-workspace-sidebar__mark" aria-hidden>N</span>
          <span>
            <strong>在线笔记</strong>
            <small>专注编辑</small>
          </span>
          <Button type="button" variant="ghost" size="icon" className="editor-workspace-sidebar__mobile-close" aria-label="收起左侧导航" onClick={onToggle}>
            <PanelLeftClose className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <label className="editor-workspace-sidebar__search">
          <Search className="h-4 w-4" aria-hidden />
          <span className="sr-only">搜索笔记</span>
          <input type="search" aria-label="搜索笔记" placeholder="搜索当前工作区" />
        </label>

        <nav aria-label="编辑器工作区">
          <Button type="button" variant="ghost" className="editor-workspace-sidebar__nav-item editor-workspace-sidebar__nav-item--active">
            <FileText className="h-4 w-4" aria-hidden />
            <span>当前笔记</span>
          </Button>
          <Button type="button" variant="ghost" className="editor-workspace-sidebar__nav-item" onClick={onOpenNotes}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span>全部笔记</span>
          </Button>
        </nav>

        <div className="editor-workspace-sidebar__footer">
          <Button type="button" variant="ghost" className="editor-workspace-sidebar__nav-item" aria-label="返回工作台" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span>返回工作台</span>
          </Button>
        </div>
      </div>
      {children}
    </aside>
  )
}
