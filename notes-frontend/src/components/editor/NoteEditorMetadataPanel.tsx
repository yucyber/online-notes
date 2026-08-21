import type { ReactNode } from 'react'
import { History, X } from 'lucide-react'

type Props = {
  id: string
  open: boolean
  panelRef: React.RefObject<HTMLDivElement>
  properties?: ReactNode
  showVersions?: boolean
  onClose?: () => void
}

export function NoteEditorMetadataPanel({ id, open, panelRef, properties, showVersions = true, onClose }: Props) {
  if (!open) return null

  return (
    <div ref={panelRef} role="dialog" aria-label="笔记属性" className="editor-properties-popover">
      <div className="editor-properties-popover__header">
        <h2>笔记属性</h2>
        {onClose ? (
          <button type="button" className="editor-properties-popover__close" aria-label="关闭笔记属性" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="editor-properties-popover__body">{properties}</div>
      {showVersions ? (
        <div className="editor-properties-popover__footer">
          <a href={`/dashboard/notes/${id}/versions`} className="editor-metadata-panel__versions">
            <History aria-hidden="true" />
            查看历史版本
          </a>
        </div>
      ) : null}
    </div>
  )
}
