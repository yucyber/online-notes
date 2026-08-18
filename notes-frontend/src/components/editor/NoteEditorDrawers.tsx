'use client'

import { useEffect } from 'react'
import { Users, X } from 'lucide-react'
import { CollaboratorsPanel } from '@/components/collab/CollaboratorsPanel'
import type { CollaborationParticipant } from '@/components/collab/CollaboratorsPanel'
import type { Collaborator } from '@/lib/api/collab'
import { CommentsPanel } from '@/components/collab/CommentsPanel'

type Selection = { start: number; end: number }

type Props = {
  id: string
  owner?: Omit<Collaborator, 'role'>
  currentUserId?: string
  selection: Selection
  showCollabDrawer: boolean
  showCommentsDrawer: boolean
  collaborators?: CollaborationParticipant[]
  commentsDrawerRef: React.RefObject<HTMLDivElement>
  onCloseCollab: () => void
  onCloseComments: () => void
  readOnly?: boolean
}

export function NoteEditorDrawers({
  id,
  owner,
  currentUserId,
  selection,
  showCollabDrawer,
  showCommentsDrawer,
  collaborators = [],
  commentsDrawerRef,
  onCloseCollab,
  onCloseComments,
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
              <CollaboratorsPanel noteId={id} owner={owner} currentUserId={currentUserId} readOnly={readOnly} participants={collaborators} />
            </div>
          </aside>
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
                <div className="p-3">
                  <CommentsPanel noteId={id} selection={selection} readOnly={readOnly} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
