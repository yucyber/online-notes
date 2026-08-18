'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, LoaderCircle } from 'lucide-react'
import type { AclRole } from '@/lib/api/collab'

type Props = {
  kind: 'member' | 'invitation'
  name: string
  meta?: string
  role: AclRole | 'pending'
  avatarUrl?: string
  isSelf?: boolean
  online?: boolean
  showPresence?: boolean
  canManage?: boolean
  busy?: boolean
  onRoleChange?: (role: 'editor' | 'viewer') => void
  onRemove?: () => void
  onResend?: () => void
  onRevoke?: () => void
}

function MemberAvatar({ name, avatarUrl, isSelf, online, showPresence }: Pick<Props, 'name' | 'avatarUrl' | 'isSelf' | 'online' | 'showPresence'>) {
  const [imageFailed, setImageFailed] = useState(false)
  const initial = name.trim().charAt(0).toUpperCase() || 'U'

  return (
    <span className={`collab-avatar${isSelf ? ' collab-avatar--self' : ''}`} aria-hidden="true">
      {avatarUrl && !imageFailed
        ? <img src={avatarUrl} alt="" onError={() => setImageFailed(true)} />
        : initial}
      {showPresence ? <span className={`collab-avatar__dot${online ? '' : ' collab-avatar__dot--off'}`} /> : null}
    </span>
  )
}

export function CollaboratorMemberRow({
  kind,
  name,
  meta,
  role,
  avatarUrl,
  isSelf = false,
  online = false,
  showPresence = false,
  canManage = false,
  busy = false,
  onRoleChange,
  onRemove,
  onResend,
  onRevoke,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const rowRef = useRef<HTMLLIElement>(null)
  const isOwner = role === 'owner'
  const displayedRole = role === 'editor' ? '可编辑' : '只读'

  useEffect(() => {
    if (!menuOpen) return
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const invoke = (action?: () => void) => {
    setMenuOpen(false)
    action?.()
  }

  return (
    <li ref={rowRef} className="collab-member" data-busy={busy || undefined}>
      <MemberAvatar name={name} avatarUrl={avatarUrl} isSelf={isSelf} online={online} showPresence={showPresence && kind === 'member'} />
      <div className="collab-member__identity">
        <div className="collab-member__name">{name}</div>
        {meta ? <div className="collab-member__meta">{meta}</div> : null}
      </div>
      <div className="collab-member__actions">
        {busy ? <LoaderCircle className="collab-member__spinner" aria-label="正在处理" /> : null}
        {isOwner ? (
          <span className="collab-role-trigger collab-role-trigger--owner" title="所有者权限不可更改">可编辑</span>
        ) : canManage ? (
          <>
            <button
              type="button"
              className={`collab-role-trigger${kind === 'invitation' ? ' collab-role-trigger--pending' : ''}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={busy}
              onClick={() => setMenuOpen(open => !open)}
            >
              {kind === 'invitation' ? '待接受' : displayedRole}
              <ChevronDown aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div className="collab-member-menu" role="menu">
                {kind === 'member' ? (
                  <>
                    <button type="button" className="collab-member-menu__item" role="menuitem" onClick={() => invoke(() => onRoleChange?.('viewer'))}>
                      只读
                      {role !== 'editor' ? <Check aria-hidden="true" /> : null}
                    </button>
                    <button type="button" className="collab-member-menu__item" role="menuitem" onClick={() => invoke(() => onRoleChange?.('editor'))}>
                      可编辑
                      {role === 'editor' ? <Check aria-hidden="true" /> : null}
                    </button>
                    <div className="collab-member-menu__separator" />
                    <button type="button" className="collab-member-menu__item collab-member-menu__item--danger" role="menuitem" onClick={() => invoke(onRemove)}>
                      移除成员
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="collab-member-menu__item" role="menuitem" onClick={() => invoke(onResend)}>
                      重新发送
                    </button>
                    <div className="collab-member-menu__separator" />
                    <button type="button" className="collab-member-menu__item collab-member-menu__item--danger" role="menuitem" onClick={() => invoke(onRevoke)}>
                      撤销邀请
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </>
        ) : (
          <span className="collab-role-trigger collab-role-trigger--owner">{kind === 'invitation' ? '待接受' : displayedRole}</span>
        )}
      </div>
    </li>
  )
}
