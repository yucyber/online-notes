import { useEffect } from 'react'
import { commentsAPI } from '@/lib/api'

type Props = {
  editor: any
  noteId: string
  suppressSelectionRef: React.MutableRefObject<boolean>
  readOnly: boolean
  readOnlyRef: React.MutableRefObject<boolean>
}

export function useTiptapCommentMarks({ editor, noteId, suppressSelectionRef, readOnly, readOnlyRef }: Props) {
  useEffect(() => {
    if (!editor || readOnly) return
    const handler = (event: any) => {
      try {
        if (readOnlyRef.current) return
        const detail = (event as CustomEvent).detail || {}
        // 支持批量 { marks: [...] } 与旧单条 { start, end, commentId } 两种格式。
        const marks: Array<{ start: number; end: number; commentId: string }> = Array.isArray(detail.marks)
          ? detail.marks
          : (typeof detail.start === 'number' && typeof detail.end === 'number' && detail.commentId
            ? [{ start: detail.start, end: detail.end, commentId: detail.commentId }]
            : [])
        if (marks.length === 0) return
        const markType = editor.schema?.marks?.commentMark
        const docSize = editor.state?.doc?.content?.size
        if (!markType || typeof docSize !== 'number') return
        // 直接构造单个 transaction 批量应用 mark，不移动光标、不滚动、不夺焦，
        // 避免恢复已有评论时正文被跳到第一条评论的位置，同时减少 dispatch 次数。
        suppressSelectionRef.current = true
        let tr = editor.state.tr
        for (const m of marks) {
          if (m.start < 0 || m.end > docSize || m.start >= m.end) continue
          tr = tr.addMark(m.start, m.end, markType.create({ commentId: m.commentId }))
        }
        editor.view.dispatch(tr)
        setTimeout(() => { suppressSelectionRef.current = false }, 120)
      } catch { }
    }
    document.addEventListener('comments:mark', handler as any)
    return () => { document.removeEventListener('comments:mark', handler as any) }
  }, [editor, suppressSelectionRef, readOnly, readOnlyRef])

  useEffect(() => {
    if (!editor || readOnly) return
    const applied = new Set<string>()
    const replayHandler = async (event: any) => {
      if (readOnlyRef.current) return
      const detail = (event as CustomEvent).detail || {}
      if (!detail || detail.noteId !== noteId) return
      let list: any[]
      try {
        list = await commentsAPI.list(noteId)
      } catch {
        return
      }
      if (readOnlyRef.current) return
      const items = Array.isArray(detail.ids) ? list.filter((comment: any) => detail.ids.includes(String(comment._id || comment.id))) : list
      const ranges = items
        .filter((comment: any) => typeof comment.start === 'number' && typeof comment.end === 'number' && comment.start < comment.end)
        .sort((a: any, b: any) => a.start - b.start)
      const markType = editor.schema.marks.commentMark
      for (const comment of ranges) {
        if (readOnlyRef.current) return
        const commentId = String(comment._id || comment.id || comment.commentId)
        if (applied.has(commentId)) continue
        const from = comment.start
        const to = comment.end
        if (from < 0 || to > editor.state.doc.content.size || from >= to || !markType) continue
        suppressSelectionRef.current = true
        // 直接通过 transaction 应用评论 mark，不移动光标、不滚动视图，
        // 避免打开全部评论面板时正文被自动滚动到第一条评论的位置。
        const tr = editor.state.tr.addMark(from, to, markType.create({ commentId }))
        editor.view.dispatch(tr)
        setTimeout(() => { suppressSelectionRef.current = false }, 120)
        applied.add(commentId)
      }
      try { document.dispatchEvent(new CustomEvent('comments:list:update', { detail: { noteId, comments: items } })) } catch { }
    }
    document.addEventListener('comments:replay', replayHandler as any)
    // 权限解析期间面板可能已发出并记住 replay；转为可写时主动恢复，避免当前会话永久缺少 mark。
    void replayHandler(new CustomEvent('comments:replay', { detail: { noteId } }))
    return () => { document.removeEventListener('comments:replay', replayHandler as any) }
  }, [editor, noteId, suppressSelectionRef, readOnly, readOnlyRef])
}
