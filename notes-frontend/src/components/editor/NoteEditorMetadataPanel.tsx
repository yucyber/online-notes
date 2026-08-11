

import { PanelRightOpen } from 'lucide-react'

type TocItem = { id: string; text: string; level: number }

type Props = {
  id: string
  toc: TocItem[]
  collapsed: boolean
  isFullscreen: boolean
  onToggle: () => void
  restoreButtonRef?: React.RefObject<HTMLButtonElement>
}

export function NoteEditorMetadataPanel({ id, toc, collapsed, isFullscreen, onToggle, restoreButtonRef }: Props) {
  if (isFullscreen) return null

  if (collapsed) {
    return (
      <aside id="editor-right-metadata" className="editor-right-metadata editor-right-metadata--collapsed" aria-label="右侧面板" style={{ width: '52px' }}>
        <button
          ref={restoreButtonRef}
          type="button"
          className="editor-layout-restore-button"
          aria-label="展开右侧面板"
          title="展开右侧面板"
          onClick={onToggle}
        >
          <PanelRightOpen className="h-4 w-4" aria-hidden />
        </button>
      </aside>
    )
  }

  return (
    <aside id="editor-right-metadata" className="editor-right-metadata" aria-label="右侧面板">
      <div className="sticky top-20 space-y-3">
        <div className="rounded-lg border bg-white">
          <div className="px-4 py-2 border-b text-sm font-medium">{"大纲"}</div>
          <div className="p-3">
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
                    className="w-full text-left text-xs rounded px-3 py-2 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ paddingLeft: `${(heading.level - 1) * 12}px` }}
                  >
                    {heading.text}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="rounded-lg border bg-white">
          <div className="px-4 py-2 border-b text-sm font-medium flex items-center justify-between">
            <span>{"快速操作"}</span>
            <a href={`/dashboard/notes/${id}/versions`} className="text-xs text-blue-600">{"版本"}</a>
          </div>
          <div className="p-3 text-xs text-gray-500">
            {"在上方工具栏打开“协作抽屉”查看评论与协作者。"}
          </div>
        </div>
      </div>
    </aside>
  )
}
