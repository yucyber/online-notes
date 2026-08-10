import { useEffect } from 'react'
import { commentsAPI } from '@/lib/api'

type Props = {
  editor: any
  noteId: string
  suppressSelectionRef: React.MutableRefObject<boolean>
}

export function useTiptapCommentMarks({ editor, noteId, suppressSelectionRef }: Props) {
  useEffect(() => {
    if (!editor) return
    const handler = (event: any) => {
      try {
        const { start, end, commentId } = (event as CustomEvent).detail || {}
        if (typeof start === 'number' && typeof end === 'number') {
          // 程序化 setTextSelection 会触发 onSelectionChange；suppressSelectionRef 在短暂窗口内阻断它，
          // 避免虚假的新建评论事件。
          suppressSelectionRef.current = true
          editor.chain().focus().setTextSelection({ from: start, to: end }).setMark('commentMark', { commentId: commentId || `local-${Date.now()}` }).run()
          setTimeout(() => { suppressSelectionRef.current = false }, 120)
        }
      } catch { }
    }
    document.addEventListener('comments:mark', handler as any)
    return () => { document.removeEventListener('comments:mark', handler as any) }
  }, [editor, suppressSelectionRef])

  useEffect(() => {
    if (!editor) return
    const applied = new Set<string>()
    const replayHandler = async (event: any) => {
      const detail = (event as CustomEvent).detail || {}
      if (!detail || detail.noteId !== noteId) return
      const list = await commentsAPI.list(noteId)
      const items = Array.isArray(detail.ids) ? list.filter((comment: any) => detail.ids.includes(String(comment._id || comment.id))) : list
      const ranges = items
        .filter((comment: any) => typeof comment.start === 'number' && typeof comment.end === 'number' && comment.start < comment.end)
        .sort((a: any, b: any) => a.start - b.start)
      for (const comment of ranges) {
        const commentId = String(comment._id || comment.id || comment.commentId)
        if (applied.has(commentId)) continue
        suppressSelectionRef.current = true
        editor.chain().focus().setTextSelection({ from: comment.start, to: comment.end }).setMark('commentMark', { commentId }).run()
        setTimeout(() => { suppressSelectionRef.current = false }, 120)
        applied.add(commentId)
      }
      try { document.dispatchEvent(new CustomEvent('comments:list:update', { detail: { noteId, comments: items } })) } catch { }
    }
    document.addEventListener('comments:replay', replayHandler as any)
    return () => { document.removeEventListener('comments:replay', replayHandler as any) }
  }, [editor, noteId, suppressSelectionRef])
}
