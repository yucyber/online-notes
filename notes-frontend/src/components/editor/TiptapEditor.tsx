'use client'
import { useEffect, useMemo, useState } from 'react'
import { EditorContent, useEditor, BubbleMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { Button } from '@/components/ui/button'
import { createComment } from '@/lib/api'
import CommentMark from './extensions/CommentMark'

type Props = {
  noteId: string
  initialHTML?: string
  onSave: (html: string) => Promise<void>
  user: { id: string; name: string; avatar?: string }
  readOnly?: boolean
  onSelectionChange?: (start: number, end: number) => void
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

export default function TiptapEditor({ noteId, initialHTML, onSave, user, readOnly = false, onSelectionChange }: Props) {
  const ydoc = useMemo(() => new Y.Doc(), [])
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [participants, setParticipants] = useState<Array<{ id: string; name?: string }>>([])
  const [collabEnabled, setCollabEnabled] = useState(true)
  const [localMode, setLocalMode] = useState(false)

  useEffect(() => {
    let p: WebsocketProvider | null = null
    try {
      p = new WebsocketProvider('wss://demos.yjs.dev', `note:${noteId}`, ydoc)
      setProvider(p)
      setConnStatus('connecting')
      const statusHandler = (e: any) => {
        const s = e.status as 'connected' | 'disconnected'
        setConnStatus(s)
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
      StarterKit.configure({ history: false }),
      Underline,
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
                return el
              },
            }),
          ]
        : []),
    ],
    content: initialHTML || '<p></p>',
    editorProps: { attributes: { class: 'prose prose-sm max-w-none' } },
    editable: !readOnly && !localMode,
  })

  useEffect(() => {
    if (!editor) return
    const handler = () => {
      const { from, to } = editor.state.selection
      onSelectionChange?.(from, to)
    }
    editor.on('selectionUpdate', handler)
    return () => { editor.off('selectionUpdate', handler) }
  }, [editor, onSelectionChange])

  useEffect(() => {
    return () => {
      try { provider?.destroy() } catch {}
      try { ydoc?.destroy() } catch {}
    }
  }, [provider, ydoc])

  if (!editor) return <div className="p-4 text-sm text-gray-500">编辑器加载中…</div>

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-xs" aria-live="polite" role="status">
          连接状态：<span className={connStatus === 'connected' ? 'text-green-600' : connStatus === 'connecting' ? 'text-yellow-600' : 'text-red-600'}>{connStatus}</span>
          {localMode && <span className="ml-2 text-xs text-gray-500">已本地降级</span>}
          {readOnly && <span className="ml-2 text-xs text-gray-500">只读</span>}
        </div>
        <div className="flex items-center gap-1">
          {participants.map((p, i) => (
            <span key={i} className="rounded px-2 py-0.5 text-xs text-white" style={{ backgroundColor: colorFromString(p.name || p.id) }}>{p.name || p.id}</span>
          ))}
          {participants.length === 0 && <span className="text-xs text-gray-400">无在线协作者</span>}
        </div>
        <Button size="sm" variant="outline" onClick={() => { try { provider?.connect() } catch {}; setLocalMode(false); setCollabEnabled(true) }}>重连</Button>
        <Button size="sm" variant="outline" disabled={readOnly || localMode} onClick={async () => { if (readOnly || localMode) return; const html = editor.getHTML(); await onSave(html) }}>保存</Button>
      </div>
      <div className="border rounded-md p-3 min-h-[300px]">
        <BubbleMenu
          editor={editor}
          pluginKey="bubble-menu"
          shouldShow={({ editor: ed, state }) => {
            if (readOnly || localMode) return false
            const { from, to } = state.selection
            return ed.isEditable && ed.isFocused && from !== to
          }}
          tippyOptions={{
            duration: 150,
            appendTo: () => document.body,
          }}
        >
          <div className="flex items-center gap-2 bg-white/90 border rounded px-2 py-1" role="toolbar" aria-label="文本格式工具">
            <Button aria-label="粗体 (Ctrl+B)" size="sm" variant="ghost" disabled={readOnly || localMode} onClick={() => editor.chain().focus().toggleBold().run()}>粗体</Button>
            <Button aria-label="斜体 (Ctrl+I)" size="sm" variant="ghost" disabled={readOnly || localMode} onClick={() => editor.chain().focus().toggleItalic().run()}>斜体</Button>
            <Button aria-label="下划线 (Ctrl+U)" size="sm" variant="ghost" disabled={readOnly || localMode} onClick={() => editor.chain().focus().toggleUnderline().run()}>下划线</Button>
            <Button size="sm" variant="ghost" disabled={readOnly || localMode} onClick={async () => {
              const { from, to } = editor.state.selection
              if (from === to) return
              const text = window.prompt('添加评论内容') || ''
              if (!text.trim()) return
              try {
                const created: any = await createComment(noteId, from, to, text.trim())
                const commentId = created?.id || `local-${Date.now()}`
                editor.chain().focus().setMark('commentMark', { commentId }).run()
              } catch {
                const commentId = `local-${Date.now()}`
                editor.chain().focus().setMark('commentMark', { commentId }).run()
              }
            }} aria-label="添加评论">添加评论</Button>
          </div>
        </BubbleMenu>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
