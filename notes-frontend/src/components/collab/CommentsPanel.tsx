import { useEffect, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { listComments, createComment, commentsAPI } from '@/lib/api'
import { buildCommentIdempotencyKey } from '@/lib/comments-key'

type Author = { id: string; name?: string; email?: string }
type Reply = { _id?: string; authorId?: string; author?: Author; text: string; createdAt?: string }
type CommentItem = { _id?: string; id?: string; start: number; end: number; text: string; authorId?: string; author?: Author; createdAt?: string; replies?: Reply[]; likes?: number }
// overview：全部评论浏览模式（右上角按钮）；selection：当前选区评论模式（划词触发）
type Props = { noteId: string; selection: { start: number; end: number }; readOnly?: boolean; mode?: 'overview' | 'selection'; onLocate?: (commentId: string) => void }

function initials(authorId?: string) {
  return (authorId || 'U').charAt(0).toUpperCase()
}

// 优先展示显示名称；其次 email 本地部分；最后才用 authorId 兜底，避免泄露完整 ID。
function authorLabel(author?: Author | null, fallbackId?: string): string {
  const name = author?.name?.trim()
  if (name) return name
  const email = author?.email?.trim()
  if (email) {
    const local = email.split('@')[0]
    if (local) return local
  }
  if (fallbackId) {
    // ID 太长只取尾部 6 字符，避免溢出评论卡片宽度
    const id = String(fallbackId)
    return id.length > 8 ? `用户 ${id.slice(-6)}` : `用户 ${id}`
  }
  return '用户'
}

function authorInitial(author?: Author | null, fallbackId?: string): string {
  const name = author?.name?.trim()
  if (name) return name.charAt(0).toUpperCase()
  const email = author?.email?.trim()
  if (email) return email.charAt(0).toUpperCase()
  return initials(fallbackId)
}

export function CommentsPanel({ noteId, selection, readOnly = false, mode = 'selection', onLocate }: Props) {
  const [items, setItems] = useState<CommentItem[]>([])
  const [text, setText] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  // 惰性初始化：只在首次渲染读取一次 localStorage，避免每次渲染重复访问。
  const [me] = useState(() => ({ id: (typeof localStorage !== 'undefined' ? String(localStorage.getItem('notes_user_id') || '') : ''), name: '我' }))
  const appliedRef = useRef<Set<string>>(new Set())
  const selectDebounceRef = useRef<number | null>(null)
  const load = async () => {
    // overview 模式加载全部评论，selection 模式按选区交集加载。
    const hasRange = mode === 'selection' && typeof selection.start === 'number' && typeof selection.end === 'number'
    const r = hasRange ? await commentsAPI.list(noteId, { start: selection.start, end: selection.end, intersects: true, limit: 50 }) : await listComments(noteId)
    const mapped = (r || []).map((c: any) => ({ ...c, id: c._id || c.id }))
    setItems(mapped)
    // 批量派发一次 marks 事件，让 mark 应用合并到单个 transaction，避免 N 条评论触发 N 次 dispatch。
    const marks = mapped
      .filter((c) => {
        const cid = String(c.id || c._id || '')
        if (!cid || appliedRef.current.has(cid)) return false
        return typeof c.start === 'number' && typeof c.end === 'number' && c.start !== c.end
      })
      .map((c) => ({ start: c.start, end: c.end, commentId: String(c.id || c._id) }))
    if (marks.length > 0) {
      try {
        document.dispatchEvent(new CustomEvent('comments:mark', { detail: { marks } }))
      } catch {}
      marks.forEach((m) => appliedRef.current.add(m.commentId))
    }
  }
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => { appliedRef.current.clear(); void loadRef.current() }, [noteId, mode])
  useEffect(() => {
    // overview 模式展示全部评论，选区变化不触发重新加载。
    if (mode !== 'selection') return
    if (selection.start === selection.end) return
    if (selectDebounceRef.current) clearTimeout(selectDebounceRef.current as any)
    selectDebounceRef.current = window.setTimeout(() => { void loadRef.current() }, 250)
  }, [mode, selection.start, selection.end])
  const add = async () => {
    if (readOnly) return
    if (!text.trim()) return
    if (selection.start === selection.end) {
      setMessage('请先划选正文，再添加评论')
      return
    }
    try {
      // 生成稳定的幂等键（同一笔记、同一选区、同一文本在短时间内只创建一次）。
      // 用 SHA-1 编码，避免含冒号/中文的原始拼接触发后端 400。
      const idemKey = await buildCommentIdempotencyKey(noteId, selection.start, selection.end, text.trim())
      const created: any = await createComment(noteId, selection.start, selection.end, text.trim(), { idempotencyKey: idemKey })
      setText('')
      await load()
      try {
        const commentId = created?.id || created?._id
        if (!commentId) return
        // 只有服务端确认的评论才允许落下持久标记，取消或失败不会污染正文。
        document.dispatchEvent(new CustomEvent('comments:mark', { detail: { marks: [{ start: selection.start, end: selection.end, commentId }] } }))
        const createdEvt = new CustomEvent('comments:created', { detail: { noteId, start: selection.start, end: selection.end, commentId, idempotencyKey: idemKey } })
        document.dispatchEvent(createdEvt)
      } catch {}
    } catch {}
  }
  const reply = async (cid: string, value: string) => {
    if (readOnly) return
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
    <div className="comments-panel">
      {mode === 'selection' && (
        <>
          <div className="comments-panel__compose">
            <label className="collab-invite-field" htmlFor="comment-input">
              <MessageSquare aria-hidden="true" />
              <span className="sr-only">评论内容</span>
              <input
                id="comment-input"
                aria-label="评论内容"
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="添加评论"
                disabled={readOnly}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add() } }}
              />
            </label>
            <button type="button" className="collab-button collab-button--primary" onClick={add} disabled={readOnly || !text.trim()}>提交</button>
          </div>
          <div aria-live="polite" className="comments-panel__error">{message}</div>
        </>
      )}
      <ul className="comments-panel__list" aria-label="评论列表" role="list">
        {items.map((c) => {
          const cid = String(c._id || c.id)
          const canDelete = String(c.authorId||'') === String(me.id||'')
          const isActive = activeId && (c._id===activeId || c.id===activeId)
          const clickable = mode === 'overview' && typeof c.start === 'number' && typeof c.end === 'number'
          return (
            <li
              key={c._id || c.id}
              className="comments-item"
              data-active={isActive}
              data-clickable={clickable}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={clickable ? '定位到评论对应正文' : undefined}
              onClick={clickable ? () => onLocate?.(cid) : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLocate?.(cid) } } : undefined}
            >
              <div className="comments-item__head">
                <div className="comments-avatar">{authorInitial(c.author, c.authorId)}</div>
                <div className="comments-item__author">{authorLabel(c.author, c.authorId)}</div>
                <div className="comments-item__time">{format(c.createdAt)}</div>
              </div>
              <div className="comments-item__text">{c.text}</div>
              <div className="comments-item__actions">
                <button type="button" className="comments-action" aria-label="回复" onClick={() => { if (readOnly) return; setActiveId(cid) }} disabled={readOnly}>回复</button>
                <button type="button" className="comments-action" aria-pressed={Boolean(c.likes)} aria-label="点赞" onClick={() => { if (readOnly) return; setItems(prev => prev.map(x => (x._id===c._id||x.id===c.id) ? { ...x, likes: (x.likes||0)+1 } : x)) }} disabled={readOnly}>赞{c.likes ? `(${c.likes})` : ''}</button>
                <button type="button" className="comments-action comments-action--danger" aria-label="删除评论" onClick={async () => { if (readOnly) return; try { await commentsAPI.delete(cid); await load() } catch {} }} disabled={readOnly || !canDelete}>删除</button>
              </div>
              {(c.replies || []).length > 0 && (
                <div className="comments-item__replies">
                  {(c.replies || []).map((r, k) => (
                    <div key={r._id || k} className="comments-reply">
                      <div className="comments-item__head">
                        <div className="comments-avatar comments-avatar--reply">{authorInitial(r.author, r.authorId)}</div>
                        <div className="comments-item__author">{authorLabel(r.author, r.authorId)}</div>
                        <div className="comments-item__time">{format(r.createdAt)}</div>
                      </div>
                      <div className="comments-item__text">{r.text}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="comments-item__reply-form">
                <label className="collab-invite-field collab-invite-field--reply" htmlFor={`reply-input-${cid}`}>
                  <span className="sr-only">回复内容</span>
                  <input
                    id={`reply-input-${cid}`}
                    aria-label="回复内容"
                    placeholder="回复评论"
                    value={replyTexts[cid] || ''}
                    disabled={readOnly}
                    onChange={(e) => setReplyTexts(prev => ({ ...prev, [cid]: e.target.value }))}
                    onKeyDown={async (e) => { if (e.key==='Enter') { e.preventDefault(); if (readOnly) return; const val = replyTexts[cid] || ''; await reply(cid, val); setReplyTexts(prev => ({ ...prev, [cid]: '' })) } }}
                  />
                </label>
                <button type="button" className="collab-button" disabled={readOnly} onClick={async () => { if (readOnly) return; const val = replyTexts[cid] || ''; await reply(cid, val); setReplyTexts(prev => ({ ...prev, [cid]: '' })) }}>回复</button>
              </div>
            </li>
          )
        })}
        {items.length === 0 && <li className="comments-panel__empty">暂无评论</li>}
      </ul>
    </div>
  )
}
