import { useEffect, useState } from 'react'
import { aclAPI, invitationsAPI } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function CollaboratorsPanel({ noteId }: { noteId: string }) {
  const [acl, setAcl] = useState<{ userId: string; role: string }[]>([])
  const [visibility, setVisibility] = useState('private')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer')
  const [invites, setInvites] = useState<any[]>([])
  const [lastInvite, setLastInvite] = useState<{ token: string; expiresAt: string } | null>(null)
  const load = async () => {
    const r: any = await aclAPI.get(noteId)
    setVisibility(r.visibility)
    setAcl(r.acl || [])
    try {
      const iv = await invitationsAPI.list(noteId)
      setInvites(iv || [])
    } catch (e: any) {
      // 非所有者视角：邀请列表不可见
      setInvites([])
    }
  }
  useEffect(() => { load() }, [noteId])
  useEffect(() => {
    const timer = setInterval(() => { load().catch(() => { }) }, 5000)
    const onVis = () => { if (document.visibilityState === 'visible') load().catch(() => { }) }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [noteId])
  useEffect(() => {
    if (invites.length > 0) {
      const hasPending = invites.some(v => v.status === 'pending')
      if (!hasPending && lastInvite) setLastInvite(null)
    }
  }, [invites])
  const sendInvite = async () => {
    if (!email) return
    const created = await invitationsAPI.create(noteId, role, email, 24)
    setLastInvite(created)
    setEmail('')
    await load()
  }
  return (
    <div className="space-y-4">
      <div className="text-sm" aria-live="polite" role="status">可见性：{visibility}</div>
      <div>
        <div className="font-medium mb-2">协作者</div>
        <ul className="space-y-2" aria-label="协作者列表" role="list">
          {acl.map((a, i) => (
            <li key={i} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 rounded-full items-center justify-center text-white" style={{ backgroundColor: '#2468F2' }} aria-hidden>{(a.userId || 'U')[0].toUpperCase()}</span>
                <span className="text-sm" aria-label={`用户 ${a.userId}，角色 ${a.role}`}>{a.userId} · {a.role}</span>
              </div>
              <div className="text-xs text-gray-500">已添加</div>
            </li>
          ))}
          {acl.length === 0 && <div className="text-sm text-gray-500">暂无协作者</div>}
        </ul>
      </div>
      <div>
        <div className="font-medium mb-2">发送邀请</div>
        <div className="flex gap-2">
          <label htmlFor="invite-email" className="sr-only">邀请邮箱</label>
          <Input id="invite-email" aria-label="邀请邮箱" value={email} onChange={e => setEmail(e.target.value)} placeholder="邮箱" />
          <label htmlFor="invite-role" className="sr-only">权限角色</label>
          <select id="invite-role" aria-label="权限角色" value={role} onChange={e => setRole(e.target.value as any)} className="border rounded px-2 text-sm" style={{ height: 44 }}>
            <option value="viewer">只读</option>
            <option value="editor">可编辑</option>
          </select>
          <Button onClick={sendInvite} aria-label="发送邀请">发送</Button>
        </div>
        {lastInvite && (
          <div className="mt-3 text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded px-3 py-2 flex items-center justify-between">
            <div>
              已生成邀请链接，有效期至 {new Date(lastInvite.expiresAt).toLocaleString('zh-CN')}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const url = `${location.origin}/invitations/${lastInvite.token}/accept`
                  navigator.clipboard.writeText(url)
                }}
                aria-label="复制邀请链接">复制链接</Button>
              <Button
                size="sm"
                onClick={() => {
                  const url = `${location.origin}/invitations/${lastInvite.token}/accept`
                  window.open(url, '_blank')
                }}
                aria-label="打开接受页">打开接受页</Button>
            </div>
          </div>
        )}
        <div className="mt-2">
          <Button size="sm" variant="outline" onClick={() => load()} aria-label="刷新邀请与协作者状态">刷新状态</Button>
        </div>
      </div>
      <div>
        <div className="font-medium mb-2">邀请列表</div>
        <ul className="space-y-2" aria-label="邀请列表" role="list">
          {invites.map((v, i) => (
            <li key={i} className="flex items-center justify-between">
              <span className="text-sm">{v.inviteeEmail || '未指定'} · {v.role} · {v.status}</span>
              <span className="text-xs text-gray-500">创建于 {new Date(v.createdAt).toLocaleString('zh-CN')}</span>
            </li>
          ))}
          {invites.length === 0 && <div className="text-sm text-gray-500">暂无邀请</div>}
        </ul>
      </div>
    </div>
  )
}
