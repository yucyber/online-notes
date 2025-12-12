'use client'
import { useEffect, useMemo, useState, useRef } from 'react'
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
import FontSize from './extensions/FontSize'
import StatusPill from './extensions/StatusPill'

type Props = {
  noteId: string
  initialHTML?: string
  onSave: (html: string) => Promise<void>
  user: { id: string; name: string; avatar?: string }
  readOnly?: boolean
  onSelectionChange?: (start: number, end: number) => void
  onContentChange?: (html: string) => void
  versionKey?: string
}

function colorFromString(s: string) {
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash)
  const c = (hash & 0x00ffffff).toString(16).toUpperCase()
  return '#' + '00000'.substring(0, 6 - c.length) + c
}
function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  const bigint = parseInt(h, 16)
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 }
}
function srgb(x: number) {
  x /= 255
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

export default function TiptapEditor({ noteId, initialHTML, onSave, user, readOnly = false, onSelectionChange, onContentChange, versionKey }: Props) {
  const ydoc = useMemo(() => new Y.Doc(), [])
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [participants, setParticipants] = useState<Array<{ id: string; name?: string }>>([])
  const participantsCache = useRef<Array<{ id: string; name?: string }>>([])
  const cacheTimeout = useRef<NodeJS.Timeout>()
  const [collabEnabled, setCollabEnabled] = useState(true)
  const [localMode, setLocalMode] = useState(false)
  const [wsDebug, setWsDebug] = useState<{ connecting: boolean; connected: boolean; synced: boolean }>({ connecting: false, connected: false, synced: false })
  const injectBusyRef = useRef(false)
  const lastInjectedHTMLRef = useRef<string>('')
  const migratedOnceRef = useRef(false)
  const onSelectionChangeRef = useRef<typeof onSelectionChange | null>(onSelectionChange)
  const onContentChangeRef = useRef<typeof onContentChange | null>(onContentChange)
  const onSaveRef = useRef<typeof onSave | null>(onSave)

  useEffect(() => { onSelectionChangeRef.current = onSelectionChange }, [onSelectionChange])
  useEffect(() => { onContentChangeRef.current = onContentChange }, [onContentChange])
  useEffect(() => { onSaveRef.current = onSave }, [onSave])
  const suppressSelectionRef = useRef(false)
  const lastSelectionRef = useRef<{ from: number; to: number }>({ from: -1, to: -1 })
  const selectionDebounceRef = useRef<number | null>(null)
  // 基于协同场景的撤销/重做管理器（仅协同启用时使用）
  const undoManager = useMemo(() => {
    try { return new (Y as any).UndoManager(ydoc) } catch { return null }
  }, [ydoc])

  useEffect(() => {
    const yws = process.env.NEXT_PUBLIC_YWS_URL
    // const yws = 'wss://demos.yjs.dev' 
    const room = `note:${String(noteId).toLowerCase()}${versionKey ? `:${versionKey}` : ''}`

    if (!yws) {
      setLocalMode(true)
      setCollabEnabled(false)
      setProvider(null)
      setConnStatus('disconnected')
      return
    }

    let p: WebsocketProvider | null = null
    try {
      console.log('[Collab] Connecting:', { url: yws, room })
      p = new WebsocketProvider(yws, room, ydoc, {
        connect: true,
        maxBackoffTime: 10000,
        disableBc: true,
        // resyncInterval: 5000, // 移除主动重同步，避免与服务器心跳冲突
      })
    } catch (e) {
      console.error('[Collab] Failed to create provider:', e)
      setLocalMode(true)
      return
    }

    setProvider(p)
    setConnStatus('connecting')

    // ✅ 增加连接错误和关闭的详细日志
    p.on('connection-error', (e: any) => {
      console.error('[Collab] Connection error:', e)
    })
    p.on('connection-close', (e: any) => {
      console.warn('[Collab] Connection closed:', e.code, e.reason)
    })

    // ✅ 修正：status 事件直接返回状态字符串，不是事件对象
    const statusHandler = (status: any) => {
      // 兼容处理：y-websocket 有时返回对象 {status: 'connected'}，有时直接返回字符串
      const s = (typeof status === 'object' ? status.status : status) as 'connecting' | 'connected' | 'disconnected'
      setConnStatus(s)
      setWsDebug((prev) => ({
        ...prev,
        connected: s === 'connected',
        connecting: s === 'connecting'
      }))

      if (s === 'connected') {
        setLocalMode(false)
        setCollabEnabled(true)

        // ✅ 重连成功后，重新设置本地用户状态（使用官方原生逻辑）
        const aw = p!.awareness
        aw.setLocalStateField('user', {
          id: user.id,
          name: user.name,
          clientId: aw.clientID,
          timestamp: Date.now()
        })

        // ✅ 恢复缓存的协作者列表
        if (participantsCache.current.length > 0) {
          setParticipants([...participantsCache.current])
        }

        try {
          const evt = new CustomEvent('rum', { detail: { type: 'collab', name: 'ws_status', meta: { status: s }, ts: Date.now() } })
          document.dispatchEvent(evt)
        } catch { }
      }
    }

    p.on('status', statusHandler)

    const syncHandler = (synced: boolean) => {
      console.log('[Collab] Sync status changed:', synced)
      setWsDebug((prev) => ({ ...prev, synced }))
      try {
        const evt = new CustomEvent('rum', { detail: { type: 'collab', name: 'ws_sync', meta: { synced }, ts: Date.now() } })
        document.dispatchEvent(evt)
      } catch { }
    }
    p.on('sync', syncHandler as any)

    // ✅ Debug: 监听 YDoc 更新，确认是否收到数据
    const updateHandler = (update: Uint8Array, origin: any) => {
      console.log('[Collab] YDoc update received:', {
        byteLength: update.byteLength,
        origin: origin?.constructor?.name || origin,
        isLocal: origin === null || origin === p
      })
    }
    ydoc.on('update', updateHandler)

    const aw = p.awareness

    // ✅ 优化的 awareness 更新处理（使用官方原生同步）
    const updateAwareness = () => {
      const entries = Array.from(aw.getStates().entries()) as any[]
      console.log('[Collab] Awareness update:', entries.length, 'entries')
      const byId = new Map<string, { id: string; name?: string }>()
      for (const [clientId, s] of entries) {
        const uid = String(s?.user?.id || s?.user?.name || clientId)
        const name = s?.user?.name
        if (!byId.has(uid)) byId.set(uid, { id: uid, name })
      }
      const newParticipants = Array.from(byId.values())

      // ✅ 更新缓存
      participantsCache.current = newParticipants
      setParticipants(newParticipants)

      // ✅ 清除之前的延迟清空定时器
      if (cacheTimeout.current) {
        clearTimeout(cacheTimeout.current)
      }
    }

    // ✅ 设置初始用户状态
    aw.setLocalStateField('user', {
      id: user.id,
      name: user.name,
      clientId: aw.clientID,
      timestamp: Date.now()
    })

    // ✅ 监听官方原生的 awareness 更新
    aw.on('update', updateAwareness)

    updateAwareness()

    // ✅ 监听 provider 的 destroy 事件（重连时触发）
    const destroyHandler = () => {
      console.log('🔄 Provider destroy event - keeping collaborators cache for 5s')
      // ✅ 5秒后再清空缓存，避免重连时立即消失
      cacheTimeout.current = setTimeout(() => {
        // ✅ 修正：使用全小写 wsconnected (y-websocket 内部属性)
        if ((p as any).wsconnected === false) {
          console.log('⏰ Cache timeout - clearing collaborators')
          participantsCache.current = []
          setParticipants([])
        } else {
          console.log('✅ Reconnected - keeping collaborators')
        }
      }, 5000)
    }
    p.on('destroy', destroyHandler)

    let failCount = 0
    const degradeTimer = setInterval(() => {
      // ✅ 修正：使用全小写 wsconnected 和 wsconnecting
      const disconnected = (p as any).wsconnected === false && (p as any).wsconnecting === false
      setWsDebug({
        connecting: Boolean((p as any).wsconnecting),
        connected: Boolean((p as any).wsconnected),
        synced: Boolean((p as any).synced)
      })
      if (disconnected) {
        failCount++
        if (failCount >= 2) {
          // 暂时注释掉降级逻辑，避免因误判导致断开
          // setLocalMode(true)
          // setCollabEnabled(false)
          console.warn('[Collab] Connection unstable but keeping retry...')
        }
      } else {
        failCount = 0
      }
    }, 5000)

    // ✅ 应用层心跳：每15秒发送一次 Awareness 更新，防止 Nginx/LoadBalancer 因“无数据传输”而切断连接
    const appHeartbeat = setInterval(() => {
      if (p && (p as any).wsconnected) {
        p.awareness.setLocalStateField('lastPing', Date.now())
      }
    }, 15000)

    return () => {
      console.log('[Collab] Disconnecting provider')
      clearInterval(degradeTimer)
      clearInterval(appHeartbeat)
      if (cacheTimeout.current) {
        clearTimeout(cacheTimeout.current)
      }
      p?.off('status', statusHandler)
      p?.off('sync', syncHandler as any)
      p?.off('destroy', destroyHandler)
      ydoc.off('update', updateHandler)
      aw.off('update', updateAwareness)
      p?.destroy()
    }
  }, [noteId, versionKey, ydoc]) // 移除 user.id 和 user.name，避免因用户信息变化导致重连

  // 单独监听用户信息变化并更新 awareness，不触发重连
  useEffect(() => {
    if (provider && provider.awareness) {
      provider.awareness.setLocalStateField('user', {
        id: user.id,
        name: user.name,
        clientId: provider.awareness.clientID,
        timestamp: Date.now()
      })
    }
  }, [user.id, user.name, provider])

  const editor = useEditor({
    extensions: [
      // 协同模式下必须关闭默认 history，避免与 Collaboration 冲突
      StarterKit.configure({ history: false, heading: false, listItem: false, horizontalRule: false }),
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
      FontSize,
      TextStyle,
      StatusPill,
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
            provider: provider as any,
            // 传递color字段
            user: { ...user, color: colorFromString(user.name || user.id || 'user') },
            render: (u) => {
              // 直接使用u.color，减少重复计算
              const color = u.color || colorFromString(u.name || u.id || 'user')
              const el = document.createElement('span')
              el.className = 'rounded px-1 text-xs'
              el.style.backgroundColor = color
              const { r, g, b } = hexToRgb(color)
              const lum = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
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
    content: ((collabEnabled && provider && !versionKey) ? undefined : (initialHTML || '<p></p>')),
    // 使 .ProseMirror 在容器内占满高度，消除底部空白不可点击/不可输入区
    editorProps: { attributes: { class: 'tiptap-content min-h-full outline-none' } },
    // 本地降级时仍保持可编辑（仅关闭协同），避免工具栏操作无效
    editable: !readOnly,
    // 禁用SSR立即渲染，避免hydration mismatch警告
    immediatelyRender: false,
  }, [provider, collabEnabled])

  useEffect(() => {
    if (!editor || migratedOnceRef.current) return
    try {
      const ranges: Array<{ from: number; to: number; label: string }> = []
      editor.state.doc.descendants((node: any, pos: number) => {
        if (node && node.isText && typeof node.text === 'string') {
          const text = node.text as string
          const re = /<span class=\"status-pill\">([\s\S]*?)<\/span>/g
          let m: RegExpExecArray | null
          while ((m = re.exec(text)) != null) {
            const from = pos + (m.index || 0)
            const to = from + (m[0] || '').length
            ranges.push({ from, to, label: String(m[1] || '状态：进行中') })
          }
        }
      })
      ranges.sort((a, b) => b.from - a.from).forEach(r => {
        suppressSelectionRef.current = true
        editor.chain().focus().setTextSelection({ from: r.from, to: r.to }).deleteSelection().insertStatusPill({ label: r.label, variant: 'inprogress' }).run()
        setTimeout(() => { suppressSelectionRef.current = false }, 120)
      })
    } catch { }
    migratedOnceRef.current = true
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const handler = () => {
      if (suppressSelectionRef.current) return
      const { from, to } = editor.state.selection
      if (from === lastSelectionRef.current.from && to === lastSelectionRef.current.to) return
      lastSelectionRef.current = { from, to }
      if (selectionDebounceRef.current) clearTimeout(selectionDebounceRef.current as any)
      selectionDebounceRef.current = window.setTimeout(() => {
        onSelectionChangeRef.current?.(from, to)
        try { document.dispatchEvent(new CustomEvent('comments:selection', { detail: { noteId, from, to } })) } catch { }
        try {
          const evt = new CustomEvent('rum', { detail: { type: 'collab', name: 'selection_change', meta: { from, to }, ts: Date.now() } })
          document.dispatchEvent(evt)
        } catch { }
      }, 150)
    }
    editor.on('selectionUpdate', handler)
    return () => { editor.off('selectionUpdate', handler) }
  }, [editor])

  // 内容变化回调，用于右侧大纲同步
  useEffect(() => {
    if (!editor) return
    const updateHandler = () => {
      try { onContentChangeRef.current?.(editor.getHTML()) } catch { }
    }
    editor.on('update', updateHandler)
    try { onContentChangeRef.current?.(editor.getHTML()) } catch { }
    return () => { editor.off('update', updateHandler) }
  }, [editor])

  // ✅ 修复：当连接成功且服务器文档为空时，使用 initialHTML 初始化
  useEffect(() => {
    if (wsDebug.synced && editor && initialHTML && initialHTML !== '<p></p>') {
      // 延迟检查，确保 Yjs 同步完成（如果 Yjs 覆盖了内容导致为空，这里可以检测到）
      const timer = setTimeout(() => {
        // 检查编辑器是否为空（只有默认段落）
        if (editor.isEmpty) {
          console.log('[Collab] Server document seems empty, seeding from initialHTML')
          // 使用 setContent 初始化，这会触发 Yjs 更新并同步到服务器
          editor.commands.setContent(initialHTML)
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [wsDebug.synced, editor, initialHTML])

  useEffect(() => {
    if (!editor) return
    const setHandler = (e: Event) => {
      try {
        const html = (e as CustomEvent).detail?.html as string
        if (typeof html === 'string') {
          if (injectBusyRef.current) return
          const normalized = String(html || '').trim()
          const current = String(editor.getHTML() || '').trim()
          if (normalized === current || normalized === lastInjectedHTMLRef.current) return
          const p = provider
          const safe = sanitizeHTML(html || '<p></p>')
          const apply = () => {
            injectBusyRef.current = true
            suppressSelectionRef.current = true
            if (collabEnabled && p) {
              try {
                const frag = ydoc.getXmlFragment('prosemirror') as any
                ydoc.transact(() => { if (frag && typeof frag.length === 'number') frag.delete(0, frag.length) })
              } catch { }
            }
            editor.commands.setContent(safe || '<p></p>', false)
            lastInjectedHTMLRef.current = String(safe || '')
            try {
              const ranges: Array<{ from: number; to: number; label: string }> = []
              editor.state.doc.descendants((node: any, pos: number) => {
                if (node && node.isText && typeof node.text === 'string') {
                  const text = node.text as string
                  const re = /<span class=\"status-pill\">([\s\S]*?)<\/span>/g
                  let m: RegExpExecArray | null
                  while ((m = re.exec(text)) != null) {
                    const from = pos + (m.index || 0)
                    const to = from + (m[0] || '').length
                    ranges.push({ from, to, label: String(m[1] || '状态：进行中') })
                  }
                }
              })
              ranges.sort((a, b) => b.from - a.from).forEach(r => {
                editor.chain().focus().setTextSelection({ from: r.from, to: r.to }).deleteSelection().insertStatusPill({ label: r.label, variant: 'inprogress' }).run()
              })
            } catch { }
            setTimeout(() => { suppressSelectionRef.current = false; injectBusyRef.current = false }, 120)
          }
          if (p && !(p as any).synced) {
            const once = (synced: boolean) => { if (synced) { try { apply() } finally { try { (p as any).off('sync', once) } catch { } } } }
            try { (p as any).on('sync', once) } catch { /* ignore */ }
            // 超时兜底：若 800ms 内仍未完成首次同步，则直接应用本地内容，避免编辑区空白
            setTimeout(() => {
              try {
                const synced = Boolean((p as any).synced)
                const wsconnected = Boolean((p as any).wsconnected)
                if (!synced || !wsconnected) apply()
              } catch { apply() }
            }, 800)
          } else {
            apply()
          }
        }
      } catch { }
    }
    document.addEventListener('editor:setContent', setHandler as any)
    return () => { document.removeEventListener('editor:setContent', setHandler as any) }
  }, [editor, provider, collabEnabled, ydoc])

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
        } catch { }
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
      else if (cmd === 'link') {
        const href = String((payload && payload.href) || '#')
        const text = typeof payload?.text === 'string' ? payload.text : ''
        const hasSelection = !editor.state.selection.empty
        if (hasSelection) {
          chain.extendMarkRange('link').setLink({ href }).run()
        } else {
          chain.insertContent({
            type: 'text',
            text: text || href,
            marks: [{ type: 'link', attrs: { href } }],
          }).run()
        }
      }
      else if (cmd === 'unlink') chain.extendMarkRange('link').unsetLink().run()
      else if (cmd === 'table') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      else if (cmd === 'image') {
        const src = (payload && payload.src) as string
        if (src) chain.setImage({ src }).run()
      }
      else if (cmd === 'fontSize') {
        const size = String((payload && payload.size) || '15px')
        chain.setMark('textStyle', { fontSize: size }).run()
      }
      else if (cmd === 'paragraph') { chain.setParagraph().run() }
      else if (cmd === 'embedPlaceholder') {
        const type = String((payload && payload.type) || 'embed')
        const label = String((payload && payload.label) || `占位：${type}`)
        chain.insertContent(`<div class=\"embed-placeholder\" data-type=\"${type}\">${label}</div>`).run()
      }
      else if (cmd === 'status') {
        const text = String((payload && payload.text) || '状态：进行中')
        chain.insertStatusPill({ label: text, variant: 'inprogress' })
      }
      else if (cmd === 'undo') { chain.undo().run() }
      else if (cmd === 'redo') { chain.redo().run() }
      else if (cmd === 'save') {
        console.log('[Editor] Save triggered via toolbar')
        const html = editor.getHTML();
        onSaveRef.current?.(html)
      }
    }
    document.addEventListener('tiptap:exec', execHandler as any)
    return () => { document.removeEventListener('tiptap:exec', execHandler as any) }
  }, [editor])

  useEffect(() => {
    return () => {
      try {
        if (process.env.NODE_ENV === 'production') {
          provider?.destroy()
          ydoc?.destroy()
        } else {
          ; (provider as any)?.disconnect?.()
        }
      } catch { }
    }
  }, [provider, ydoc])

  // 监听评论标记事件，在当前选区范围内应用 CommentMark
  useEffect(() => {
    if (!editor) return
    const handler = (e: any) => {
      try {
        const { start, end, commentId } = (e as CustomEvent).detail || {}
        if (typeof start === 'number' && typeof end === 'number') {
          suppressSelectionRef.current = true
          editor.chain().focus().setTextSelection({ from: start, to: end }).setMark('commentMark', { commentId: commentId || `local-${Date.now()}` }).run()
          setTimeout(() => { suppressSelectionRef.current = false }, 120)
        }
      } catch { }
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
        suppressSelectionRef.current = true
        editor.chain().focus().setTextSelection({ from: c.start, to: c.end }).setMark('commentMark', { commentId: cid }).run()
        setTimeout(() => { suppressSelectionRef.current = false }, 120)
        applied.add(cid)
      }
      try { document.dispatchEvent(new CustomEvent('comments:list:update', { detail: { noteId, comments: items } })) } catch { }
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
          <span className="ml-2 text-[11px] text-gray-500">ws[{wsDebug.connected ? 'on' : wsDebug.connecting ? 'dial' : 'off'}] sync[{wsDebug.synced ? 'ok' : '…'}]</span>
          {localMode && <span className="ml-2 text-xs text-gray-500">已本地降级</span>}
          {readOnly && <span className="ml-2 text-xs text-gray-500">只读</span>}
        </div>
        <div className="flex items-center gap-1" role="list" aria-label="在线协作者">
          {participants.map((p, i) => {
            const bg = colorFromString(p.name || p.id)
            const { r, g, b } = hexToRgb(bg)
            const lum = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
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
        <Button size="sm" variant="outline" onClick={() => { try { provider?.connect() } catch { }; setLocalMode(false); setCollabEnabled(true) }}>重连</Button>
        <Button size="sm" variant="outline" disabled={readOnly || localMode} onClick={async () => { if (readOnly || localMode) return; const html = editor.getHTML(); await onSave(html) }}>保存</Button>
      </div>
      <div
        id="editor-card"
        className="border rounded-[8px] p-3 min-h-[560px] h-[60vh] md:min-h-[640px] md:h-[70vh] focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent"
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
          } catch { }
        }}
        style={{ position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--surface-1)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)' }}
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
            style={{ height: 44, paddingLeft: 8, paddingRight: 8, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-1)' }}
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
            <div aria-hidden className="w-px h-4 mx-1" style={{ background: 'var(--border)' }} />
            <Button aria-label="添加评论" title="添加评论" size="icon" variant="ghost" disabled={readOnly} onClick={() => {
              try {
                const { from, to } = editor.state.selection
                const openEvt = new CustomEvent('comments:open')
                document.dispatchEvent(openEvt)
                if (from !== to) {
                  const markEvt = new CustomEvent('comments:mark', { detail: { start: from, end: to, commentId: `local-${Date.now()}` } })
                  document.dispatchEvent(markEvt)
                }
              } catch { }
            }}>
              <MessageSquare className="w-4 h-4" aria-hidden />
            </Button>
          </div>
        </BubbleMenu>
        {/* 让 ProseMirror 填满容器高度，点击任意空白处可聚焦 */}
        <EditorContent editor={editor} className="h-full tiptap-content" style={{ flex: 1, minHeight: '100%', height: '100%', padding: 12, background: 'var(--surface-1)', color: 'var(--on-surface)' }} />
        {/* 悬浮提示容器 */}
        <div id="comment-tooltip" style={{ position: 'absolute', pointerEvents: 'none', display: 'none', padding: '8px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.1)', transition: 'opacity 300ms ease-in-out' }}>已添加评论，打开右侧面板查看</div>
      </div>
    </div>
  )
}
const sanitizeHTML = (html: string) => {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const dangerousTags = ['style', 'script', 'link', 'meta', 'title', 'iframe', 'object', 'embed']
    dangerousTags.forEach(tag => Array.from(doc.getElementsByTagName(tag)).forEach(el => el.remove()))
    const all = doc.body.querySelectorAll('*')
    all.forEach(el => {
      // 修复：只移除危险的style属性，保留协作光标（collaboration-cursor）的style
      const className = el.getAttribute('class') || ''
      if (!className.includes('collaboration-cursor') && !className.includes('rounded')) {
        el.removeAttribute('style')
      }
      Array.from(el.attributes).forEach(attr => {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on')) el.removeAttribute(attr.name)
      })
    })
    const cleaned = doc.body.innerHTML || ''
    const looksPlain = !/[<][a-zA-Z]/.test(cleaned)
    if (looksPlain) {
      const text = doc.body.textContent || ''
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<p>${escaped}</p>`
    }
    return cleaned
  } catch { return html }
}