import { ArrowLeft, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Note } from '@/types'
import { EditorSaveStatus } from './EditorSaveStatus'
import type { SaveState } from './useEditorAutoSave'

type Props = {
  note: Note
  editorMode: 'rich' | 'markdown'
  leftCollapsed: boolean
  rightCollapsed: boolean
  onBack: () => void
  onModeChange: (event: React.ChangeEvent<HTMLSelectElement>) => void
  onVisibilityChange: (visibility: string) => void | Promise<void>
  onToggleLeft: () => void
  onToggleRight: () => void
  onOpenCollab: () => void
  saveState?: SaveState
  readOnly?: boolean
}

export function NoteEditorHeader({
  note,
  editorMode,
  leftCollapsed,
  rightCollapsed,
  onBack,
  onToggleLeft,
  onToggleRight,
  onOpenCollab,
  saveState,
  readOnly = false,
}: Props) {
  return (
    <div className="editor-header">
      <div className="editor-header__title-block">
        <div className="editor-header__title-row">
          <Button variant="ghost" size="icon" aria-label="返回笔记" title="返回笔记" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
          <div>
            <span className="editor-header__eyebrow">{editorMode === 'rich' ? '协同编辑' : 'Markdown'}</span>
            <div className="editor-header__title-line">
              <h1>{note.title || (readOnly ? '查看笔记' : '未命名笔记')}</h1>
              <span className="editor-header__mode-status">{readOnly ? '查看笔记' : '持续保存'}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="editor-header__actions">
        <EditorSaveStatus state={saveState || 'idle'} />
        <span className="editor-tooltip" data-tooltip={leftCollapsed ? '展开左侧导航' : '收起左侧导航'}>
          <Button variant="ghost" size="icon" aria-label={leftCollapsed ? '展开左侧导航' : '收起左侧导航'} aria-controls="editor-left-navigation" aria-expanded={!leftCollapsed} onClick={onToggleLeft}>
            {leftCollapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
          </Button>
        </span>
        <span className="editor-tooltip" data-tooltip={rightCollapsed ? '展开右侧面板' : '收起右侧面板'}>
          <Button variant="ghost" size="icon" aria-label={rightCollapsed ? '展开右侧面板' : '收起右侧面板'} aria-controls="editor-right-metadata" aria-expanded={!rightCollapsed} onClick={onToggleRight}>
            {rightCollapsed ? <PanelRightOpen className="h-4 w-4" aria-hidden /> : <PanelRightClose className="h-4 w-4" aria-hidden />}
          </Button>
        </span>
        <span className="editor-tooltip" data-tooltip="协作成员">
          <Button variant="ghost" size="icon" aria-label="打开协作" title="协作成员" onClick={onOpenCollab}>
            <Users className="h-4 w-4" aria-hidden />
          </Button>
        </span>
      </div>
    </div>
  )
}
