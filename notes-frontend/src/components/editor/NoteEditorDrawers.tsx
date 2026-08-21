'use client'

import { useEffect } from 'react'
import { MessageSquare, Users, X } from 'lucide-react'
import { CollaboratorsPanel } from '@/components/collab/CollaboratorsPanel'
import type { CollaborationParticipant } from '@/components/collab/CollaboratorsPanel'
import { CommentsPanel } from '@/components/collab/CommentsPanel'

type Selection = { start: number; end: number }
type CommentsMode = 'overview' | 'selection'

// 把选区位置转成可读的提示文案，避免向用户暴露起始偏移和长度这类技术细节。
function selectionHint(selection: Selection): string {
  const length = Math.max(0, selection.end - selection.start)
  if (length <= 0) return '在正文中划选文字后即可添加评论'
  return `已选中 ${length} 个字`
}

type Props = {
  id: string
  currentUserId?: string
  selection: Selection
  showCollabDrawer: boolean
  showCommentsDrawer: boolean
  commentsMode: CommentsMode
  collaborators?: CollaborationParticipant[]
  commentsDrawerRef: React.RefObject<HTMLDivElement>
  onCloseCollab: () => void
  onCloseComments: () => void
  onLocateComment: (commentId: string) => void
  readOnly?: boolean
}

export function NoteEditorDrawers({
  id,
  currentUserId,
  selection,
  showCollabDrawer,
  showCommentsDrawer,
  commentsMode,
  collaborators = [],
  commentsDrawerRef,
  onCloseCollab,
  onCloseComments,
  onLocateComment,
  readOnly = false,
}: Props) {
  useEffect(() => {
    if (!showCollabDrawer) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.querySelector('.collab-member-menu, .collab-invite-role__menu')) return
      onCloseCollab()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onCloseCollab, showCollabDrawer])

  return (
    <>
      {showCollabDrawer && (
        <div className="collab-drawer-layer" aria-modal="true" aria-labelledby="collab-drawer-title" role="dialog">
          <button type="button" className="collab-drawer-backdrop" aria-label="关闭协作侧栏" onClick={onCloseCollab} />
          <aside className="collab-drawer" aria-label="协作侧栏">
            <div className="collab-drawer__head">
              <div id="collab-drawer-title" className="collab-drawer__title">
                <Users aria-hidden="true" />
                协作
              </div>
              <button type="button" className="collab-drawer__close" aria-label="关闭协作侧栏" onClick={onCloseCollab}>
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="collab-drawer__content">
              <CollaboratorsPanel noteId={id} currentUserId={currentUserId} readOnly={readOnly} participants={collaborators} />
            </div>
          </aside>
        </div>
      )}
      {showCommentsDrawer && commentsMode === 'overview' && (
        <div className="collab-drawer-layer" aria-modal="true" aria-labelledby="comments-drawer-title" role="dialog">
          <button type="button" className="collab-drawer-backdrop" aria-label="关闭评论侧栏" onClick={onCloseComments} />
          <aside ref={commentsDrawerRef} id="comments-drawer" className="collab-drawer collab-drawer--comments" aria-label="全部评论">
            <div className="collab-drawer__head">
              <div id="comments-drawer-title" className="collab-drawer__title">
                <MessageSquare aria-hidden="true" />
                全部评论
              </div>
              <button type="button" className="collab-drawer__close" aria-label="关闭评论侧栏" onClick={onCloseComments}>
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="collab-drawer__content">
              <div className="comments-selection-hint">点击评论可定位到正文对应位置</div>
              <CommentsPanel noteId={id} selection={selection} readOnly={readOnly} mode="overview" onLocate={onLocateComment} />
            </div>
          </aside>
        </div>
      )}
      {showCommentsDrawer && commentsMode === 'selection' && (
        <div className="comment-popover-layer" aria-label="划词评论" role="dialog">
          <div ref={commentsDrawerRef} className="comment-popover">
            <div className="comment-popover__head">
              <div className="comment-popover__title">
                <MessageSquare aria-hidden="true" />
                划词评论
              </div>
              <button type="button" className="comment-popover__close" aria-label="关闭划词评论" onClick={onCloseComments}>
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="comment-popover__body">
              <div className="comments-selection-hint">{selectionHint(selection)}</div>
              <CommentsPanel noteId={id} selection={selection} readOnly={readOnly} mode="selection" />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
