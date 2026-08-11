import { CollaboratorsPanel } from '@/components/collab/CollaboratorsPanel'
import { CommentsPanel } from '@/components/collab/CommentsPanel'

type Selection = { start: number; end: number }

type Props = {
  id: string
  selection: Selection
  showCollabDrawer: boolean
  showCommentsDrawer: boolean
  commentsDrawerRef: React.RefObject<HTMLDivElement>
  onCloseCollab: () => void
  onCloseComments: () => void
  readOnly?: boolean
}

export function NoteEditorDrawers({
  id,
  selection,
  showCollabDrawer,
  showCommentsDrawer,
  commentsDrawerRef,
  onCloseCollab,
  onCloseComments,
  readOnly = false,
}: Props) {
  return (
    <>
      {showCollabDrawer && (
        <div className="fixed inset-0 z-50" aria-modal="true" role="dialog">
          <div
            className="absolute inset-0 bg-black/20"
            role="button"
            tabIndex={0}
            onClick={onCloseCollab}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onCloseCollab()
            }}
          />
          <div className="absolute right-0 top-0 h-full w-full max-w-[360px] bg-white border-l shadow-xl">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <div className="text-sm font-medium">{"协作"}</div>
              <button className="text-gray-500 hover:text-gray-700 text-sm" onClick={onCloseCollab}>{"关闭"}</button>
            </div>
            <div className="p-4 space-y-4 overflow-auto h-full">
              <div className="rounded-lg border">
                <div className="px-3 py-2 border-b text-xs font-medium">{"协作者"}</div>
                <fieldset disabled={readOnly} className="min-w-0 border-0 p-3">
                  <CollaboratorsPanel noteId={id} />
                </fieldset>
              </div>
            </div>
          </div>
        </div>
      )}
      {showCommentsDrawer && (
        <div className="fixed inset-0 z-50" aria-modal="true" role="dialog" aria-labelledby="comments-drawer-title">
          <div
            className="absolute inset-0 bg-black/20"
            role="button"
            tabIndex={0}
            onClick={onCloseComments}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onCloseComments()
            }}
          />
          <div
            ref={commentsDrawerRef}
            id="comments-drawer"
            className="absolute right-0 top-0 h-full w-full max-w-[380px] bg-white border-l shadow-xl"
            style={{ borderRadius: 0, transform: 'translateX(0)', transition: 'transform 300ms ease-in-out' }}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <div id="comments-drawer-title" className="text-sm font-medium">{"划词评论"}</div>
              <div className="text-xs text-gray-500">选区：{selection.start}–{selection.end}（长度：{Math.max(0, selection.end - selection.start)}）</div>
              <button className="text-gray-500 hover:text-gray-700 text-sm" onClick={onCloseComments}>{"关闭"}</button>
            </div>
            <div className="p-4 overflow-auto h-full">
              <div className="rounded-lg border" style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-md)' }}>
                <fieldset disabled={readOnly} className="min-w-0 border-0 p-3">
                  <CommentsPanel noteId={id} selection={selection} />
                </fieldset>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
