'use client'
import { useEffect, useMemo, useState } from 'react'
import { EditorContent, useEditor, BubbleMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import TextAlign from '@tiptap/extension-text-align'
import Color from '@tiptap/extension-color'
import TextStyle from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import ListItem from '@tiptap/extension-list-item'
import Heading from '@tiptap/extension-heading'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { Button } from '@/components/ui/button'
import { Bold, Italic, Underline as UnderlineIcon, MessageSquare } from 'lucide-react'
import { createComment, commentsAPI } from '@/lib/api'
import CommentMark from './extensions/CommentMark'

type Props = {
  noteId: string
  initialHTML?: string
  onSave: (html: string) => Promise<void>
  user: { id: string; name: string; avatar?: string }
  readOnly?: boolean
  onSelectionChange?: (start: number, end: number) => void
  onContentChange?: (html: string) => void
}

function colorFromString(s: string) {
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash)
  const c = (hash & 0x00ffffff).toString(16).toUpperCase()
  return '#' + '00000'.substring(0, 6 - c.length) + c
}
function hexToRgb(hex: string) {
  const h = hex.replace('#','')
  const bigint = parseInt(h, 16)
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 }
}
function srgb(x: number) {
  x /= 255
  return x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4)
}

export default function TiptapEditor({ noteId, initialHTML, onSave, user, readOnly = false, onSelectionChange, onContentChange }: Props) {
  const ydoc = useMemo(() => new Y.Doc(), [])
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [participants, setParticipants] = useState<Array<{ id: string; name?: string }>>([])
  const [collabEnabled, setCollabEnabled] = useState(true)
  const [localMode, setLocalMode] = useState(false)
  // 基于协同场景的撤销/重做管理器（仅协同启用时使用）
  const undoManager = useMemo(() => {
    try { return new (Y as any).UndoManager(ydoc) } catch { return null }
  }, [ydoc])

  useEffect(() => {
    let p: WebsocketProvider | null = null
    const yws = process.env.NEXT_PUBLIC_YWS_URL
    if (!yws) {
      setLocalMode(true)
      setCollabEnabled(false)
      setProvider(null)
      setConnStatus('disconnected')
      return
    }
    try {
      p = new WebsocketProvider(yws, `note:${noteId}`, ydoc)
      setProvider(p)
      setConnStatus('connecting')
      const statusHandler = (e: any) => {
        const s = e.status as 'connected' | 'disconnected'
        setConnStatus(s)
        try {
          const evt = new CustomEvent('rum', { detail: { type: 'collab', name: 'ws_status', meta: { status: s }, ts: Date.now() } })
          document.dispatchEvent(evt)
        } catch {}
      }
      p.on('status', statusHandler)
      const aw = p.awareness
      const updateAwareness = () => {
        const states = Array.from(aw.getStates().values()) as any[]
        const list = states.map(s => ({ id: s.user?.id || 'unknown', name: s.user?.name }))
        setParticipants(list)
      }
      aw.setLocalStateField('user', { id: user.id, name: user.name })
      aw.on('update', updateAwareness)
      updateAwareness()
      const degradeTimer = setInterval(() => {
        if (p && p.wsconnected === false && p.wsconnecting === false) {
          setLocalMode(true)
          setCollabEnabled(false)
          try {
            const evt = new CustomEvent('rum', { detail: { type: 'collab', name: 'degrade_local', meta: { reason: 'ws_disconnected' }, ts: Date.now() } })
            document.dispatchEvent(evt)
          } catch {}
        }
      }, 5000)
      return () => {
        try { p?.off('status', statusHandler) } catch {}
        try { aw?.off('update', updateAwareness as any) } catch {}
        clearInterval(degradeTimer)
        try { p?.destroy() } catch {}
      }
    } catch {
      setLocalMode(true)
      setCollabEnabled(false)
      setProvider(null)
      setConnStatus('disconnected')
    }
  }, [noteId, ydoc, user.id, user.name])

  const editor = useEditor({
    extensions: [
      // 历史记录：启用；禁用与自定义扩展重复的项
      StarterKit.configure({ history: true, heading: false, listItem: false, horizontalRule: false }),
      Underline,
      Link.configure({ autolink: true, openOnClick: true, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Image.configure({ inline: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      HorizontalRule,
      // 对齐扩展：应用到标题与段落
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
      Highlight,
      Subscript,
      Superscript,
      TaskList,
      TaskItem,
      ListItem,
      Heading,
      Placeholder.configure({ placeholder: '开始写作…' }),
      CommentMark,
      ...(collabEnabled && provider
        ? [
            Collaboration.configure({ document: ydoc }),
            CollaborationCursor.configure({
              provider,
              user,
              render: (u) => {
                const color = colorFromString(u.name || u.id || 'user')
                const el = document.createElement('span')
                el.className = 'rounded px-1 text-xs'
                el.style.backgroundColor = color
                const { r, g, b } = hexToRgb(color)
                const lum = 0.2126*srgb(r)+0.7152*srgb(g)+0.0722*srgb(b)
                el.style.color = lum > 0.5 ? '#111827' : '#FFFFFF'
                el.style.boxShadow = 'inset 0 0 0 1px rgba(0,0,0,0.15)'
                el.textContent = u.name || '用户'
                el.setAttribute('aria-hidden', 'true')
                el.setAttribute('role', 'presentation')
                return el
              },
            }),
          ]
        : []),
    ],
    content: initialHTML || '<p></p>',
    // 使 .ProseMirror 在容器内占满高度，消除底部空白不可点击/不可输入区
    editorProps: { attributes: { class: 'prose prose-sm max-w-none min-h-full outline-none' } },
    // 本地降级时仍保持可编辑（仅关闭协同），避免工具栏操作无效
    editable: !readOnly,
    // 禁用SSR立即渲染，避免hydration mismatch警告
    immediatelyRender: false,
  })

  useEffect(() => {
    if (!editor) return
    const handler = () => {
      const { from, to } = editor.state.selection
      onSelectionChange?.(from, to)
      try { document.dispatchEvent(new CustomEvent('comments:selection', { detail: { noteId, from, to } })) } catch {}
      try {
        const evt = new CustomEvent('rum', { detail: { type: 'collab', name: 'selection_change', meta: { from, to }, ts: Date.now() } })
        document.dispatchEvent(evt)
      } catch {}
    }
    editor.on('selectionUpdate', handler)
    return () => { editor.off('selectionUpdate', handler) }
  }, [editor, onSelectionChange])

  // 内容变化回调，用于右侧大纲同步
  useEffect(() => {
    if (!editor) return
    const updateHandler = () => {
      try { onContentChange?.(editor.getHTML()) } catch {}
    }
    editor.on('update', updateHandler)
    try { onContentChange?.(editor.getHTML()) } catch {}
    return () => { editor.off('update', updateHandler) }
  }, [editor, onContentChange])

  // 悬浮提示：鼠标移入评论标记时在编辑器内显示提示框
  useEffect(() => {
    const card = document.getElementById('editor-card')
    const tip = document.getElementById('comment-tooltip') as HTMLDivElement | null
    if (!card || !tip) return
    const onOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const mark = target?.closest('.comment-mark') as HTMLElement | null
      if (mark) {
        const rect = mark.getBoundingClientRect()
        const cardRect = card.getBoundingClientRect()
        tip.style.left = `${rect.left - cardRect.left + 8}px`
        tip.style.top = `${rect.top - cardRect.top - 28}px`
        tip.style.display = 'block'
        tip.style.opacity = '1'
        try {
          const id = mark.getAttribute('data-comment-id')
          const evt = new CustomEvent('comments:hover', { detail: { id } })
          document.dispatchEvent(evt)
        } catch {}
      } else {
        tip.style.opacity = '0'
        tip.style.display = 'none'
      }
    }
    card.addEventListener('mousemove', onOver)
    card.addEventListener('mouseleave', () => { if (tip) { tip.style.opacity = '0'; tip.style.display = 'none' } })
    return () => {
      card.removeEventListener('mousemove', onOver)
    }
  }, [])

  useEffect(() => {
    if (!editor) return
    const execHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      const cmd = detail.cmd as string
      const payload = detail.payload
      const chain = editor.chain().focus()
      if (cmd === 'bold') chain.toggleBold().run()
      else if (cmd === 'italic') chain.toggleItalic().run()
      else if (cmd === 'underline') chain.toggleUnderline().run()
      else if (cmd === 'heading') chain.toggleHeading({ level: (payload && payload.level) || 2 }).run()
      else if (cmd === 'ol') chain.toggleOrderedList().run()
      else if (cmd === 'ul') chain.toggleBulletList().run()
      else if (cmd === 'blockquote') chain.toggleBlockquote().run()
      else if (cmd === 'code') chain.toggleCode().run()
      else if (cmd === 'hr') chain.setHorizontalRule().run()
      else if (cmd === 'align') chain.setTextAlign((payload && payload.align) || 'left').run()
      else if (cmd === 'color') chain.setColor((payload && payload.color) || '#2563eb').run()
      else if (cmd === 'highlight') chain.toggleHighlight().run()
      else if (cmd === 'sup') chain.toggleSuperscript().run()
      else if (cmd === 'sub') chain.toggleSubscript().run()
      else if (cmd === 'task') chain.toggleTaskList().run()
      else if (cmd === 'link') chain.extendMarkRange('link').setLink({ href: (payload && payload.href) || '#' }).run()
      else if (cmd === 'unlink') chain.extendMarkRange('link').unsetLink().run()
      else if (cmd === 'table') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      else if (cmd === 'image') {
        const src = (payload && payload.src) as string
        if (src) chain.setImage({ src }).run()
      }
      else if (cmd === 'undo') { chain.undo().run() }
      else if (cmd === 'redo') { chain.redo().run() }
      else if (cmd === 'save') { const html = editor.getHTML(); onSave(html) }
    }
    document.addEventListener('tiptap:exec', execHandler as any)
    return () => { document.removeEventListener('tiptap:exec', execHandler as any) }
  }, [editor, onSave])

  useEffect(() => {
    return () => {
      try { provider?.destroy() } catch {}
      try { ydoc?.destroy() } catch {}
    }
  }, [provider, ydoc])

  // 监听评论标记事件，在当前选区范围内应用 CommentMark
  useEffect(() => {
    if (!editor) return
    const handler = (e: any) => {
      try {
        const { start, end, commentId } = (e as CustomEvent).detail || {}
        if (typeof start === 'number' && typeof end === 'number') {
          editor.chain().focus().setTextSelection({ from: start, to: end }).setMark('commentMark', { commentId: commentId || `local-${Date.now()}` }).run()
        }
      } catch {}
    }
    document.addEventListener('comments:mark', handler as any)
    return () => { document.removeEventListener('comments:mark', handler as any) }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const applied = new Set<string>()
    const replayHandler = async (e: any) => {
      const detail = (e as CustomEvent).detail || {}
      if (!detail || detail.noteId !== noteId) return
      const list = await commentsAPI.list(noteId)
      const items = Array.isArray(detail.ids) ? list.filter((c: any) => detail.ids.includes(String(c._id || c.id))) : list
      const ranges = items.filter((c: any) => typeof c.start === 'number' && typeof c.end === 'number' && c.start < c.end).sort((a: any, b: any) => a.start - b.start)
      for (const c of ranges) {
        const cid = String(c._id || c.id || c.commentId)
        if (applied.has(cid)) continue
        editor.chain().focus().setTextSelection({ from: c.start, to: c.end }).setMark('commentMark', { commentId: cid }).run()
        applied.add(cid)
      }
      try { document.dispatchEvent(new CustomEvent('comments:list:update', { detail: { noteId, comments: items } })) } catch {}
    }
    document.addEventListener('comments:replay', replayHandler as any)
    return () => { document.removeEventListener('comments:replay', replayHandler as any) }
  }, [editor, noteId])

  if (!editor) return <div className="p-4 text-sm text-gray-500">编辑器加载中…</div>

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-xs" aria-live="polite" role="status">
          连接状态：<span className={connStatus === 'connected' ? 'text-green-600' : connStatus === 'connecting' ? 'text-yellow-600' : 'text-red-600'}>{connStatus}</span>
          {localMode && <span className="ml-2 text-xs text-gray-500">已本地降级</span>}
          {readOnly && <span className="ml-2 text-xs text-gray-500">只读</span>}
        </div>
        <div className="flex items-center gap-1" role="list" aria-label="在线协作者">
          {participants.map((p, i) => {
            const bg = colorFromString(p.name || p.id)
            const { r, g, b } = hexToRgb(bg)
            const lum = 0.2126*srgb(r)+0.7152*srgb(g)+0.0722*srgb(b)
            const textColor = lum > 0.5 ? '#111827' : '#FFFFFF'
            return (
              <span
                key={i}
                role="listitem"
                className="rounded px-2 py-0.5 text-xs"
                style={{ backgroundColor: bg, color: textColor }}
                aria-label={`协作者：${p.name || p.id}`}
              >
                {p.name || p.id}
              </span>
            )
          })}
          {participants.length === 0 && <span className="text-xs text-gray-400">无在线协作者</span>}
        </div>
        <Button size="sm" variant="outline" onClick={() => { try { provider?.connect() } catch {}; setLocalMode(false); setCollabEnabled(true) }}>重连</Button>
        <Button size="sm" variant="outline" disabled={readOnly || localMode} onClick={async () => { if (readOnly || localMode) return; const html = editor.getHTML(); await onSave(html) }}>保存</Button>
      </div>
      <div
        id="editor-card"
        className="border border-[#e8e8e8] rounded-[2px] p-3 bg-white dark:bg-neutral-800 min-h-[560px] h-[60vh] md:min-h-[640px] md:h-[70vh] focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent"
        // 使容器点击空白区域也可将光标移动到文末，解决下半区域无法输入/无法聚焦的问题
        onMouseDown={(e) => {
          try {
            if (!editor || !editor.isEditable) return
            // 仅在点击容器自身（而非编辑内容或菜单）时触发
            if (e.target === e.currentTarget) {
              e.preventDefault()
              // 聚焦并将选区移动到文档末尾
              const endPos = editor.state.doc.content.size
              editor.chain().focus().setTextSelection(endPos).run()
            }
          } catch {}
        }}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        <BubbleMenu
          editor={editor}
          pluginKey="bubble-menu"
          shouldShow={({ editor: ed, state }) => {
            // 修复：本地降级(localMode)不应屏蔽气泡工具条，仅在只读态隐藏
            if (readOnly) return false
            const { from, to } = state.selection
            return ed.isEditable && ed.isFocused && from !== to
          }}
          tippyOptions={{
            duration: 150,
            appendTo: () => document.body,
          }}
        >
          <div
            className="flex items-center gap-2 justify-start"
            role="toolbar"
            aria-label="文本格式工具"
            style={{ height: 44, paddingLeft: 8, paddingRight: 8, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff' }}
          >
            <Button aria-label="粗体" title="粗体 (Ctrl+B)" size="icon" variant="ghost" disabled={readOnly} onClick={() => editor.chain().focus().toggleBold().run()}>
              <Bold className="w-4 h-4" aria-hidden />
            </Button>
            <Button aria-label="斜体" title="斜体 (Ctrl+I)" size="icon" variant="ghost" disabled={readOnly} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <Italic className="w-4 h-4" aria-hidden />
            </Button>
            <Button aria-label="下划线" title="下划线 (Ctrl+U)" size="icon" variant="ghost" disabled={readOnly} onClick={() => editor.chain().focus().toggleUnderline().run()}>
              <UnderlineIcon className="w-4 h-4" aria-hidden />
            </Button>
            <div aria-hidden className="w-px h-4 bg-gray-200 mx-1" />
            <Button aria-label="添加评论" title="添加评论" size="icon" variant="ghost" disabled={readOnly} onClick={() => {
              try {
                const { from, to } = editor.state.selection
                const openEvt = new CustomEvent('comments:open')
                document.dispatchEvent(openEvt)
                if (from !== to) {
                  const markEvt = new CustomEvent('comments:mark', { detail: { start: from, end: to, commentId: `local-${Date.now()}` } })
                  document.dispatchEvent(markEvt)
                }
              } catch {}
            }}>
              <MessageSquare className="w-4 h-4" aria-hidden />
            </Button>
          </div>
        </BubbleMenu>
        {/* 让 ProseMirror 填满容器高度，点击任意空白处可聚焦 */}
        <EditorContent editor={editor} className="h-full" style={{ flex: 1, minHeight: '100%', height: '100%', padding: 12 }} />
        {/* 悬浮提示容器 */}
        <div id="comment-tooltip" style={{ position: 'absolute', pointerEvents: 'none', display: 'none', padding: '8px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.1)', transition: 'opacity 300ms ease-in-out' }}>已添加评论，打开右侧面板查看</div>
      </div>
    </div>
  )
}
