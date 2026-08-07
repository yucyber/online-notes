'use client'
import { useEffect, useMemo, useState, useRef } from 'react'
import { EditorContent, useEditor, BubbleMenu, FloatingMenu } from '@tiptap/react'
import * as Y from 'yjs'
import { Button } from '@/components/ui/button'
import { Bold, Italic, Underline as UnderlineIcon, MessageSquare } from 'lucide-react'
import { createTiptapExtensions } from './tiptap-extensions'
import { COLLAB_STATUS_META, colorFromString, hexToRgb, sanitizeHTML, srgb } from './tiptap-utils'
import { useTiptapCollab } from './useTiptapCollab'
import { useTiptapPersistence } from './useTiptapPersistence'
import { useTiptapEditorBridge } from './useTiptapEditorBridge'
import { useTiptapCommentMarks } from './useTiptapCommentMarks'
import { TiptapAiActions } from './TiptapAiActions'

type Props = {
  noteId: string
  initialHTML?: string
  onSave: (html: string) => Promise<void>
  user: { id: string; name: string; avatar?: string }
  readOnly?: boolean
  onSelectionChange?: (start: number, end: number) => void
  onContentChange?: (html: string) => void
  versionKey?: string
  className?: string
  style?: React.CSSProperties
  updatedAt?: string
}

export default function TiptapEditor({ noteId, initialHTML, onSave, user, readOnly = false, onSelectionChange, onContentChange, versionKey, className, style, updatedAt }: Props) {
  const ydoc = useMemo(() => new Y.Doc(), [])
  const room = useMemo(() => `note:${String(noteId).toLowerCase()}${versionKey ? `:${versionKey}` : ''}`,
    [noteId, versionKey],
  )
  const {
    provider,
    connStatus,
    participants,
    collabEnabled,
    localMode,
    wsDebug,
    reconnect,
  } = useTiptapCollab({ noteId, versionKey, room, ydoc, user })
  const { idbSynced } = useTiptapPersistence(room, ydoc)

  const injectBusyRef = useRef(false)
  const lastInjectedHTMLRef = useRef<string>('')
  const migratedOnceRef = useRef(false)
  const { onSelectionChangeRef, onContentChangeRef, onSaveRef } = useTiptapEditorBridge({
    onSelectionChange,
    onContentChange,
    onSave,
  })
  const [aiWritingType, setAiWritingType] = useState<null | 'continue' | 'polish' | 'summary'>(null)
  const suppressSelectionRef = useRef(false)
  const lastSelectionRef = useRef<{ from: number; to: number }>({ from: -1, to: -1 })
  const selectionDebounceRef = useRef<number | null>(null)
  const editor = useEditor({
    extensions: createTiptapExtensions({ collabEnabled, ydoc, provider, user }),
    // 协作模式且非版本回溯时，Yjs 是正文真相源，不能用 initialHTML 覆盖编辑器内容；
    // 版本回溯或协作未启用时才需要将 HTML 设为初始内容。
    content: ((collabEnabled && !versionKey) ? undefined : (initialHTML || '<p></p>')),
    editorProps: { attributes: { class: 'tiptap-content min-h-full outline-none' } },
    editable: !readOnly,
    immediatelyRender: false,
  }, [provider, collabEnabled])
  useTiptapCommentMarks({ editor, noteId, suppressSelectionRef })

  useEffect(() => {
    if (!editor) return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (typeof detail?.index === 'number') {
        const targetIndex = detail.index
        let currentHeadingIndex = 0
        let foundPos = -1
        editor.state.doc.descendants((node, pos) => {
          if (foundPos !== -1) return false
          if (node.type.name === 'heading') {
            if (currentHeadingIndex === targetIndex) {
              foundPos = pos
              return false
            }
            currentHeadingIndex++
          }
        })

        if (foundPos !== -1) {
          try {
            const dom = editor.view.nodeDOM(foundPos) as HTMLElement
            const targetDom = dom || (editor.view.domAtPos(foundPos).node as HTMLElement)

            if (targetDom && targetDom.scrollIntoView) {
              targetDom.scrollIntoView({ behavior: 'smooth', block: 'center' })
            } else {
              editor.commands.setTextSelection(foundPos)
              editor.commands.scrollIntoView()
            }
          } catch {
            editor.commands.setTextSelection(foundPos)
            editor.commands.scrollIntoView()
          }
        }
      }
    }
    document.addEventListener('editor:scrollToHeading', handler)
    return () => document.removeEventListener('editor:scrollToHeading', handler)
  }, [editor])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'INSERT_MINDMAP' && editor) {
        const { id } = event.data.payload
        editor.chain().focus().insertContent({
          type: 'resourceEmbed',
          attrs: {
            type: 'mindmap',
            id,
            displayMode: 'preview'
          }
        }).run()
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [editor])

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
  }, [editor, noteId, onSelectionChangeRef])

  useEffect(() => {
    if (!editor) return
    let lastHtml = ''
    const updateHandler = () => {
      try {
        const html = editor.getHTML()
        if (html === lastHtml) return
        lastHtml = html
        onContentChangeRef.current?.(html)
      } catch { }
    }
    editor.on('update', updateHandler)
    try {
      const html = editor.getHTML()
      lastHtml = html
      onContentChangeRef.current?.(html)
    } catch { }
    return () => { editor.off('update', updateHandler) }
  }, [editor, onContentChangeRef])

  useEffect(() => {
    if (wsDebug.synced && editor && initialHTML && initialHTML !== '<p></p>' && provider) {
      const timer = setTimeout(() => {
        try {
          const meta = ydoc.getMap('meta')
          const clientId = provider.awareness.clientID

          let hasLocalDocContent = false
          try {
            const frag = ydoc.getXmlFragment('prosemirror') as any
            hasLocalDocContent = frag && typeof frag.length === 'number' ? frag.length > 0 : false
          } catch { }

          const currentText = editor.getText().trim()
          const isDirtyMarkdown = currentText.startsWith('# ') || currentText.startsWith('## ')
          const isCleanHTML = initialHTML.includes('<h') || initialHTML.includes('<ul') || initialHTML.includes('<ol')

          const lastUpdatedAt = meta.get('lastUpdatedAt') as number | undefined
          const serverUpdatedAt = updatedAt ? new Date(updatedAt).getTime() : 0
          const isExternalUpdate = serverUpdatedAt > (lastUpdatedAt || 0) + 1000

          ydoc.transact(() => {
            const shouldSeed = (!meta.get('seeded') && !hasLocalDocContent) || ((isDirtyMarkdown && isCleanHTML) && !hasLocalDocContent)
            if (shouldSeed || isExternalUpdate) {
              meta.set('seeded', { by: clientId, at: Date.now() })
              if (serverUpdatedAt > 0) meta.set('lastUpdatedAt', serverUpdatedAt)
              editor.commands.setContent(initialHTML)
              console.log('[Collab] seeded/repaired by', clientId, { isExternalUpdate, serverUpdatedAt, lastUpdatedAt })
            } else {
              console.log('[Collab] skip seed, already seeded', meta.get('seeded'))
            }
          })
        } catch (e) {
          console.warn('[Collab] seed failed', e)
        }
      }, Math.floor(Math.random() * 300) + 100)
      return () => clearTimeout(timer)
    }
  }, [wsDebug.synced, editor, initialHTML, provider, updatedAt, idbSynced, ydoc])

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
      else if (cmd === 'insertResource') {
        const type = String((payload && payload.type) || 'mindmap')
        const id = String((payload && payload.id) || '')
        if (id) {
          chain.insertContent({
            type: 'resourceEmbed',
            attrs: { type, id, displayMode: 'preview' }
          }).run()
        }
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
  }, [editor, onSaveRef])

  if (!editor) return <div className="p-4 text-sm text-gray-500">编辑器加载中…</div>

  const connMeta = COLLAB_STATUS_META[connStatus]

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-xs" aria-live="polite" role="status">
          连接状态：<span className={connMeta.className}>{connMeta.label}</span>
          {connMeta.detail && <span className="ml-2 text-xs text-gray-500">{connMeta.detail}</span>}
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
        <Button size="sm" variant="outline" onClick={reconnect}>重连</Button>
        <Button size="sm" variant="outline" disabled={readOnly || localMode} onClick={async () => { if (readOnly || localMode) return; const html = editor.getHTML(); await onSave(html) }}>保存</Button>
      </div>
      <div
        id="editor-card"
        className={`border rounded-[8px] p-3 min-h-[560px] focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent ${className || ''}`}
        onMouseDown={(e) => {
          try {
            if (!editor || !editor.isEditable) return
            if (e.target === e.currentTarget) {
              e.preventDefault()
              const endPos = editor.state.doc.content.size
              editor.chain().focus().setTextSelection(endPos).run()
            }
          } catch { }
        }}
        style={{ position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--surface-1)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)', ...style }}
      >
        <FloatingMenu
          editor={editor}
          tippyOptions={{ duration: 100 }}
          shouldShow={({ state }) => {
            const { $from } = state.selection
            return $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0
          }}
        >
          <TiptapAiActions
            editor={editor}
            readOnly={readOnly}
            aiWritingType={aiWritingType}
            setAiWritingType={setAiWritingType}
            mode="continue"
          />
        </FloatingMenu>

        <BubbleMenu
          editor={editor}
          pluginKey="bubble-menu"
          shouldShow={({ editor: ed, state }) => {
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

            <TiptapAiActions
              editor={editor}
              readOnly={readOnly}
              aiWritingType={aiWritingType}
              setAiWritingType={setAiWritingType}
              mode="selection"
            />

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
        <EditorContent editor={editor} className="h-full tiptap-content" style={{ flex: 1, minHeight: '100%', padding: 12, background: 'var(--surface-1)', color: 'var(--on-surface)' }} />
        <div id="comment-tooltip" style={{ position: 'absolute', pointerEvents: 'none', display: 'none', padding: '8px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.1)', transition: 'opacity 300ms ease-in-out' }}>已添加评论，打开右侧面板查看</div>
      </div>
    </div>
  )
}
