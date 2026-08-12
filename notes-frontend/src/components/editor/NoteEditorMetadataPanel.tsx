import type { ReactNode } from 'react'

type Props = {
  id: string
  open: boolean
  panelRef: React.RefObject<HTMLDivElement>
  properties?: ReactNode
}

export function NoteEditorMetadataPanel({ id, open, panelRef, properties }: Props) {
  if (!open) return null

  return (
    <div ref={panelRef} role="dialog" aria-label="笔记属性" className="editor-properties-popover">
      <div className="editor-properties-popover__header"><h2>笔记属性</h2></div>
      <div className="editor-properties-popover__body">{properties}</div>
      <a href={`/dashboard/notes/${id}/versions`} className="editor-metadata-panel__versions">查看历史版本</a>
    </div>
  )
}
