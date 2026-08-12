

import { PanelRightOpen } from 'lucide-react'
import type { ReactNode } from 'react'

type TocItem = { id: string; text: string; level: number }

type Props = {
  id: string
  toc: TocItem[]
  collapsed: boolean
  isFullscreen: boolean
  onToggle: () => void
  restoreButtonRef?: React.RefObject<HTMLButtonElement>
  properties?: ReactNode
}

export function NoteEditorMetadataPanel({ id, toc, collapsed, isFullscreen, onToggle, restoreButtonRef, properties }: Props) {
  if (isFullscreen) return null

  if (collapsed) {
    return (
      <aside id="editor-right-metadata" className="editor-right-metadata editor-right-metadata--collapsed" aria-label="笔记属性" style={{ width: '52px' }}>
        <button
          ref={restoreButtonRef}
          type="button"
          className="editor-layout-restore-button"
        aria-label="展开右侧面板"
        title="展开右侧面板"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onToggle()
        }}
      >
          <PanelRightOpen className="h-4 w-4" aria-hidden />
        </button>
      </aside>
    )
  }

  return (
    <aside id="editor-right-metadata" className="editor-right-metadata" aria-label="笔记属性">
      <div className="editor-metadata-panel">
        <section className="editor-metadata-panel__section">
          <h2>笔记属性</h2>
          {properties}
        </section>
        <section className="editor-metadata-panel__section">
          <h2>大纲</h2>
          <div className="editor-metadata-panel__toc">
            {toc.length === 0 ? (
              <div className="text-xs text-gray-400">{"暂无标题"}</div>
            ) : (
              <div className="space-y-1">
                {toc.map((heading) => (
                  <button
                    key={heading.id}
                    onClick={() => {
                      const element = document.getElementById(heading.id)
                      if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                    className="editor-metadata-panel__toc-link"
                    style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}
                  >
                    {heading.text}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
        <a href={`/dashboard/notes/${id}/versions`} className="editor-metadata-panel__versions">查看版本历史</a>
      </div>
    </aside>
  )
}
