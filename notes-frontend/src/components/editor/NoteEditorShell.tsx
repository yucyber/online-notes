'use client'

import { useState, useEffect, useLayoutEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { fetchNoteById, fetchNotes, fetchCategories, fetchTags, updateNote, boardsAPI, mindmapsAPI, notesAPI } from '@/lib/api'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import type { Note, Category, Tag } from '@/types'
import { getCurrentUser } from '@/lib/auth'
import TiptapToolbar from '@/components/editor/TiptapToolbar'
import { NoteEditorDrawers } from '@/components/editor/NoteEditorDrawers'
import { NoteEditorHeader } from '@/components/editor/NoteEditorHeader'
import { NoteEditorMetadataPanel } from '@/components/editor/NoteEditorMetadataPanel'
import { EditorNoteProperties } from '@/components/editor/EditorNoteProperties'
import { EditorWorkspaceSidebar } from '@/components/editor/EditorWorkspaceSidebar'
import { EditorOutline } from '@/components/editor/EditorOutline'
import { extractEditorHeadings, sameEditorHeadings } from '@/components/editor/editor-outline-utils'
import { useNoteEditorPage } from '@/components/editor/useNoteEditorPage'
import { useNoteSave } from '@/components/editor/useNoteSave'
import { useEditorAutoSave } from '@/components/editor/useEditorAutoSave'
import type { EditorSnapshot } from '@/components/editor/editor-save-types'
import { canWriteNote } from '@/components/editor/note-permissions'
import { useEditorLayoutPreferences } from '@/components/editor/useEditorLayoutPreferences'
import { appToast } from '@/lib/app-toast'
import { DEFAULT_EDITOR_FORMAT_STATE } from '@/components/editor/editor-format-state'
const TiptapEditor = dynamic(() => import('@/components/editor/TiptapEditor'), { ssr: false })

export interface NoteEditorShellProps {
  id: string
  initialData?: Note
  initialContent?: string
}

const normalizeLocationText = (value: string) => value.replace(/\s+/g, ' ').trim()

function findAnchorTarget(root: HTMLElement, anchorText: string) {
  const expected = normalizeLocationText(anchorText)
  if (!expected) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const owners: Array<HTMLElement | null> = []
  let flat = ''
  let previousBlock: Element | null = null
  let current = walker.nextNode()
  while (current) {
    const parent = current.parentElement
    const block = parent?.closest('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div') || parent
    if (flat && block && previousBlock && block !== previousBlock && !flat.endsWith(' ')) {
      flat += ' '
      owners.push(parent)
    }
    for (const character of current.textContent || '') {
      if (/\s/.test(character)) {
        if (flat && !flat.endsWith(' ')) {
          flat += ' '
          owners.push(parent)
        }
      } else {
        flat += character
        owners.push(parent)
      }
    }
    previousBlock = block
    current = walker.nextNode()
  }
  const index = normalizeLocationText(flat).indexOf(expected)
  const owner = index >= 0 ? owners[index] : null
  return owner?.closest<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre') || owner
}

function findHeadingTarget(root: HTMLElement, headingPath: string[]) {
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
  const expectedPath = headingPath.map(normalizeLocationText).filter(Boolean)
  const stack: Array<{ level: number; text: string }> = []
  for (const heading of headings) {
    const level = Number(heading.tagName.slice(1))
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop()
    stack.push({ level, text: normalizeLocationText(heading.textContent || '') })
    if (stack.length > expectedPath.length) continue
    const expectedSuffix = expectedPath.slice(-stack.length)
    if (stack.every((item, index) => item.text === expectedSuffix[index])) return heading
  }
  return null
}

function NoteEditorShellInner({ id, initialData, initialContent }: NoteEditorShellProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [note, setNote] = useState<Note | null>(initialData ?? null)
  const [directoryNotes, setDirectoryNotes] = useState<Note[]>(initialData ? [initialData] : [])
  const [directorySearch, setDirectorySearch] = useState('')
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [metaLoading, setMetaLoading] = useState(true)
  const [metaError, setMetaError] = useState('')
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  const [formatState, setFormatState] = useState(DEFAULT_EDITOR_FORMAT_STATE)
  const [currentContent, setCurrentContent] = useState(initialContent ?? initialData?.content ?? '')
  const [currentTitle, setCurrentTitle] = useState(initialData?.title ?? '')
  const [me, setMe] = useState<{ id: string; name: string }>({ id: 'me', name: '我' })
  const [participants, setParticipants] = useState<Array<{ id: string; name?: string }>>([])
  const readOnly = !canWriteNote(note, me.id)
  const rejectReadOnlyWrite = useCallback(() => {
    if (!readOnly) return false
    appToast.error({ id: `permission:${id}`, title: '当前笔记仅可查看' })
    return true
  }, [id, readOnly])
  const [showCollabDrawer, setShowCollabDrawer] = useState(false)
  const [showCommentsDrawer, setShowCommentsDrawer] = useState(false)
  const [commentsMode, setCommentsMode] = useState<'overview' | 'selection'>('selection')
  const commentsDrawerRef = useRef<HTMLDivElement>(null)
  const [toc, setToc] = useState<Array<{ id: string; text: string; level: number }>>([])
  const {
    editorContainerRef,
    isFullscreen,
    linkHref,
    setIsFullscreen,
    setLinkHref,
    setShowInsertMenu,
    setShowLinkDialog,
    showInsertMenu,
    showLinkDialog,
  } = useNoteEditorPage()
  const { preferences, toggleLeft, setLeftWidth } = useEditorLayoutPreferences()
  const leftRestoreButtonRef = useRef<HTMLButtonElement>(null)
  const propertiesPanelRef = useRef<HTMLDivElement>(null)
  const [showProperties, setShowProperties] = useState(false)
  const [outlinePinned, setOutlinePinned] = useState(true)
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; width: number } | null>(null)
  const [isResizingLeft, setIsResizingLeft] = useState(false)
  const [editorRoot, setEditorRoot] = useState<HTMLElement | null>(null)
  const [editorContentRevision, setEditorContentRevision] = useState(0)
  const [evidenceLocation, setEvidenceLocation] = useState<{
    key: string
    anchorText: string
    headingPath: string[]
  } | null>(null)
  const [evidenceLocationError, setEvidenceLocationError] = useState('')
  const locatedEvidenceKeyRef = useRef('')
  const failedEvidenceKeyRef = useRef('')
  const chunkId = searchParams?.get('chunkId') || ''
  const headingQuery = searchParams?.get('heading') || ''
  const handleEditorReady = useCallback((root: HTMLElement | null) => {
    if (root) {
      locatedEvidenceKeyRef.current = ''
      failedEvidenceKeyRef.current = ''
    }
    setEditorRoot(root)
    if (root) setEditorContentRevision((revision) => revision + 1)
  }, [])
  useEffect(() => {
    // 目录是辅助导航，加载失败不能阻断正文编辑。
    if (typeof fetchNotes !== 'function') return
    const controller = new AbortController()
    void fetchNotes({ page: 1, size: 50 }, controller.signal)
      .then((result) => setDirectoryNotes(result.items))
      .catch(() => undefined)
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!showProperties) return
    const close = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('[aria-label="打开笔记属性"]')) return
      if (!propertiesPanelRef.current?.contains(event.target as Node)) setShowProperties(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowProperties(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [showProperties])
  useEffect(() => {
    if (!showInsertMenu) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowInsertMenu(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [showInsertMenu, setShowInsertMenu])
  useEffect(() => {
    const open = () => {
      if (rejectReadOnlyWrite()) return
      setShowLinkDialog(true)
    }
    document.addEventListener('open:link-dialog', open as any)
    return () => { document.removeEventListener('open:link-dialog', open as any) }
  }, [rejectReadOnlyWrite, setShowLinkDialog])
  useEffect(() => {
    const open = () => {
      if (rejectReadOnlyWrite()) return
      setShowInsertMenu((open) => !open)
    }
    document.addEventListener('open:insert-menu', open as any)
    return () => { document.removeEventListener('open:insert-menu', open as any) }
  }, [rejectReadOnlyWrite, setShowInsertMenu])
  useEffect(() => {
    if (!readOnly) return
    const rejectHistoricalCommand = (event: Event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      rejectReadOnlyWrite()
    }
    document.addEventListener('tiptap:exec', rejectHistoricalCommand, true)
    return () => { document.removeEventListener('tiptap:exec', rejectHistoricalCommand, true) }
  }, [readOnly, rejectReadOnlyWrite])

  const extractHeadingsFromHTML = useCallback((html: string) => {
    const result = extractEditorHeadings(html)
    setToc((previous) => sameEditorHeadings(previous, result) ? previous : result)
  }, [])

  // 读取当前用户信息用于协作指示
  useEffect(() => {
    const u = getCurrentUser()
    if (u) setMe({ id: u.id, name: u.displayName || u.email })
  }, [])

  // 仅保留低性能环境观测；统一编辑器后不能再降级到另一套内容格式。
  useEffect(() => {
    try {
      const nav: any = navigator
      const conn: any = nav?.connection || nav?.mozConnection || nav?.webkitConnection
      const saveData: boolean = Boolean(conn?.saveData)
      const downlink: number | undefined = typeof conn?.downlink === 'number' ? conn.downlink : undefined
      const deviceMemory: number | undefined = typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : undefined
      const hw: number | undefined = typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : undefined
      const prefersReducedMotion = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const isOffline = typeof nav?.onLine === 'boolean' ? !nav.onLine : false
      const lowSpec = (
        saveData || isOffline || (downlink != null && downlink < 1.5) || (deviceMemory != null && deviceMemory < 4) || (hw != null && hw <= 4) || prefersReducedMotion
      )
      if (lowSpec) {
        try {
          const evt = new CustomEvent('rum', {
            detail: {
              type: 'network',
              name: 'ui_degrade',
              meta: { saveData, downlink, deviceMemory, hardwareConcurrency: hw, prefersReducedMotion, offline: isOffline, page: 'edit' },
              ts: Date.now(),
            },
          })
          document.dispatchEvent(evt)
        } catch { }
      }
    } catch { }
  }, [])



  useEffect(() => {
    if (!showCommentsDrawer) return
    const dialog = commentsDrawerRef.current
    if (!dialog) return
    const focusable = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])')
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    first?.focus()
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setShowCommentsDrawer(false) }
      if (e.key === 'Tab') {
        if (focusable.length === 0) return
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    dialog.addEventListener('keydown', handleKey)
    return () => { dialog.removeEventListener('keydown', handleKey) }
  }, [showCommentsDrawer])

  // 全屏切换：事件监听与状态同步
  // 监听器只注册一次，通过 ref 读取最新的 handler/state，避免重复绑定
  const handleToggleFullscreenRef = useRef<() => void>(() => {})
  const isFullscreenRef = useRef(isFullscreen)
  isFullscreenRef.current = isFullscreen
  const noteIdRef = useRef(id)
  noteIdRef.current = id
  useEffect(() => {
    const onFsChange = () => {
      const active = Boolean(document.fullscreenElement)
      setIsFullscreen(active)
      try {
        const evt = new CustomEvent('rum', { detail: { type: 'ui', name: 'fullscreen_change', meta: { active }, ts: Date.now() } })
        document.dispatchEvent(evt)
      } catch { }
      if (active) {
        // 进入全屏时隐藏侧栏，禁用页面滚动，聚焦工具栏按钮以保可达性
        document.body.style.overflow = 'hidden'
        const btn = document.getElementById('fullscreen-button') as HTMLButtonElement | null
        // 防止聚焦导致工具栏容器发生横向滚动
        try {
          btn?.focus({ preventScroll: true } as any)
        } catch {
          btn?.focus()
        }
        // 兜底：若浏览器仍产生滚动，强制将工具栏滚动位置复位
        try {
          const toolbar = document.querySelector('[role="toolbar"]') as HTMLElement | null
          if (toolbar && (toolbar as any).scrollLeft > 0) (toolbar as any).scrollLeft = 0
        } catch { }
      } else {
        // 退出全屏恢复滚动
        document.body.style.overflow = ''
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement) {
          e.stopPropagation()
          try { document.exitFullscreen() } catch { }
        } else if (isFullscreenRef.current) {
          setIsFullscreen(false)
          document.body.style.overflow = ''
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        handleToggleFullscreenRef.current()
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    const onToggle = () => { handleToggleFullscreenRef.current() }
    document.addEventListener('editor:toggleFullscreen', onToggle as any)
    document.addEventListener('keydown', onKey)
    // 划词触发（正文选中文字后点「添加评论」）：右侧弹出小浮层，聚焦当前选区的评论。
    const onCommentsOpen = () => { setCommentsMode('selection'); setShowCommentsDrawer(true); setTimeout(() => { const input = document.getElementById('comment-input') as HTMLInputElement | null; input?.focus() }, 50) }
    document.addEventListener('comments:open', onCommentsOpen as any)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('editor:toggleFullscreen', onToggle as any)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('comments:open', onCommentsOpen as any)
    }
  }, [setIsFullscreen, setShowCommentsDrawer])

  const handleToggleFullscreen = () => {
    const target = editorContainerRef.current || document.documentElement
    if (document.fullscreenElement) {
      try { (document as any).exitFullscreen?.() } catch { }
      setIsFullscreen(false)
      document.body.style.overflow = ''
      return
    }
    try {
      const fn = (target as any).requestFullscreen || (document.documentElement as any).requestFullscreen || (document as any).webkitRequestFullscreen
      if (typeof fn === 'function') {
        Promise.resolve(fn.call(target)).catch(() => { })
      }
    } catch { }
    // 若原生全屏未成功，200ms 后启用 CSS 回退
    setTimeout(() => {
      if (!document.fullscreenElement) {
        setIsFullscreen(true)
        document.body.style.overflow = 'hidden'
      }
    }, 200)
  }
  // 同步到 ref，供只注册一次的全屏事件监听器读取最新实现
  handleToggleFullscreenRef.current = handleToggleFullscreen



  const loadNote = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchNoteById(id)
      setNote(data)
      setCurrentContent(data?.content || '')
      setCurrentTitle(data?.title || '')
      // 移除强制 setContent，避免与 Yjs 协同冲突导致内容重复或覆盖
      // try { document.dispatchEvent(new CustomEvent('editor:setContent', { detail: { html: String(data?.content || '<p></p>') } })) } catch { }
      setError('')
    } catch (err) {
      setError('加载笔记失败')
      console.error('Failed to load note:', err)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    // SSR 已注入数据时跳过首屏请求；版本恢复带 restored 时强制重载
    if (initialData && !searchParams?.get('restored')) return
    void loadNote()
  }, [loadNote, initialData, searchParams])

  useEffect(() => {
    if (!editorRoot) return
    // 协同正文可能晚于 editor view 到达，以真实 DOM 变化作为可定位时机。
    const observer = new MutationObserver(() => setEditorContentRevision((revision) => revision + 1))
    observer.observe(editorRoot, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [editorRoot])

  useEffect(() => {
    const evidenceKey = `${id}:${chunkId}`
    let active = true
    locatedEvidenceKeyRef.current = ''
    failedEvidenceKeyRef.current = ''
    setEvidenceLocation(null)
    setEvidenceLocationError('')
    if (!chunkId) return

    void notesAPI.getChunkLocation(id, chunkId)
      .then((location) => {
        if (!active) return
        setEvidenceLocation({ key: evidenceKey, ...location })
      })
      .catch(() => {
        if (!active) return
        const fallbackPath = headingQuery.split('>').map((part) => part.trim()).filter(Boolean)
        setEvidenceLocation({ key: evidenceKey, anchorText: '', headingPath: fallbackPath })
      })

    return () => { active = false }
  }, [chunkId, headingQuery, id])

  useEffect(() => {
    if (!chunkId || !editorRoot || loading || !evidenceLocation) return
    const evidenceKey = `${id}:${chunkId}`
    if (evidenceLocation.key !== evidenceKey || locatedEvidenceKeyRef.current === evidenceKey) return
    const highlighted = findAnchorTarget(editorRoot, evidenceLocation.anchorText)
      || findHeadingTarget(editorRoot, evidenceLocation.headingPath)
    if (highlighted) {
      locatedEvidenceKeyRef.current = evidenceKey
      setEvidenceLocationError('')
      highlighted.classList.add('evidence-location-target')
      highlighted.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const clearTimer = window.setTimeout(() => highlighted.classList.remove('evidence-location-target'), 2400)
      return () => {
        window.clearTimeout(clearTimer)
        highlighted.classList.remove('evidence-location-target')
      }
    }
    // 定位失败只回到可见顶部并提示，不通过 editor command 或 Y.Doc 改写正文。
    if (failedEvidenceKeyRef.current !== evidenceKey) {
      failedEvidenceKeyRef.current = evidenceKey
      editorRoot.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setEvidenceLocationError('未找到原证据位置')
    }
  }, [chunkId, editorContentRevision, editorRoot, evidenceLocation, id, loading])

  useEffect(() => {
    const loadMeta = async () => {
      try {
        setMetaLoading(true)
        const [categoryData, tagData] = await Promise.all([
          fetchCategories(),
          fetchTags(),
        ])
        setCategories(categoryData)
        setTags(tagData)
        setMetaError('')
      } catch (err) {
        console.error('Failed to load categories or tags:', err)
        setMetaError('无法加载分类或标签数据')
      } finally {
        setMetaLoading(false)
      }
    }

    loadMeta()
  }, [])

  const resolveCategoryId = (category: Category | Note['category']) =>
    (typeof category === 'object' && category
      ? (category as Category).id
      : '') || ''

  const normalizeCategoryValue = (value: unknown) => {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') {
      return (value as { id?: string }).id || ''
    }
    return ''
  }

  const resolveTagId = (tag: Tag | string | Note['tags'][number]) => {
    if (typeof tag === 'string') return tag
    if (!tag) return ''
    return (tag as Tag).id || ''
  }

  useEffect(() => {
    if (note) {
      setSelectedCategory(
        normalizeCategoryValue(note.categoryId) ||
        resolveCategoryId(note.category) ||
        ''
      )
      setSelectedTags(
        Array.isArray(note.tags)
          ? note.tags
            .map((tag) => resolveTagId(tag))
            .filter((tagId): tagId is string => Boolean(tagId))
          : []
      )
    }
  }, [note])

  const toggleTag = (tagId: string) => {
    if (rejectReadOnlyWrite()) return
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
  }

  const { handleSave: persistNote, addTagsByNames: persistTags } = useNoteSave({
    id,
    selectedCategory,
    selectedTags,
    tags,
    editorMode: 'rich',
    setNote: (updater) => setNote(prev => updater(prev)),
    setTags,
  })
  const handleSave = useCallback(async (snapshot: EditorSnapshot) => {
    if (rejectReadOnlyWrite()) return
    await persistNote(snapshot.title, snapshot.content)
  }, [persistNote, rejectReadOnlyWrite])

  const { state: saveState, saveNow, markSaved } = useEditorAutoSave({
    noteId: id,
    snapshot: {
      title: currentTitle,
      content: currentContent,
      visibility: note?.visibility,
      categoryId: selectedCategory || null,
      tags: selectedTags,
      status: 'published',
    },
    enabled: Boolean(note) && !readOnly,
    save: handleSave,
    delayMs: 400,
  })

  const handleChangeTitle = useCallback(async (value: string) => {
    if (rejectReadOnlyWrite()) return
    try {
      const updated = await updateNote(id, { title: value })
      setNote(prev => (prev ? { ...prev, title: updated.title ?? value } : prev))
      setCurrentTitle(updated.title ?? value)
      // 标题保存属轻量自动保存，复用顶部「已自动保存」状态，不弹独立 Toast
      markSaved()
    } catch (error) {
      appToast.error({ id: `title:${id}`, title: '标题保存失败', message: String((error as any)?.message || error) })
      throw error
    }
  }, [id, rejectReadOnlyWrite, markSaved])
  const addTagsByNames = useCallback(async (names: string[]) => {
    if (rejectReadOnlyWrite()) return []
    return persistTags(names)
  }, [persistTags, rejectReadOnlyWrite])

  useEffect(() => {
    const onSaveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (rejectReadOnlyWrite()) return
        void saveNow()
      }
    }
    document.addEventListener('keydown', onSaveShortcut)
    return () => { document.removeEventListener('keydown', onSaveShortcut) }
  }, [rejectReadOnlyWrite, saveNow])

  const handleWorkspaceBack = () => {
    router.push('/dashboard/notes')
  }

  const focusRestoreButton = (button: React.RefObject<HTMLButtonElement>) => {
    window.requestAnimationFrame(() => button.current?.focus())
  }

  const handleToggleLeft = () => {
    const isCollapsing = !preferences.leftCollapsed
    toggleLeft()
    if (isCollapsing) focusRestoreButton(leftRestoreButtonRef)
  }

  const finishLeftResize = () => {
    const drag = dragRef.current
    if (!drag) return
    setLeftWidth(drag.width)
    dragRef.current = null
    setIsResizingLeft(false)
  }

  const cancelLeftResize = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    setLeftWidth(drag.startWidth, false, false)
    dragRef.current = null
    setIsResizingLeft(false)
  }, [setLeftWidth])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelLeftResize()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancelLeftResize])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 mb-4">{error}</p>
        <Button onClick={loadNote}>重试</Button>
      </div>
    )
  }

  if (!note) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">笔记不存在</p>
      </div>
    )
  }

  return (
    <div className="editor-shell">

      <div
        className="editor-layout-grid"
        style={{
          '--editor-left-width': preferences.leftCollapsed ? '0px' : `${preferences.leftWidth}px`,
        } as React.CSSProperties}
      >
        <EditorWorkspaceSidebar
          collapsed={preferences.leftCollapsed}
          notes={directoryNotes}
          currentNoteId={id}
          searchValue={directorySearch}
          onSearchChange={setDirectorySearch}
          onOpenNote={(noteId) => router.push(`/dashboard/notes/${noteId}/edit`)}
          onBack={handleWorkspaceBack}
          onToggle={handleToggleLeft}
          restoreButtonRef={leftRestoreButtonRef}
        >
          {!preferences.leftCollapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整左侧导航宽度"
              className="editor-layout-resizer"
              data-resizing={isResizingLeft}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                dragRef.current = {
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startWidth: preferences.leftWidth,
                  width: preferences.leftWidth,
                }
                setIsResizingLeft(true)
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current
                if (!drag || drag.pointerId !== event.pointerId) return
                drag.width = Math.min(360, Math.max(220, drag.startWidth + event.clientX - drag.startX))
                // 拖动中只更新内存，避免连续写入 localStorage 影响编辑交互。
                setLeftWidth(drag.width, false, false)
              }}
              onPointerUp={(event) => {
                if (dragRef.current?.pointerId !== event.pointerId) return
                finishLeftResize()
              }}
              onPointerCancel={cancelLeftResize}
            />
          )}
        </EditorWorkspaceSidebar>
        <div className="editor-layout-main">
          <NoteEditorHeader
            note={note}
            readOnly={readOnly}
            editorMode="rich"
            collaborators={participants}
            onOpenComments={() => { setCommentsMode('overview'); setShowCommentsDrawer(true); try { document.dispatchEvent(new CustomEvent('comments:replay', { detail: { noteId: noteIdRef.current, strategy: 'context' } })) } catch { } }}
            onOpenCollab={() => setShowCollabDrawer(true)}
            onToggleProperties={() => setShowProperties((open) => !open)}
            propertiesOpen={showProperties}
            saveState={saveState}
            onChangeTitle={handleChangeTitle}
          />
          <NoteEditorMetadataPanel
            id={id}
            open={showProperties}
            panelRef={propertiesPanelRef as React.RefObject<HTMLDivElement>}
            onClose={() => setShowProperties(false)}
            properties={(
              <EditorNoteProperties
                categories={categories}
                tags={tags}
                selectedCategory={selectedCategory}
                selectedTags={selectedTags}
                tagInput={tagInput}
                metaLoading={metaLoading}
                metaError={metaError}
                readOnly={readOnly}
                resolveCategoryId={resolveCategoryId}
                setSelectedCategory={setSelectedCategory}
                setSelectedTags={setSelectedTags}
                setTagInput={setTagInput}
                toggleTag={toggleTag}
                addTagsByNames={addTagsByNames}
                rejectReadOnlyWrite={rejectReadOnlyWrite}
              />
            )}
          />
          {error && <div className="editor-error-banner" role="alert">{error}</div>}
          {evidenceLocationError && <div className="editor-error-banner" role="status">{evidenceLocationError}</div>}
          <div className="editor-edit-row">
            <div ref={editorContainerRef} className="editor-rich-editor" data-fullscreen={isFullscreen} style={isFullscreen ? { position: 'fixed', inset: 0, zIndex: 50, width: '100vw', height: '100vh', overflowY: 'auto', background: 'var(--bg)' } : undefined}>
              <TiptapToolbar disabled={readOnly} isFullscreen={isFullscreen} formatState={formatState} exec={(cmd, payload) => {
                if (cmd === 'collab') { setShowCollabDrawer(true); return }
                if (cmd === 'fullscreen') { handleToggleFullscreen(); return }
                if (rejectReadOnlyWrite()) return
                if (cmd === 'link' && !payload) { setShowLinkDialog(true); return }
                if (cmd === 'comments') {
                  try {
                    setShowCommentsDrawer(true)
                    const openEvt = new CustomEvent('comments:open')
                    document.dispatchEvent(openEvt)
                    setTimeout(() => { const input = document.getElementById('comment-input') as HTMLInputElement | null; input?.focus() }, 50)
                  } catch { }
                  return
                }
                const ev = new CustomEvent('tiptap:exec', { detail: { cmd, payload } })
                document.dispatchEvent(ev)
              }} />
              <div className="editor-paper">
                <TiptapEditor
                noteId={id}
                initialHTML={note.content || '<p></p>'}
                onSave={async (html: string) => {
                  if (rejectReadOnlyWrite()) return
                  setCurrentContent(html)
                  await saveNow()
                }}
                user={me}
                readOnly={readOnly}
                onSelectionChange={(start, end) => setSelection({ start, end })}
                onFormatChange={setFormatState}
                onParticipantsChange={setParticipants}
                onReady={handleEditorReady}
                onContentChange={(html) => {
                  extractHeadingsFromHTML(html)
                  if (readOnly) return
                  setCurrentContent(html)
                }}
                // 仅在恢复版本时传递 versionKey，避免常规编辑时因 updatedAt 变化导致房间切换
                versionKey={searchParams?.get('restored') || undefined}
                updatedAt={note.updatedAt}
                    />
              </div>
              {!isFullscreen && <EditorOutline headings={toc} pinned={outlinePinned} onPinnedChange={setOutlinePinned} />}
            </div>
          </div>
        </div>
      </div>

      <NoteEditorDrawers
        id={id}
        currentUserId={me.id}
        selection={selection}
        showCollabDrawer={showCollabDrawer}
        showCommentsDrawer={showCommentsDrawer}
        commentsMode={commentsMode}
        collaborators={participants}
        commentsDrawerRef={commentsDrawerRef as React.RefObject<HTMLDivElement>}
        onCloseCollab={() => setShowCollabDrawer(false)}
        onCloseComments={() => setShowCommentsDrawer(false)}
        onLocateComment={(commentId) => {
          try { document.dispatchEvent(new CustomEvent('comments:locate', { detail: { commentId } })) } catch {}
        }}
        readOnly={readOnly}
      />
      {!isFullscreen && !readOnly && (
        <>
          {showInsertMenu && (
            <div className="editor-insert-backdrop" onMouseDown={() => setShowInsertMenu(false)}>
              <InsertMenuPopover noteId={id} onClose={() => setShowInsertMenu(false)} />
            </div>
          )}
        </>
      )}
      {/* 插入链接对话框 */}
      {showLinkDialog && !readOnly && (
        <div
          className="fixed inset-0 z-50 bg-black/30"
          role="dialog"
          aria-modal="true"
          tabIndex={0}
          onClick={() => setShowLinkDialog(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setShowLinkDialog(false)
            if (e.key === 'Escape') setShowLinkDialog(false)
          }}
        >
          <div
            className="absolute left-1/2 top-1/3 -translate-x-1/2 rounded-xl border bg-white shadow-xl p-4 w-[420px]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
            }}
          >
            <h3 className="text-base font-medium mb-3">插入链接</h3>
            <input aria-label="链接地址" value={linkHref} onChange={(e) => setLinkHref(e.target.value)} className="w-full border rounded-md px-3 py-2" placeholder="https://example.com" />
            <div className="mt-3 flex justify-end gap-2">
              <button className="px-3 py-2 rounded-md border" onClick={() => setShowLinkDialog(false)}>取消</button>
              <button className="px-3 py-2 rounded-md bg-blue-600 text-white" onClick={() => { const href = linkHref.trim(); if (href) document.dispatchEvent(new CustomEvent('tiptap:exec', { detail: { cmd: 'link', payload: { href } } })); setShowLinkDialog(false) }}>插入</button>
            </div>
          </div>
        </div>
      )}
      {/* 旧的顶部弹窗已改为右侧抽屉，保留变量但不再渲染 */}
    </div>
  );
}

function InsertMenuPopover({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const [style, setStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [positioned, setPositioned] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const trigger = document.getElementById('editor-insert-trigger')
    if (!trigger || !menuRef.current) return
    const triggerRect = trigger.getBoundingClientRect()
    const menuRect = menuRef.current.getBoundingClientRect()
    const padding = 8
    let top = triggerRect.bottom + padding
    let left = triggerRect.left + triggerRect.width / 2 - menuRect.width / 2
    left = Math.max(padding, Math.min(left, window.innerWidth - menuRect.width - padding))
    top = Math.min(top, window.innerHeight - menuRect.height - padding)
    setStyle({ top, left })
    setPositioned(true)
  }, [])

  return (
    <div
      ref={menuRef}
      className="editor-insert-popover"
      role="menu"
      aria-label="插入工具菜单"
      tabIndex={-1}
      style={{ position: 'fixed', top: style.top, left: style.left, visibility: positioned ? 'visible' : 'hidden' }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="p-2 grid" style={{ rowGap: 6 }}>
        <button role="menuitem" className="text-left px-3 py-2" onClick={() => { onClose(); document.dispatchEvent(new CustomEvent('tiptap:exec', { detail: { cmd: 'hr' } })) }}>分割线</button>
        <button role="menuitem" className="text-left px-3 py-2" onClick={() => { onClose(); document.dispatchEvent(new CustomEvent('tiptap:exec', { detail: { cmd: 'status', payload: { text: '状态：进行中' } } })) }}>状态</button>
        <button role="menuitem" className="text-left px-3 py-2" onClick={async () => {
          onClose()
          try {
            const res = await boardsAPI.create({ title: '画板', noteId })
            document.dispatchEvent(new CustomEvent('tiptap:exec', {
              detail: {
                cmd: 'insertResource',
                payload: { type: 'board', id: res.id }
              }
            }))
          } catch { }
        }}>画板</button>
        <button role="menuitem" className="text-left px-3 py-2" onClick={async () => {
          onClose()
          try {
            const res = await mindmapsAPI.create({ title: '思维导图', noteId })
            document.dispatchEvent(new CustomEvent('tiptap:exec', {
              detail: {
                cmd: 'insertResource',
                payload: { type: 'mindmap', id: res.id }
              }
            }))
          } catch { }
        }}>思维导图</button>
      </div>
    </div>
  )
}

export default function NoteEditorShell(props: NoteEditorShellProps) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" /></div>}>
      <NoteEditorShellInner {...props} />
    </Suspense>
  )
}
