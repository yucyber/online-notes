import { useEffect, useMemo, useRef, useState } from 'react'
import { listComments, createComment, commentsAPI } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Reply = { _id?: string; authorId?: string; text: string; createdAt?: string }
type CommentItem = { _id?: string; id?: string; start: number; end: number; text: string; authorId?: string; createdAt?: string; replies?: Reply[]; likes?: number }

export function CommentsPanel({ noteId, selection }: { noteId: string; selection: { start: number; end: number } }) {
  const [items, setItems] = useState<CommentItem[]>([])
  const [text, setText] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const me = useMemo(() => ({ id: (typeof localStorage !== 'undefined' ? String(localStorage.getItem('notes_user_id') || '') : ''), name: '我' }), [])
  const appliedRef = useRef<Set<string>>(new Set())
  const selectDebounceRef = useRef<number | null>(null)
  const load = async () => {
    const hasRange = typeof selection.start === 'number' && typeof selection.end === 'number'
    const r = hasRange ? await commentsAPI.list(noteId, { start: selection.start, end: selection.end, intersects: true, limit: 50 }) : await listComments(noteId)
    const mapped = (r || []).map((c: any) => ({ ...c, id: c._id || c.id }))
    setItems(mapped)
    try {
      mapped.forEach((c) => {
        const cid = String(c.id || c._id || '')
        if (!cid) return
        if (appliedRef.current.has(cid)) return
        if (typeof c.start === 'number' && typeof c.end === 'number' && c.start !== c.end) {
          const evt = new CustomEvent('comments:mark', { detail: { start: c.start, end: c.end, commentId: cid } })
          document.dispatchEvent(evt)
          appliedRef.current.add(cid)
        }
      })
    } catch {}
  }
  useEffect(() => { appliedRef.current.clear(); load() }, [noteId])
  useEffect(() => {
    if (selection.start === selection.end) return
    if (selectDebounceRef.current) clearTimeout(selectDebounceRef.current as any)
    selectDebounceRef.current = window.setTimeout(() => { load() }, 250)
  }, [selection.start, selection.end])
  const add = async () => {
    if (!text.trim()) return
    if (selection.start === selection.end) {
      setMessage('请选择文本范围后再添加评论')
      return
    }
    try {
      // 生成稳定的幂等键（同一笔记、同一选区、同一文本在短时间内只创建一次）
      const idemKey = `${noteId}:${selection.start}:${selection.end}:${text.trim()}`
      const created: any = await createComment(noteId, selection.start, selection.end, text.trim(), { idempotencyKey: idemKey })
      setText('')
      await load()
      try {
        const commentId = created?.id || created?._id || `local-${Date.now()}`
        // 保持事件闭环：标记选区 + 广播创建事件（供其他面板联动，如大纲/协作）
        const markEvt = new CustomEvent('comments:mark', { detail: { start: selection.start, end: selection.end, commentId } })
        document.dispatchEvent(markEvt)
        const createdEvt = new CustomEvent('comments:created', { detail: { noteId, start: selection.start, end: selection.end, commentId, idempotencyKey: idemKey } })
        document.dispatchEvent(createdEvt)
      } catch {}
    } catch {}
  }
  const reply = async (cid: string, value: string) => {
    if (!value.trim()) return
    await commentsAPI.reply(cid, value.trim())
    await load()
  }
  const format = (iso?: string) => {
    try { if (!iso) return ''; const d = new Date(iso); const pad=(n:number)=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` } catch { return '' }
  }
  useEffect(() => {
    const onHover = (e: any) => { const id = e?.detail?.id as string | undefined; if (id) setActiveId(id) }
    document.addEventListener('comments:hover', onHover as any)
    return () => { document.removeEventListener('comments:hover', onHover as any) }
  }, [])
  return (
    <div className="space-y-3">
      <div className="font-medium">评论</div>
      <div className="text-xs text-gray-500">当前选区：{selection.start}–{selection.end}</div>
      <div className="flex gap-2">
        <label htmlFor="comment-input" className="sr-only">评论内容</label>
        <Input id="comment-input" aria-label="评论内容" value={text} onChange={e => setText(e.target.value)} placeholder="添加评论" />
        <Button aria-label="提交评论" onClick={add}>提交</Button>
      </div>
      <div aria-live="polite" className="text-xs text-red-600">{message}</div>
      <ul className="space-y-3" aria-label="评论列表" role="list">
        {items.map((c) => {
          const canDelete = String(c.authorId||'') === String(me.id||'')
          const isActive = activeId && (c._id===activeId || c.id===activeId)
          return (
            <li key={c._id || c.id} className="rounded" style={{ border: '1px solid #e5e7eb', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-md)', transition: 'all 300ms ease-in-out', background: isActive ? 'rgba(255,235,59,0.08)' : '#fff' }}>
              <div className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-11 w-11 rounded-full flex items-center justify-center text-xs font-semibold" style={{ background: '#2468F2', color: '#fff' }}>{(c.authorId||'U')[0]?.toUpperCase()}</div>
                  <div className="text-sm font-medium">{c.authorId || '用户'}</div>
                  <div className="text-xs text-gray-500 ml-auto">{format(c.createdAt)}</div>
                </div>
                <div className="mt-2 text-sm">{c.text}</div>
                <div className="mt-2 flex items-center gap-2">
                  <Button aria-label="回复" onClick={() => setActiveId(String(c._id || c.id))}>回复</Button>
                  <Button aria-pressed={Boolean(c.likes)} aria-label="点赞" onClick={() => { setItems(prev => prev.map(x => (x._id===c._id||x.id===c.id) ? { ...x, likes: (x.likes||0)+1 } : x)) }}>赞{c.likes ? `(${c.likes})` : ''}</Button>
                  <Button aria-label="删除评论" onClick={async () => { try { await commentsAPI.delete(c._id || c.id!); await load() } catch (e) {} }} disabled={!canDelete}>删除</Button>
                </div>
                <div className="mt-2 space-y-2">
                  {(c.replies || []).map((r, k) => (
                    <div key={r._id || k} className="ml-6 p-2 rounded" style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 'var(--radius-card)' }}>
                      <div className="flex items-center gap-2">
                        <div className="h-11 w-11 rounded-full flex items-center justify-center text-[10px] font-semibold" style={{ background: '#6b7280', color: '#fff' }}>{(r.authorId||'U')[0]?.toUpperCase()}</div>
                        <div className="text-xs">{r.authorId || '用户'}</div>
                        <div className="text-[11px] text-gray-500 ml-auto">{format(r.createdAt)}</div>
                      </div>
                      <div className="mt-1 text-xs text-gray-700">{r.text}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <Input aria-label="回复内容" placeholder="回复评论"
                    value={replyTexts[String(c._id || c.id)] || ''}
                    onChange={(e) => setReplyTexts(prev => ({ ...prev, [String(c._id || c.id)]: e.target.value }))}
                    onKeyDown={async (e) => { if (e.key==='Enter') { const val = replyTexts[String(c._id||c.id)] || ''; await reply(String(c._id||c.id), val); setReplyTexts(prev => ({ ...prev, [String(c._id || c.id)]: '' })); } }} />
                  <Button aria-label="提交回复" onClick={async () => { const val = replyTexts[String(c._id||c.id)] || ''; await reply(String(c._id||c.id), val); setReplyTexts(prev => ({ ...prev, [String(c._id || c.id)]: '' })); }}>回复</Button>
                </div>
              </div>
            </li>
          )
        })}
        {items.length === 0 && <div className="text-sm text-gray-500">暂无评论</div>}
      </ul>
    </div>
  )
}
