'use client'

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, LockKeyhole, Search } from 'lucide-react'
import { aclAPI, invitationsAPI } from '@/lib/api'
import type { AclResponse, Collaborator, InvitationSummary, NoteVisibility } from '@/lib/api/collab'
import { appToast } from '@/lib/app-toast'
import { getStoredUser } from '@/lib/auth'
import { CollaboratorMemberRow } from './CollaboratorMemberRow'

export type CollaborationParticipant = { id: string; name?: string }

type Props = {
  noteId: string
  readOnly?: boolean
  participants?: CollaborationParticipant[]
}

const VISIBILITY_COPY: Record<NoteVisibility, string> = {
  private: '仅受邀成员可见',
  org: '组织成员可见',
  public: '任何人可见',
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function displayName(member: Collaborator) {
  return member.displayName?.trim() || member.email?.trim() || `${member.userId.slice(0, 6)}…`
}

function invitationDate(createdAt: string) {
  const created = new Date(createdAt)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfCreated = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime()
  const days = Math.round((startOfToday - startOfCreated) / 86_400_000)
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  return created.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function InviteRolePicker({ role, disabled, onChange }: { role: 'editor' | 'viewer'; disabled: boolean; onChange: (role: 'editor' | 'viewer') => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className="collab-invite-role">
      <button type="button" className="collab-invite-role__trigger" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}>
        {role === 'editor' ? '可编辑' : '只读'}
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className="collab-invite-role__menu" role="menu">
          {(['viewer', 'editor'] as const).map(option => (
            <button
              key={option}
              type="button"
              className="collab-member-menu__item"
              role="menuitem"
              onClick={() => {
                onChange(option)
                setOpen(false)
              }}
            >
              {option === 'editor' ? '可编辑' : '只读'}
              {option === role ? <Check aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function CollaboratorsPanel({ noteId, readOnly = false, participants = [] }: Props) {
  const [acl, setAcl] = useState<Collaborator[]>([])
  const [visibility, setVisibility] = useState<NoteVisibility>('private')
  const [canManage, setCanManage] = useState(false)
  const [invites, setInvites] = useState<InvitationSummary[]>([])
  const [inviteManagementAvailable, setInviteManagementAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer')
  const [busyKey, setBusyKey] = useState('')
  const [currentUserId, setCurrentUserId] = useState('')

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    const [aclResult, invitationResult] = await Promise.allSettled([
      aclAPI.get(noteId),
      invitationsAPI.list(noteId),
    ])

    if (aclResult.status === 'fulfilled') {
      const result: AclResponse = aclResult.value
      setVisibility(result.visibility)
      setAcl(result.acl || [])
      setCanManage(result.canManage)
      setLoadError('')
    } else {
      setLoadError('协作信息暂时无法加载')
    }

    if (invitationResult.status === 'fulfilled') {
      setInvites(invitationResult.value.filter(invite => invite.status === 'pending'))
      setInviteManagementAvailable(true)
    } else {
      setInvites([])
      setInviteManagementAvailable(false)
    }
    setLoading(false)
  }, [noteId])

  useEffect(() => { void load(true) }, [load])
  useEffect(() => { setCurrentUserId(getStoredUser()?.id || '') }, [])
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => document.removeEventListener('visibilitychange', refreshWhenVisible)
  }, [load])

  const runAction = async (key: string, action: () => Promise<unknown>, successTitle: string) => {
    if (busyKey) return false
    setBusyKey(key)
    try {
      await action()
      await load()
      appToast.success({ id: `collab:${key}:success`, title: successTitle })
      return true
    } catch {
      appToast.error({ id: `collab:${key}:error`, title: '操作未完成', message: '请稍后重试。' })
      return false
    } finally {
      setBusyKey('')
    }
  }

  const sendInvite = async (event: FormEvent) => {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      appToast.error({ id: 'collab:invite:email', title: '请输入有效邮箱' })
      return
    }
    const sent = await runAction('invite:create', () => invitationsAPI.create(noteId, role, normalizedEmail, 24), '邀请已发送')
    if (sent) setEmail('')
  }

  const resendInvite = async (invite: InvitationSummary) => {
    if (!invite.inviteeEmail || busyKey) return
    const key = `invite:${invite.id}`
    setBusyKey(key)
    try {
      await invitationsAPI.create(noteId, invite.role, invite.inviteeEmail, 24)
      try {
        await invitationsAPI.revoke(invite.id)
        appToast.success({ id: `collab:${key}:success`, title: '邀请已重新发送' })
      } catch {
        appToast.error({ id: `collab:${key}:partial`, title: '新邀请已发送', message: '旧邀请未能撤销，请稍后再试。' })
      }
      await load()
    } catch {
      appToast.error({ id: `collab:${key}:error`, title: '重新发送失败', message: '原邀请仍然有效。' })
    } finally {
      setBusyKey('')
    }
  }

  const canManageMembers = canManage && !readOnly
  const canInvite = canManageMembers && inviteManagementAvailable
  const participantIds = new Set(participants.map(participant => participant.id))
  const showPresence = participants.length > 0

  if (loading) {
    return (
      <div className="collab-panel" aria-busy="true" aria-label="正在加载协作信息">
        <div className="collab-skeleton collab-skeleton--share" />
        <div className="collab-group">
          <div className="collab-section-title">成员</div>
          <div className="collab-skeleton collab-skeleton--member" />
          <div className="collab-skeleton collab-skeleton--member" />
        </div>
      </div>
    )
  }

  if (loadError && acl.length === 0) {
    return (
      <div className="collab-panel__error" role="alert">
        <span>{loadError}</span>
        <button type="button" onClick={() => void load(true)}>重新加载</button>
      </div>
    )
  }

  return (
    <div className="collab-panel">
      <section className="collab-group" aria-label="可见性">
        <div className="collab-share-row">
          <LockKeyhole aria-hidden="true" />
          <div className="collab-share-row__main">
            <div className="collab-share-row__title">{VISIBILITY_COPY[visibility]}</div>
          </div>
        </div>
      </section>

      <section className="collab-group" aria-labelledby="collab-members-heading">
        <h3 id="collab-members-heading" className="collab-section-title">成员</h3>
        <ul className="collab-member-list" role="list">
          {acl.map(member => {
            const isSelf = member.userId === currentUserId
            return (
              <CollaboratorMemberRow
                key={member.userId}
                kind="member"
                name={isSelf ? '我' : displayName(member)}
                meta={member.role === 'owner' ? '所有者' : undefined}
                role={member.role}
                avatarUrl={member.avatarUrl}
                isSelf={isSelf || member.role === 'owner'}
                online={participantIds.has(member.userId)}
                showPresence={showPresence}
                canManage={canManageMembers && member.role !== 'owner'}
                busy={busyKey === `member:${member.userId}`}
                onRoleChange={nextRole => void runAction(`member:${member.userId}`, () => aclAPI.update(noteId, member.userId, nextRole), '成员权限已更新')}
                onRemove={() => void runAction(`member:${member.userId}`, () => aclAPI.remove(noteId, member.userId), '成员已移除')}
              />
            )
          })}
          {canInvite && invites.map(invite => (
            <CollaboratorMemberRow
              key={invite.id}
              kind="invitation"
              name={invite.inviteeEmail || '未指定邮箱'}
              meta={`待接受 · ${invitationDate(invite.createdAt)}`}
              role="pending"
              canManage
              busy={busyKey === `invite:${invite.id}`}
              onResend={() => void resendInvite(invite)}
              onRevoke={() => void runAction(`invite:${invite.id}`, () => invitationsAPI.revoke(invite.id), '邀请已撤销')}
            />
          ))}
          {acl.length === 0 && invites.length === 0 ? <li className="collab-member-list__empty">暂无协作成员</li> : null}
        </ul>
      </section>

      {canInvite ? (
        <section className="collab-group" aria-labelledby="collab-invite-heading">
          <h3 id="collab-invite-heading" className="collab-section-title">邀请成员</h3>
          <form className="collab-invite-form" onSubmit={event => void sendInvite(event)}>
            <label className="collab-invite-field">
              <Search aria-hidden="true" />
              <span className="sr-only">邀请邮箱</span>
              <input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="请输入邮箱" disabled={Boolean(busyKey)} />
            </label>
            <InviteRolePicker role={role} disabled={Boolean(busyKey)} onChange={setRole} />
            <button type="submit" className="collab-button collab-button--primary" disabled={Boolean(busyKey) || !email.trim()}>发送</button>
          </form>
          <p className="collab-invite-hint">被邀请者将收到邀请通知，并可在接受后查看或编辑此笔记。</p>
        </section>
      ) : null}
    </div>
  )
}
