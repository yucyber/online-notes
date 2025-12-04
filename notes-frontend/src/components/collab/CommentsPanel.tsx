import { useEffect, useState } from 'react'
import { listComments, createComment, replyComment, commentsAPI } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function CommentsPanel({ noteId, selection }: { noteId: string; selection: { start: number; end: number } }) {
  const [items, setItems] = useState<any[]>([])
  const [text, setText] = useState('')
  const load = async () => { const r = await listComments(noteId); setItems(r || []) }
  useEffect(() => { load() }, [noteId])
  const add = async () => {
    if (!text.trim()) return
    await createComment(noteId, selection.start, selection.end, text.trim())
    setText('')
    await load()
  }
  return (
    <div className="space-y-3">
      <div className="font-medium">评论</div>
      <div className="text-xs text-gray-500">当前选区：{selection.start}–{selection.end}</div>
      <div className="flex gap-2">
        <Input value={text} onChange={e => setText(e.target.value)} placeholder="添加评论" />
        <Button onClick={add}>提交</Button>
      </div>
      <ul className="space-y-2" aria-label="评论列表" role="list">
        {items.map((c, i) => (
          <li key={c.id || i} className="border rounded px-3 py-2">
            <div className="text-xs text-gray-500">选区 {c.start}–{c.end}</div>
            <div className="text-sm">{c.text}</div>
            <div className="mt-2 flex items-center gap-2">
              <button
                className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-700 hover:bg-red-50 hover:text-red-600"
                aria-label="删除评论"
                onClick={async () => { try { await commentsAPI.delete(c._id || c.id); await load() } catch (e) {} }}
                style={{ minHeight: 32 }}
              >删除</button>
            </div>
            {(c.replies || []).map((r: any, k: number) => (
              <div key={k} className="ml-4 text-xs text-gray-600">↳ {r.text}</div>
            ))}
          </li>
        ))}
        {items.length === 0 && <div className="text-sm text-gray-500">暂无评论</div>}
      </ul>
    </div>
  )
}
