'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { fetchNoteById, fetchCategories, fetchTags, updateNote, lockNote, unlockNote, boardsAPI, mindmapsAPI } from '@/lib/api'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { Note, Category, Tag } from '@/types'
import { getCurrentUser } from '@/lib/auth'
import TiptapToolbar from '@/components/editor/TiptapToolbar'
import { NoteEditorDrawers } from '@/components/editor/NoteEditorDrawers'
import { NoteEditorHeader } from '@/components/editor/NoteEditorHeader'
import { NoteEditorMetadataPanel } from '@/components/editor/NoteEditorMetadataPanel'
import { useNoteEditorPage } from '@/components/editor/useNoteEditorPage'
import { useNoteSave } from '@/components/editor/useNoteSave'
import { useEditorAutoSave } from '@/components/editor/useEditorAutoSave'
import { canWriteNote, shouldManageNoteLock } from '@/components/editor/note-permissions'
import { useEditorLayoutPreferences } from '@/components/editor/useEditorLayoutPreferences'
import { appToast } from '@/lib/app-toast'
const TiptapEditor = dynamic(() => import('@/components/editor/TiptapEditor'), { ssr: false })

export interface NoteEditorShellProps {
  id: string
  initialData?: Note
  initialContent?: string
}

function NoteEditorShellInner({ id, initialData, initialContent }: NoteEditorShellProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [note, setNote] = useState<Note | null>(initialData ?? null)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [auxCategoryIds, setAuxCategoryIds] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({})
  const [metaLoading, setMetaLoading] = useState(true)
  const [metaError, setMetaError] = useState('')
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  const [currentContent, setCurrentContent] = useState(initialContent ?? initialData?.content ?? '')
  const [currentTitle, setCurrentTitle] = useState(initialData?.title ?? '')
  const [me, setMe] = useState<{ id: string; name: string }>({ id: 'me', name: '我' })
  const readOnly = !canWriteNote(note, me.id)
  const rejectReadOnlyWrite = useCallback(() => {
    if (!readOnly) return false
    appToast.error({ id: `permission:${id}`, title: '当前笔记仅可查看' })
    return true
  }, [id, readOnly])
  const [showCollabDrawer, setShowCollabDrawer] = useState(false)
  const [showCommentsDrawer, setShowCommentsDrawer] = useState(false)
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
  const { preferences, toggleLeft, toggleRight, setLeftWidth } = useEditorLayoutPreferences()
  const leftRestoreButtonRef = useRef<HTMLButtonElement>(null)
  const rightRestoreButtonRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; width: number } | null>(null)
  const [isResizingLeft, setIsResizingLeft] = useState(false)
  const [showMeta, setShowMeta] = useState(true)
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
      setShowInsertMenu(true)
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

  // 生成 HTML 大纲（用于 TipTap）
  const extractHeadingsFromHTML = useCallback((html: string) => {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const hs = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      const result = hs.map((h, i) => {
        const level = Number(h.tagName.substring(1))
        const text = (h.textContent || '').trim()
        const id = (h.id && h.id.trim()) || text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-').replace(/^-+|-+$/g, '') + '-' + i
        return { id, text, level }
      })
      setToc(prev => {
        if (prev.length !== result.length) return result
        for (let i = 0; i < prev.length; i++) {
          if (prev[i].id !== result[i].id || prev[i].text !== result[i].text || prev[i].level !== result[i].level) return result
        }
        return prev
      })
    } catch {
      setToc([])
    }
  }, [])

  // 读取当前用户信息用于协作指示
  useEffect(() => {
    const u = getCurrentUser()
    if (u) setMe({ id: u.id, name: u.email })
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
    const onCommentsHover = () => { setShowCommentsDrawer(true); setTimeout(() => { const input = document.getElementById('comment-input') as HTMLInputElement | null; input?.focus() }, 50) }
    const onCommentsOpen = () => { setShowCommentsDrawer(true); setTimeout(() => { const input = document.getElementById('comment-input') as HTMLInputElement | null; input?.focus() }, 50); try { document.dispatchEvent(new CustomEvent('comments:replay', { detail: { noteId: noteIdRef.current, strategy: 'context' } })) } catch { } }
    document.addEventListener('comments:hover', onCommentsHover as any)
    document.addEventListener('comments:open', onCommentsOpen as any)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('editor:toggleFullscreen', onToggle as any)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('comments:hover', onCommentsHover as any)
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
    if (!id || !shouldManageNoteLock(note, me.id)) return
    lockNote(id).catch(() => { })
    return () => { unlockNote(id).catch(() => { }) }
  }, [id, note, me.id])

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
      ? ((category as Category).id ||
        (category as unknown as { _id?: string })?._id)
      : '') || ''

  const normalizeCategoryValue = (value: unknown) => {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') {
      return (
        (value as { id?: string }).id ||
        (value as { _id?: string })._id ||
        ''
      );
    }
    return ''
  }

  const resolveTagId = (tag: Tag | string | Note['tags'][number]) => {
    if (typeof tag === 'string') return tag
    if (!tag) return ''
    return (
      (tag as Tag).id ||
      (tag as unknown as { _id?: string })?._id ||
      ''
    )
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
    auxCategoryIds,
    selectedTags,
    categories,
    tags,
    editorMode: 'rich',
    setNote: (updater) => setNote(prev => updater(prev)),
    setTags,
  })
  const handleSave = useCallback(async (title: string, content: string) => {
    if (rejectReadOnlyWrite()) return
    await persistNote(title, content)
  }, [persistNote, rejectReadOnlyWrite])
  const addTagsByNames = useCallback(async (names: string[]) => {
    if (rejectReadOnlyWrite()) return []
    return persistTags(names)
  }, [persistTags, rejectReadOnlyWrite])
  const { state: saveState, saveNow } = useEditorAutoSave({
    noteId: id,
    title: currentTitle,
    content: currentContent,
    enabled: Boolean(note) && !readOnly,
    save: handleSave,
    delayMs: 400,
  })

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

  const childrenByParent = (() => {
    const m: Record<string, Category[]> = {}
    categories.forEach(c => {
      const pid = (c.parentId || '')
      const key = pid || '__root__'
      if (!m[key]) m[key] = []
      m[key].push(c)
    })
    return m
  })()

  const renderCategoryNode = (cat: Category, level: number = 0) => {
    const id = resolveCategoryId(cat)
    const checked = auxCategoryIds.includes(id)
    const hasChildren = (childrenByParent[id] || []).length > 0
    const expanded = expandedCats[id]
    return (
      <div key={id || cat.name} className="py-1">
        <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 16}px` }}>
          {hasChildren && (
            <button
              type="button"
              onClick={() => setExpandedCats(prev => ({ ...prev, [id]: !prev[id] }))}
              className="h-5 w-5 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
              aria-label={expanded ? '折叠' : '展开'}
            >
              {expanded ? '▾' : '▸'}
            </button>
          )}
          {!hasChildren && <span className="h-5 w-5" />}
          <input
            type="checkbox"
            checked={checked}
            disabled={readOnly}
            onChange={(e) => {
              if (rejectReadOnlyWrite()) return
              const next = e.target.checked
                ? Array.from(new Set([...auxCategoryIds, id]))
                : auxCategoryIds.filter(x => x !== id)
              setAuxCategoryIds(next)
            }}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <span className="text-gray-700 text-sm">{cat.name}</span>
        </div>
        {hasChildren && expanded && (
          <div>
            {(childrenByParent[id] || []).map(child => renderCategoryNode(child, level + 1))}
          </div>
        )}
      </div>
    )
  }

  const handleBack = () => {
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

  const handleToggleRight = () => {
    const isCollapsing = !preferences.rightCollapsed
    toggleRight()
    if (isCollapsing) focusRestoreButton(rightRestoreButtonRef)
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

      <NoteEditorHeader
        note={note}
        readOnly={readOnly}
        editorMode="rich"
        leftCollapsed={preferences.leftCollapsed}
        rightCollapsed={preferences.rightCollapsed}
        onBack={handleBack}
        onModeChange={() => undefined}
        onVisibilityChange={async (visibility) => {
          if (rejectReadOnlyWrite()) return
          try {
            await updateNote(id, { visibility: visibility as any })
            await loadNote()
          } catch { }
        }}
        onToggleLeft={handleToggleLeft}
        onToggleRight={handleToggleRight}
        onOpenCollab={() => setShowCollabDrawer(true)}
        saveState={saveState}
      />
      {error && (
        <div
          className="p-4 text-sm text-red-600"
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
          }}
        >
          {error}
        </div>
      )}

      {/* 分类/标签等元信息 */}
      <div
        className="col-span-12 w-full"
        style={{
          borderRadius: '12px',
          boxShadow: 'var(--shadow-md)',
          background: 'var(--surface-1)'
        }}
      >
        <div
          role="button"
          tabIndex={0}
          className="flex items-center justify-between px-6 py-3 cursor-pointer select-none"
          style={{ borderBottom: showMeta ? '1px solid var(--border)' : 'none' }}
          onClick={() => setShowMeta(!showMeta)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowMeta(!showMeta) } }}
        >
          <span className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>笔记属性</span>
          <button className="text-gray-500 hover:text-gray-700">
            {showMeta ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {showMeta && (
          <div className="grid gap-6 p-6 lg:grid-cols-12" style={{ borderColor: 'var(--border)' }}>

            <div
              className="col-span-12 w-full"
              style={{
                borderRadius: '12px',
                boxShadow: 'none',
                background: 'transparent'
              }}
            >
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>选择分类</span>
                    {metaLoading && <span className="text-xs text-gray-400">加载中...</span>}
                  </div>
                  <select
                    className="w-full rounded-lg border p-3 text-sm"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
                    value={selectedCategory}
                    onChange={(e) => {
                      if (rejectReadOnlyWrite()) return
                      setSelectedCategory(e.target.value)
                    }}
                    disabled={readOnly || metaLoading || !!metaError}
                  >
                    <option value="">未分类</option>
                    {categories.map((category) => {
                      const value = resolveCategoryId(category)
                      return (
                        <option key={value || category.name} value={value}>
                          {category.name}
                        </option>
                      )
                    })}
                  </select>

                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>附属分类（仅用于标签）</span>
                    </div>
                    <div className="max-h-56 overflow-auto rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
                      {(childrenByParent['__root__'] || []).map(root => renderCategoryNode(root, 0))}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>标签（可多选）</span>
                    {metaLoading && <span className="text-xs text-gray-400">加载中...</span>}
                  </div>
                  <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={tagInput}
                      disabled={readOnly}
                      onChange={(e) => {
                        if (rejectReadOnlyWrite()) return
                        setTagInput(e.target.value)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (rejectReadOnlyWrite()) return
                          const parts = tagInput.split(/[,\s]+/)
                          setTagInput('')
                          addTagsByNames(parts)
                        }
                      }}
                      placeholder="输入标签，Enter 添加，支持逗号分隔"
                      className="min-w-0 flex-1 rounded-lg border p-2 text-sm placeholder-muted"
                      style={{ borderColor: 'var(--interactive-border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
                    />
                    <button
                      disabled={readOnly}
                      className="whitespace-nowrap rounded-lg border px-3 py-2 text-sm transition hover:bg-[var(--surface-2)]"
                      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
                      onClick={() => {
                        if (rejectReadOnlyWrite()) return
                        setSelectedTags([])
                      }}
                    >清空标签</button>
                  </div>
                  {tagInput && (
                    <div className="mb-2 rounded-lg border p-2 shadow-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
                      <div className="text-xs text-gray-500 mb-1">建议</div>
                      <div className="flex flex-wrap gap-2">
                        {tags.filter(t => t.name.toLowerCase().includes(tagInput.toLowerCase())).slice(0, 10).map(t => {
                          const id = (t.id || (t as unknown as { _id?: string })?._id || '')
                          return (
                            <button key={id || t.name} type="button" disabled={readOnly || !id} onClick={() => id && toggleTag(id)} className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--on-surface)', background: 'var(--surface-1)' }}>
                              {t.name}
                            </button>
                          )
                        })}
                        <button type="button" disabled={readOnly} onClick={() => { if (rejectReadOnlyWrite()) return; void addTagsByNames([tagInput]); setTagInput('') }} className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--on-surface)', background: 'var(--surface-1)' }}>
                          创建标签 “{tagInput}”
                        </button>
                      </div>
                    </div>
                  )}
                  {tags.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      {metaError || '暂无可用标签'}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => {
                        const tagId =
                          tag.id ||
                          (tag as unknown as { _id?: string })?._id ||
                          ''
                        const isActive = tagId ? selectedTags.includes(tagId) : false
                        return (
                          <button
                            key={tagId || tag.name}
                            type="button"
                            onClick={() => tagId && toggleTag(tagId)}
                            disabled={readOnly || !tagId}
                            className="rounded-full border px-3 py-1 text-sm transition"
                            style={{
                              ...(isActive
                                ? { borderColor: 'var(--primary-100)', background: 'var(--primary-50)', color: 'var(--primary-600)' }
                                : { borderColor: 'var(--border)', color: 'var(--on-surface)' }),
                              minHeight: 44,
                            }}
                          >
                            {tag.name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {metaError && (
                  <p className="md:col-span-2 text-sm text-red-500">{metaError}</p>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
      <div
        className="editor-layout-grid"
        data-right-collapsed={preferences.rightCollapsed}
        style={{
          '--editor-left-width': `${preferences.leftCollapsed ? 52 : preferences.leftWidth}px`,
          '--editor-right-width': preferences.rightCollapsed ? '52px' : '240px',
        } as React.CSSProperties}
      >
        <aside id="editor-left-navigation" className="editor-left-navigation" aria-label="左侧导航">
          {preferences.leftCollapsed ? (
            <button
              ref={leftRestoreButtonRef}
              type="button"
              className="editor-layout-restore-button"
              aria-label="展开左侧导航"
              title="展开左侧导航"
              onClick={handleToggleLeft}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                handleToggleLeft()
              }}
            >
              导航
            </button>
          ) : (
            <div className="editor-left-navigation__content">
              <p className="text-sm font-medium">笔记导航</p>
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>使用页头按钮收起导航以扩大编辑空间。</p>
            </div>
          )}
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
        </aside>
        <div className="editor-layout-main">
          <div ref={editorContainerRef} className="editor-rich-editor" style={isFullscreen ? { position: 'fixed', inset: 0, zIndex: 50, width: '100vw', height: '100vh', background: 'var(--bg)' } : undefined}>
              <TiptapToolbar disabled={readOnly} isFullscreen={isFullscreen} exec={(cmd, payload) => {
                if (cmd === 'collab') { setShowCollabDrawer(true); return }
                if (cmd === 'fullscreen') { handleToggleFullscreen(); return }
                if (rejectReadOnlyWrite()) return
                if (cmd === 'link' && !payload) { setShowLinkDialog(true); return }
                if (cmd === 'comments') {
                  try {
                    setShowCommentsDrawer(true)
                    const openEvt = new CustomEvent('comments:open')
                    document.dispatchEvent(openEvt)
                    if (selection && typeof selection.start === 'number' && typeof selection.end === 'number' && selection.start !== selection.end) {
                      const markEvt = new CustomEvent('comments:mark', { detail: { start: selection.start, end: selection.end, commentId: `local-${Date.now()}` } })
                      document.dispatchEvent(markEvt)
                    }
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
                onContentChange={(html) => {
                  extractHeadingsFromHTML(html)
                  if (readOnly) return
                  setCurrentContent(html)
                }}
                // 仅在恢复版本时传递 versionKey，避免常规编辑时因 updatedAt 变化导致房间切换
                versionKey={searchParams?.get('restored') || undefined}
                updatedAt={note.updatedAt}
                className="min-h-[calc(100vh-200px)]"
                />
              </div>
          </div>
        </div>
        <NoteEditorMetadataPanel
          id={id}
          toc={toc}
          collapsed={preferences.rightCollapsed}
          isFullscreen={isFullscreen}
          onToggle={handleToggleRight}
          restoreButtonRef={rightRestoreButtonRef}
        />
      </div>

      <NoteEditorDrawers
        id={id}
        selection={selection}
        showCollabDrawer={showCollabDrawer}
        showCommentsDrawer={showCommentsDrawer}
        commentsDrawerRef={commentsDrawerRef as React.RefObject<HTMLDivElement>}
        onCloseCollab={() => setShowCollabDrawer(false)}
        onCloseComments={() => setShowCommentsDrawer(false)}
        readOnly={readOnly}
      />
      {!isFullscreen && !readOnly && (
        <>
          {showInsertMenu && (
            <div className="fixed right-4 bottom-56 z-50 rounded-xl border bg-white shadow-xl sm:right-6"
              role="menu" aria-label="插入工具菜单"
              style={{ minWidth: 220 }}
            >
              <div className="p-2 grid" style={{ rowGap: 6 }}>
                <button role="menuitem" className="text-left px-3 py-2 hover:bg-gray-50" onClick={() => { setShowInsertMenu(false); const el = document.getElementById('editor-image-input') as HTMLInputElement | null; el?.click() }}>图片</button>
                <button role="menuitem" className="text-left px-3 py-2 hover:bg-gray-50" onClick={() => { setShowInsertMenu(false); document.dispatchEvent(new CustomEvent('tiptap:exec', { detail: { cmd: 'table' } })) }}>表格</button>
                <button role="menuitem" className="text-left px-3 py-2 hover:bg-gray-50" onClick={() => { setShowInsertMenu(false); setShowLinkDialog(true) }}>链接</button>
                <button role="menuitem" className="text-left px-3 py-2 hover:bg-gray-50" onClick={() => { setShowInsertMenu(false); document.dispatchEvent(new CustomEvent('tiptap:exec', { detail: { cmd: 'status', payload: { text: '状态：进行中' } } })) }}>状态</button>
                <button role="menuitem" className="text-left px-3 py-2 hover:bg-gray-50" onClick={async () => {
                  setShowInsertMenu(false)
                  try {
                    const res = await boardsAPI.create({ title: '画板', noteId: id })
                    document.dispatchEvent(new CustomEvent('tiptap:exec', {
                      detail: {
                        cmd: 'insertResource',
                        payload: { type: 'board', id: res.id }
                      }
                    }))
                  } catch { }
                }}>画板</button>
                <button role="menuitem" className="text-left px-3 py-2 hover:bg-gray-50" onClick={async () => {
                  setShowInsertMenu(false)
                  try {
                    const res = await mindmapsAPI.create({ title: '思维导图', noteId: id })
                    // 使用 insertResource 命令直接插入卡片
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

export default function NoteEditorShell(props: NoteEditorShellProps) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" /></div>}>
      <NoteEditorShellInner {...props} />
    </Suspense>
  )
}
