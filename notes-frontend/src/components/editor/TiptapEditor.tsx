'use client'
import { useEffect, useMemo, useState, useRef } from 'react'
import { EditorContent, useEditor, BubbleMenu, FloatingMenu } from '@tiptap/react'
import type { Editor as TiptapEditorInstance } from '@tiptap/core'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import * as Y from 'yjs'
import { Button } from '@/components/ui/button'
import { Copy, MessageSquare } from 'lucide-react'
import { createTiptapExtensions } from './tiptap-extensions'
import { COLLAB_STATUS_META, sanitizeHTML } from './tiptap-utils'
import { useTiptapCollab } from './useTiptapCollab'
import { useTiptapPersistence } from './useTiptapPersistence'
import { normalizeEditorContent, normalizeMarkdownPaste, useTiptapEditorBridge, type NormalizedEditorContent } from './useTiptapEditorBridge'
import { useTiptapCommentMarks } from './useTiptapCommentMarks'
import { TiptapAiActions } from './TiptapAiActions'
import { appToast } from '@/lib/app-toast'

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

const CONTENT_NORMALIZATION_VERSION = 1

export function isLegacyRawMarkdownDocument(
  editor: TiptapEditorInstance,
  raw: string,
  source: NormalizedEditorContent['source'],
) {
  if (source !== 'markdown' || typeof document === 'undefined') return false

  try {
    const container = document.createElement('div')
    container.innerHTML = raw
    const legacyDocument = ProseMirrorDOMParser.fromSchema(editor.state.schema).parse(container)
    // 只有当前 Yjs document 与旧后端 raw 的历史 seed 完全一致，才允许格式迁移。
    return editor.state.doc.eq(legacyDocument)
  } catch {
    return false
  }
}

export default function TiptapEditor({ noteId, initialHTML, onSave, user, readOnly = false, onSelectionChange, onContentChange, versionKey, className, style, updatedAt }: Props) {
  const documentKey = `${noteId}:${versionKey || ''}`
  const initialSeedRef = useRef<{
    key: string
    raw: string
    updatedAt?: string
    normalized: NormalizedEditorContent
  } | null>(null)
  if (!initialSeedRef.current || initialSeedRef.current.key !== documentKey) {
    const raw = initialHTML || ''
    initialSeedRef.current = { key: documentKey, raw, updatedAt, normalized: normalizeEditorContent(raw) }
  }
  // 同一 document 的保存响应只更新外围数据，不能重建 editor 或覆盖尚未保存的本地输入。
  const initialSeed = initialSeedRef.current
  const normalizedInitialContent = initialSeed.normalized
  const ydoc = useMemo(() => new Y.Doc(), [])
  const room = useMemo(() => `note:${String(noteId).toLowerCase()}${versionKey ? `:${versionKey}` : ''}`,
    [noteId, versionKey],
  )
  const {
    provider,
    roomRole,
    connStatus,
    collabEnabled,
    wsDebug,
  } = useTiptapCollab({ noteId, versionKey, room, ydoc, user })
  const effectiveReadOnly = readOnly || roomRole !== 'writer'
  const effectiveReadOnlyRef = useRef(effectiveReadOnly)
  effectiveReadOnlyRef.current = effectiveReadOnly
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

  useEffect(() => {
    if (!normalizedInitialContent.preservedRaw) return
    appToast.error({
      id: `content-conversion:${noteId}`,
      title: '内容格式转换失败',
      message: '已保留原始文本，请检查内容后重试。',
      persistent: true,
    })
  }, [normalizedInitialContent.preservedRaw, noteId])

  const editor = useEditor({
    extensions: createTiptapExtensions({ collabEnabled, ydoc, provider, user }),
    // 协作模式且非版本回溯时，Yjs 是正文真相源，不能用 initialHTML 覆盖编辑器内容；
    // 版本回溯或协作未启用时才需要将 HTML 设为初始内容。
    content: ((collabEnabled && !versionKey) ? undefined : normalizedInitialContent.html),
    editorProps: {
      attributes: { class: 'tiptap-content min-h-full outline-none' },
      handlePaste: (view, event) => {
        const clipboard = event.clipboardData
        if (!clipboard) return false
        const normalized = normalizeMarkdownPaste(
          clipboard.getData('text/plain'),
          clipboard.getData('text/html'),
        )
        if (!normalized) return false

        event.preventDefault()
        if (normalized.preservedRaw) {
          appToast.error({
            id: `content-conversion:${noteId}`,
            title: '内容格式转换失败',
            message: '已保留原始文本，请检查内容后重试。',
            persistent: true,
          })
        }

        const container = document.createElement('div')
        container.innerHTML = sanitizeHTML(normalized.html)
        const slice = ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(container)
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
        return true
      },
    },
    editable: !effectiveReadOnly,
    immediatelyRender: false,
  }, [provider, collabEnabled, documentKey])
  useTiptapCommentMarks({ editor, noteId, suppressSelectionRef, readOnly: effectiveReadOnly, readOnlyRef: effectiveReadOnlyRef })

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
    editor?.setEditable(!effectiveReadOnly)
  }, [editor, effectiveReadOnly])

  useEffect(() => {
    if (!editor || effectiveReadOnly) return
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (effectiveReadOnlyRef.current) return
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
  }, [editor, effectiveReadOnly])

  useEffect(() => {
    if (!editor || migratedOnceRef.current || effectiveReadOnly) return
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
        if (effectiveReadOnlyRef.current) return
        suppressSelectionRef.current = true
        editor.chain().focus().setTextSelection({ from: r.from, to: r.to }).deleteSelection().insertStatusPill({ label: r.label, variant: 'inprogress' }).run()
        setTimeout(() => { suppressSelectionRef.current = false }, 120)
      })
    } catch { }
    migratedOnceRef.current = true
  }, [editor, effectiveReadOnly])

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
    if (!effectiveReadOnly && wsDebug.synced && editor && normalizedInitialContent.html !== '<p></p>' && provider) {
      const timer = setTimeout(() => {
        if (effectiveReadOnlyRef.current) return
        try {
          const meta = ydoc.getMap('meta')
          const clientId = provider.awareness.clientID

          let hasLocalDocContent = false
          try {
            const frag = ydoc.getXmlFragment('prosemirror') as any
            hasLocalDocContent = frag && typeof frag.length === 'number' ? frag.length > 0 : false
          } catch { }

          const lastUpdatedAt = meta.get('lastUpdatedAt') as number | undefined
          const serverUpdatedAt = initialSeed.updatedAt ? new Date(initialSeed.updatedAt).getTime() : 0
          const isExternalUpdate = serverUpdatedAt > (lastUpdatedAt || 0) + 1000
          const hasCurrentNormalization = meta.get('contentNormalizationVersion') === CONTENT_NORMALIZATION_VERSION
          const matchesLegacyRaw = !hasCurrentNormalization && isLegacyRawMarkdownDocument(
            editor,
            initialSeed.raw,
            normalizedInitialContent.source,
          )

          if (effectiveReadOnlyRef.current) return
          ydoc.transact(() => {
            const shouldSeed = !meta.get('seeded') && !hasLocalDocContent
            const shouldRepairLegacy = hasLocalDocContent && matchesLegacyRaw
            // Markdown 外部快照不得覆盖已发生增量的协作文档；仅空文档或精确命中旧 raw 时可应用。
            const shouldApplyExternal = isExternalUpdate
              && (normalizedInitialContent.source !== 'markdown' || !hasLocalDocContent || matchesLegacyRaw)
            if (shouldSeed || shouldRepairLegacy || shouldApplyExternal) {
              meta.set('seeded', { by: clientId, at: Date.now() })
              if (serverUpdatedAt > 0) meta.set('lastUpdatedAt', serverUpdatedAt)
              if (normalizedInitialContent.source === 'markdown') {
                meta.set('contentNormalizationVersion', CONTENT_NORMALIZATION_VERSION)
              }
              editor.commands.setContent(normalizedInitialContent.html)
              console.log('[Collab] seeded/repaired by', clientId, { shouldRepairLegacy, shouldApplyExternal, serverUpdatedAt, lastUpdatedAt })
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
  }, [wsDebug.synced, editor, normalizedInitialContent, provider, initialSeed, idbSynced, ydoc, effectiveReadOnly])

  useEffect(() => {
    if (!editor || effectiveReadOnly) return
    const setHandler = (e: Event) => {
      try {
        if (effectiveReadOnlyRef.current) return
        const html = (e as CustomEvent).detail?.html as string
        if (typeof html === 'string') {
          if (injectBusyRef.current) return
          const normalized = String(html || '').trim()
          const current = String(editor.getHTML() || '').trim()
          if (normalized === current || normalized === lastInjectedHTMLRef.current) return
          const p = provider
          const safe = sanitizeHTML(html || '<p></p>')
          const apply = () => {
            if (effectiveReadOnlyRef.current) return
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
  }, [editor, provider, collabEnabled, ydoc, effectiveReadOnly])

  useEffect(() => {
    if (!editor) return
    const execHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      const cmd = detail.cmd as string
      if (effectiveReadOnly && cmd !== 'fullscreen') return
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
  }, [editor, onSaveRef, effectiveReadOnly])

  if (!editor) return <div className="p-4 text-sm text-gray-500">编辑器加载中…</div>

  const connMeta = COLLAB_STATUS_META[connStatus]

  return (
    <div>
      <span className="sr-only" aria-live="polite" role="status">
        <span>{connMeta.label}</span>
        {connMeta.detail && <span>，{connMeta.detail}</span>}
      </span>
      <div
        id="editor-card"
        className={`min-h-[560px] ${className || ''}`}
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
        style={{ position: 'relative', display: 'flex', flexDirection: 'column', ...style }}
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
            readOnly={effectiveReadOnly}
            aiWritingType={aiWritingType}
            setAiWritingType={setAiWritingType}
            mode="continue"
          />
        </FloatingMenu>

        <BubbleMenu
          editor={editor}
          pluginKey="bubble-menu"
          shouldShow={({ editor: ed, state }) => {
            if (effectiveReadOnly) return false
            const { from, to } = state.selection
            return ed.isEditable && ed.isFocused && from !== to
          }}
          tippyOptions={{
            duration: 150,
            appendTo: () => document.body,
          }}
        >
          <div
            className="editor-selection-popover"
            role="toolbar"
            aria-label="文本格式工具"
            style={{ height: 44, paddingLeft: 8, paddingRight: 8, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-1)' }}
          >
            <TiptapAiActions
              editor={editor}
              readOnly={effectiveReadOnly}
              aiWritingType={aiWritingType}
              setAiWritingType={setAiWritingType}
              mode="selection"
            />

            <Button aria-label="复制选中文本" size="icon" variant="ghost" onClick={() => navigator.clipboard?.writeText(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' '))}>
              <Copy className="w-4 h-4" aria-hidden />
            </Button>
            <Button aria-label="添加评论" title="添加评论" size="icon" variant="ghost" disabled={effectiveReadOnly} onClick={() => {
              try {
                document.dispatchEvent(new CustomEvent('comments:open'))
              } catch { }
            }}>
              <MessageSquare className="w-4 h-4" aria-hidden />
            </Button>
          </div>
        </BubbleMenu>
        <EditorContent editor={editor} className="h-full tiptap-content" style={{ flex: 1, minHeight: '100%', padding: 12, background: 'var(--surface-1)', color: 'var(--on-surface)' }} />
      </div>
    </div>
  )
}
