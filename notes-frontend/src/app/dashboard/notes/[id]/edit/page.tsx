'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { fetchNoteById, fetchCategories, fetchTags, updateNote, createTag, lockNote, unlockNote, boardsAPI, mindmapsAPI, assetsAPI } from '@/lib/api'
import dynamic from 'next/dynamic'
const MarkdownEditor = dynamic(() => import('@/components/editor/MarkdownEditor'), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-gray-100 h-[500px] rounded" />,
})
import { Button } from '@/components/ui/button'
import { ArrowLeft, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import type { Note, Category, Tag } from '@/types'
import { CollaboratorsPanel } from '@/components/collab/CollaboratorsPanel'
import { CommentsPanel } from '@/components/collab/CommentsPanel'
import { getCurrentUser } from '@/lib/auth'
import TiptapToolbar from '@/components/editor/TiptapToolbar'
const TiptapEditor = dynamic(() => import('@/components/editor/TiptapEditor'), { ssr: false })

export default function EditNotePage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const id = params?.id as string
  const [note, setNote] = useState<Note | null>(null)
  const [loading, setLoading] = useState(true)
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
  const [editorMode, setEditorMode] = useState<'rich' | 'markdown'>('rich')
  const [uiDegraded, setUiDegraded] = useState<boolean>(false)
  const [me, setMe] = useState<{ id: string; name: string }>({ id: 'me', name: '我' })
  const [showCollabDrawer, setShowCollabDrawer] = useState(false)
  const [showCommentsDrawer, setShowCommentsDrawer] = useState(false)
  const commentsDrawerRef = useRef<HTMLDivElement>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)
  const [toc, setToc] = useState<Array<{ id: string; text: string; level: number }>>([])
  const [currentHeadingId, setCurrentHeadingId] = useState<string>('')
  const [showSidebar, setShowSidebar] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const [showInsertMenu, setShowInsertMenu] = useState(false)
  const [showLinkDialog, setShowLinkDialog] = useState(false)
  const [linkHref, setLinkHref] = useState('https://')
  useEffect(() => {
    const open = () => setShowLinkDialog(true)
    document.addEventListener('open:link-dialog', open as any)
    return () => { document.removeEventListener('open:link-dialog', open as any) }
  }, [])

  // 生成 Markdown 大纲
  const extractHeadingsFromMarkdown = useCallback((md: string) => {
    const lines = md.split(/\n+/)
    const result: Array<{ id: string; text: string; level: number }> = []
    for (const line of lines) {
      const m = /^(#{1,6})\s+(.+)$/.exec(line.trim())
      if (m) {
        const level = m[1].length
        const text = m[2].trim()
        const id = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-').replace(/^-+|-+$/g, '') + '-' + result.length
        result.push({ id, text, level })
      }
    }
    setToc(result)
  }, [])

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
      setToc(result)
    } catch {
      setToc([])
    }
  }, [])

  // 读取当前用户信息用于协作指示
  useEffect(() => {
    const u = getCurrentUser()
    if (u) setMe({ id: u.id, name: u.email })
  }, [])

  // UI 降级：依据设备/网络/可及性偏好自动选择轻量模式，并上报 RUM 事件
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
        setEditorMode('markdown')
        setUiDegraded(true)
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

  // RUM：编辑器模式切换事件
  useEffect(() => {
    try {
      const evt = new CustomEvent('rum', { detail: { type: 'collab', name: 'editor_mode_change', meta: { mode: editorMode, noteId: id } } })
      document.dispatchEvent(evt)
    } catch { }
  }, [editorMode, id])

  // 评论弹窗可访问性：聚焦管理与键盘陷阱
  useEffect(() => {
    if (!showCommentsModal) return
    const dialog = commentsDialogRef.current
    if (!dialog) return
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    first?.focus()

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setShowCommentsModal(false)
      }
      if (e.key === 'Tab') {
        if (focusable.length === 0) return
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last?.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first?.focus()
        }
      }
    }
    dialog.addEventListener('keydown', handleKey)
    return () => { dialog.removeEventListener('keydown', handleKey) }
  }, [showCommentsModal])

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
        setShowSidebar(false)
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
        } else if (isFullscreen) {
          setIsFullscreen(false)
          document.body.style.overflow = ''
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        handleToggleFullscreen()
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    const onToggle = () => { handleToggleFullscreen() }
    document.addEventListener('editor:toggleFullscreen', onToggle as any)
    document.addEventListener('keydown', onKey)
    const onCommentsHover = () => { setShowCommentsDrawer(true); setTimeout(() => { const input = document.getElementById('comment-input') as HTMLInputElement | null; input?.focus() }, 50) }
    const onCommentsOpen = () => { setShowCommentsDrawer(true); setTimeout(() => { const input = document.getElementById('comment-input') as HTMLInputElement | null; input?.focus() }, 50); try { document.dispatchEvent(new CustomEvent('comments:replay', { detail: { noteId: id, strategy: 'context' } })) } catch { } }
    document.addEventListener('comments:hover', onCommentsHover as any)
    document.addEventListener('comments:open', onCommentsOpen as any)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('editor:toggleFullscreen', onToggle as any)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('comments:hover', onCommentsHover as any)
      document.removeEventListener('comments:open', onCommentsOpen as any)
    }
  }, [])

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

  const openCommentsModal = () => {
    lastFocusRef.current = document.activeElement as HTMLElement
    setShowCommentsModal(true)
  }

  const loadNote = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchNoteById(id)
      setNote(data)
      // 根据内容类型自动选择编辑器模式：Markdown 快照回退后避免富文本空白
      try {
        const raw = String(data?.content || '')
        const isLikelyHTML = /<\/?[a-z][\s\S]*>/i.test(raw)
        const isLikelyMarkdown = /(\n|^)\s{0,3}(#{1,6}\s+|[-*]\s+|\d+\.\s+|`{3,}|>|\[.+\]\(.+\))/m.test(raw)
        // 若此前因 UI 降级已选择 markdown，则不强制改回
        setEditorMode(prev => {
          if (prev === 'markdown') return prev
          return (!isLikelyHTML && isLikelyMarkdown) ? 'markdown' : 'rich'
        })
      } catch { }
      try { document.dispatchEvent(new CustomEvent('editor:setContent', { detail: { html: String(data?.content || '<p></p>') } })) } catch { }
      setError('')
    } catch (err) {
      setError('加载笔记失败')
      console.error('Failed to load note:', err)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadNote()
  }, [loadNote])

  useEffect(() => {
    if (!id) return
    lockNote(id).catch(() => { })
    return () => { unlockNote(id).catch(() => { }) }
  }, [id])

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
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
  }

  const addTagsByNames = async (names: string[]) => {
    const trimmed = Array.from(new Set(names.map(n => n.trim()).filter(Boolean)))
    if (trimmed.length === 0) return
    const mapByName = new Map<string, Tag>()
    tags.forEach(t => mapByName.set(String(t.name).toLowerCase(), t))
    const resultIds: string[] = []
    for (const name of trimmed) {
      const key = name.toLowerCase()
      const hit = mapByName.get(key)
      if (hit) {
        const id = hit.id || (hit as unknown as { _id?: string })?._id || ''
        if (id) resultIds.push(id)
        continue
      }
      try {
        const created = await createTag(name)
        const id = created.id || (created as unknown as { _id?: string })?._id || ''
        if (id) {
          resultIds.push(id)
          setTags(prev => [{ ...created, id }, ...prev])
        }
      } catch { }
    }
    if (resultIds.length > 0) {
      setSelectedTags(prev => Array.from(new Set([...prev, ...resultIds])))
    }
  }

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
            onChange={(e) => {
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

  const handleSave = async (title: string, content: string) => {
    try {
      const auxNames = auxCategoryIds
        .map(id => categories.find(c => (c.id || (c as unknown as { _id?: string })?._id) === id)?.name)
        .filter((n): n is string => Boolean(n))
      if (auxNames.length > 0) {
        await addTagsByNames(auxNames)
      }
      const updatedNote = await updateNote(id, {
        title: title.trim(),
        content: content.trim(),
        categoryId: selectedCategory || undefined,
        categoryIds: auxCategoryIds.length > 0 ? auxCategoryIds : undefined,
        tags: selectedTags,
      })
      setNote(updatedNote)
      try {
        const evt = new CustomEvent('rum', { detail: { type: 'network', name: 'note_save_ok', meta: { noteId: id, size: (content || '').length, mode: editorMode } } })
        document.dispatchEvent(evt)
      } catch { }
    } catch (error) {
      console.error('Failed to update note:', error)
      try {
        const evt = new CustomEvent('rum', { detail: { type: 'network', name: 'note_save_error', meta: { noteId: id, message: String((error as any)?.message || error), mode: editorMode } } })
        document.dispatchEvent(evt)
      } catch { }
      throw new Error('保存失败，请重试')
    }
  }

  const handleSaveDraft = async (title: string, content: string) => {
    try {
      const auxNames = auxCategoryIds
        .map(id => categories.find(c => (c.id || (c as unknown as { _id?: string })?._id) === id)?.name)
        .filter((n): n is string => Boolean(n))
      if (auxNames.length > 0) {
        await addTagsByNames(auxNames)
      }
      const updatedNote = await updateNote(id, {
        title: title.trim(),
        content: content.trim(),
        categoryId: selectedCategory || undefined,
        categoryIds: auxCategoryIds.length > 0 ? auxCategoryIds : undefined,
        tags: selectedTags,
        status: 'draft',
      })
      setNote(updatedNote)
      try {
        const evt = new CustomEvent('rum', { detail: { type: 'network', name: 'note_save_draft_ok', meta: { noteId: id, size: (content || '').length, mode: editorMode } } })
        document.dispatchEvent(evt)
      } catch { }
    } catch (error) {
      console.error('Failed to update draft note:', error)
      try {
        const evt = new CustomEvent('rum', { detail: { type: 'network', name: 'note_save_draft_error', meta: { noteId: id, message: String((error as any)?.message || error), mode: editorMode } } })
        document.dispatchEvent(evt)
      } catch { }
      throw new Error('保存草稿失败，请重试')
    }
  }

  const handleBack = () => {
    router.push('/dashboard/notes')
  }

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
    <div className="space-y-6 mx-auto w-full max-w-[1400px] px-4">

      {/* 顶部固定工具栏（语雀风格） */}
      <div className="sticky top-0 z-40 backdrop-blur border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              className="text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm" style={{ color: 'var(--on-surface)' }}>编辑笔记</span>
            <div className="hidden md:flex items-center gap-3 ml-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>编辑器</span>
              <select className="rounded border px-2 py-1 text-xs" value={editorMode} onChange={e => setEditorMode(e.target.value as any)} style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}>
                <option value="rich">富文本（协同）</option>
                <option value="markdown">Markdown</option>
              </select>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>可见性</span>
              <select
                className="rounded border px-2 py-1 text-xs"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
                value={(note as any)?.visibility || 'private'}
                onChange={async (e) => {
                  try {
                    await updateNote(id, { visibility: e.target.value as any })
                    await loadNote()
                  } catch { }
                }}
              >
                <option value="private">仅自己</option>
                <option value="org">组织内</option>
                <option value="public">公开只读</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={!showSidebar}
              onClick={() => setShowSidebar(s => !s)}
              className="hover:bg-[var(--surface-2)]"
            >
              {showSidebar ? (
                <span className="inline-flex items-center gap-1"><ChevronRight className="h-4 w-4" /> 隐藏侧栏</span>
              ) : (
                <span className="inline-flex items-center gap-1"><ChevronLeft className="h-4 w-4" /> 显示侧栏</span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="协作"
              title="协作"
              onClick={() => setShowCollabDrawer(true)}
              className="hover:bg-[var(--surface-2)]"
            >
              <Users className="h-5 w-5" />
              <span className="sr-only">协作</span>
            </Button>
          </div>
        </div>
      </div>
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
        <div className="grid gap-6 border-b p-6 lg:grid-cols-12" style={{ borderColor: 'var(--border)' }}>

          <div
            className="col-span-12 w-full"
            style={{
              borderRadius: '12px',
              boxShadow: 'var(--shadow-md)',
              background: 'var(--surface-1)'
            }}
          >
            <div className="grid gap-6 border-b p-6 md:grid-cols-2" style={{ borderColor: 'var(--border)' }}>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>选择分类</span>
                  {metaLoading && <span className="text-xs text-gray-400">加载中...</span>}
                </div>
                <select
                  className="w-full rounded-lg border p-3 text-sm"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  disabled={metaLoading || !!metaError}
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
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const parts = tagInput.split(/[,\s]+/)
                        setTagInput('')
                        addTagsByNames(parts)
                      }
                    }}
                    placeholder="输入标签，Enter 添加，支持逗号分隔"
                    className="flex-1 rounded-lg border p-2 text-sm placeholder-muted"
                    style={{ borderColor: 'var(--interactive-border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
                  />
                  <button
                    className="px-3 py-1 rounded border text-sm"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
                    onClick={() => setSelectedTags([])}
                  >清空标签</button>
                </div>
                {tagInput && (
                  <div className="mb-2 rounded-lg border p-2 shadow-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
                    <div className="text-xs text-gray-500 mb-1">建议</div>
                    <div className="flex flex-wrap gap-2">
                      {tags.filter(t => t.name.toLowerCase().includes(tagInput.toLowerCase())).slice(0, 10).map(t => {
                        const id = (t.id || (t as unknown as { _id?: string })?._id || '')
                        return (
                          <button key={id || t.name} type="button" onClick={() => id && toggleTag(id)} className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--on-surface)', background: 'var(--surface-1)' }}>
                            {t.name}
                          </button>
                        )
                      })}
                      <button type="button" onClick={() => { addTagsByNames([tagInput]); setTagInput('') }} className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--on-surface)', background: 'var(--surface-1)' }}>
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
                          disabled={!tagId}
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

            <div className="px-6 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">编辑器</span>
                <select className="rounded border px-2 py-1 text-xs" value={editorMode} onChange={e => setEditorMode(e.target.value as any)}>
                  <option value="rich">富文本（协同）</option>
                  <option value="markdown">Markdown</option>
                </select>
                {uiDegraded && (
                  <span className="ml-2 text-[11px] px-2 py-0.5 rounded bg-yellow-50 border border-yellow-200 text-yellow-700">已自动降级为轻量模式，可手动切换</span>
                )}
              </div>
            </div>
            <div className="grid gap-6 p-6 lg:grid-cols-12 xl:grid-cols-12">
              <div className={showSidebar ? 'lg:col-span-10 xl:col-span-9' : 'lg:col-span-12 xl:col-span-12'}>
                {editorMode === 'rich' ? (
                  <div ref={editorContainerRef} className="space-y-3" style={isFullscreen ? { position: 'fixed', inset: 0, zIndex: 50, width: '100vw', height: '100vh', background: 'transparent' } : undefined}>
                    <TiptapToolbar disabled={false} isFullscreen={isFullscreen} exec={(cmd, payload) => {
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
                      if (cmd === 'fullscreen') { handleToggleFullscreen(); return }
                      const ev = new CustomEvent('tiptap:exec', { detail: { cmd, payload } })
                      document.dispatchEvent(ev)
                    }} />
                    <TiptapEditor
                      noteId={id}
                      initialHTML={note.content || '<p></p>'}
                      onSave={async (html: string) => { await handleSave(note.title || '', html) }}
                      user={me}
                      readOnly={false}
                      onSelectionChange={(start, end) => setSelection({ start, end })}
                      onContentChange={(html) => extractHeadingsFromHTML(html)}
                      versionKey={(searchParams?.get('restored') || '') || String(note.updatedAt || '')}
                    />
                  </div>
                ) : (
                  <MarkdownEditor
                    initialContent={note.content || ''}
                    initialTitle={note.title || ''}
                    onSave={handleSave}
                    onSaveDraft={handleSaveDraft}
                    isNew={false}
                    draftKey={`note:${id}`}
                    onSelectionChange={(start, end) => setSelection({ start, end })}
                    onContentChange={(content) => extractHeadingsFromMarkdown(content)}
                  />
                )}
              </div>
              {showSidebar && !isFullscreen && (
                <div className="lg:col-span-2 xl:col-span-3">
                  <div className="sticky top-20 space-y-3">
                    <div className="rounded-lg border bg-white">
                      <div className="px-4 py-2 border-b text-sm font-medium">大纲</div>
                      <div className="p-3">
                        {toc.length === 0 ? (
                          <div className="text-xs text-gray-400">暂无标题</div>
                        ) : (
                          <div className="space-y-1">
                            {toc.map((h) => (
                              <button
                                key={h.id}
                                onClick={() => {
                                  const el = document.getElementById(h.id)
                                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                }}
                                className={`w-full text-left text-xs rounded px-3 py-2 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 ${currentHeadingId === h.id ? 'text-blue-600' : 'text-gray-700'}`}
                                style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
                              >
                                {h.text}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border bg-white">
                      <div className="px-4 py-2 border-b text-sm font-medium flex items-center justify-between">
                        <span>快速操作</span>
                        <a href={`/dashboard/notes/${id}/versions`} className="text-xs text-blue-600">版本</a>
                      </div>
                      <div className="p-3 text-xs text-gray-500">
                        在上方工具栏打开“协作抽屉”查看评论与协作者。
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 右侧协作抽屉（不包含评论内容） */}
          {showCollabDrawer && (
            <div className="fixed inset-0 z-50" aria-modal="true" role="dialog">
              <div
                className="absolute inset-0 bg-black/20"
                role="button"
                tabIndex={0}
                onClick={() => setShowCollabDrawer(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setShowCollabDrawer(false)
                }}
              />
              <div className="absolute right-0 top-0 h-full w-[360px] bg-white border-l shadow-xl">
                <div className="flex items-center justify-between px-4 py-2 border-b">
                  <div className="text-sm font-medium">协作</div>
                  <button className="text-gray-500 hover:text-gray-700 text-sm" onClick={() => setShowCollabDrawer(false)}>关闭</button>
                </div>
                <div className="p-4 space-y-4 overflow-auto h-full">
                  <div className="rounded-lg border">
                    <div className="px-3 py-2 border-b text-xs font-medium">协作者</div>
                    <div className="p-3">
                      <CollaboratorsPanel noteId={id} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* 右侧评论抽屉（独立） */}
          {showCommentsDrawer && (
            <div className="fixed inset-0 z-50" aria-modal="true" role="dialog" aria-labelledby="comments-drawer-title">
              <div
                className="absolute inset-0 bg-black/20"
                role="button"
                tabIndex={0}
                onClick={() => setShowCommentsDrawer(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setShowCommentsDrawer(false)
                }}
              />
              <div
                ref={commentsDrawerRef}
                id="comments-drawer"
                className="absolute right-0 top-0 h-full w-[380px] bg-white border-l shadow-xl"
                style={{
                  borderRadius: 0,
                  transform: 'translateX(0)',
                  transition: 'transform 300ms ease-in-out',
                }}
              >
                <div className="flex items-center justify-between px-4 py-2 border-b">
                  <div id="comments-drawer-title" className="text-sm font-medium">划词评论</div>
                  <div className="text-xs text-gray-500">选区：{selection.start}–{selection.end}（长度 {Math.max(0, selection.end - selection.start)}）</div>
                  <button className="text-gray-500 hover:text-gray-700 text-sm" onClick={() => setShowCommentsDrawer(false)}>关闭</button>
                </div>
                <div className="p-4 overflow-auto h-full">
                  <div className="rounded-lg border" style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-md)' }}>
                    <div className="p-3">
                      <CommentsPanel noteId={id} selection={selection} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* 浮动协作按钮（语雀风格蓝色悬浮锚点） */}
          <button
            aria-label="打开协作抽屉"
            className="fixed right-6 bottom-24 z-40 rounded-full shadow-xl active-95"
            onClick={() => setShowCollabDrawer(true)}
            style={{ width: '48px', height: '48px', backgroundColor: '#2468F2', color: '#fff' }}
          >
            <span className="sr-only">打开协作抽屉</span>
            •
          </button>
          {/* 左侧浮动 “+” 插入菜单 */}
          {!isFullscreen && (
            <>
              <button
                aria-label="插入工具"
                className="fixed left-6 bottom-24 z-40 rounded-full shadow-xl active-95"
                onClick={() => setShowInsertMenu(s => !s)}
                style={{ width: '48px', height: '48px', backgroundColor: '#10b981', color: '#fff' }}
              >
                +
              </button>
              {showInsertMenu && (
                <div className="fixed left-6 bottom-40 z-50 rounded-xl border bg-white shadow-xl"
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
                        const res = await boardsAPI.create('画板', id)
                        const link = `/dashboard/boards/${res.id}`
                        const label = String(res?.title || '画板')
                        document.dispatchEvent(new CustomEvent('tiptap:exec', { detail: { cmd: 'link', payload: { href: link, label } } }))
                      } catch { }
                    }}>画板</button>
                    <button role="menuitem" className="text-left px-3 py-2 hover:bg-gray-50" onClick={async () => {
                      setShowInsertMenu(false)
                      try {
                        const res = await mindmapsAPI.create('思维导图', id)
                        const link = `/dashboard/mindmaps/${res.id}`
                        const label = String(res?.title || '思维导图')
                        document.dispatchEvent(new CustomEvent('tiptap:exec', { detail: { cmd: 'link', payload: { href: link, label } } }))
                      } catch { }
                    }}>思维导图</button>
                    <button role="menuitem" className="text-left px-3 py-2 hover:bg-gray-50" onClick={async () => {
                      setShowInsertMenu(false)
                      try {
                        const input = document.createElement('input')
                        input.type = 'file'
                        input.onchange = async () => {
                          const f = input.files?.[0]
                          if (!f) return
                          const reader = new FileReader()
                          reader.onload = async () => {
                            const dataUri = String(reader.result || '')
                            const r = await assetsAPI.uploadBase64(f.name, dataUri, id)
                            const href = r?.url || dataUri
                            document.dispatchEvent(new CustomEvent('tiptap:exec', { detail: { cmd: 'link', payload: { href } } }))
                          }
                          reader.readAsDataURL(f)
                        }
                        input.click()
                      } catch { }
                    }}>附件</button>
                  </div>
                </div>
              )}
            </>
          )}
          {/* 插入链接对话框 */}
          {showLinkDialog && (
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
      </div>
    </div>
  );

}
