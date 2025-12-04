'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { fetchNoteById, fetchCategories, fetchTags, updateNote, createTag, lockNote, unlockNote } from '@/lib/api'
import dynamic from 'next/dynamic'
const MarkdownEditor = dynamic(() => import('@/components/editor/MarkdownEditor'), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-gray-100 h-[500px] rounded" />,
})
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import type { Note, Category, Tag } from '@/types'
import { CollaboratorsPanel } from '@/components/collab/CollaboratorsPanel'
import { CommentsPanel } from '@/components/collab/CommentsPanel'
const TiptapEditor = dynamic(() => import('@/components/editor/TiptapEditor'), { ssr: false })

export default function EditNotePage() {
  const router = useRouter()
  const params = useParams()
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

  const loadNote = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchNoteById(id)
      setNote(data)
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
      )
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
      } catch (e) { }
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
    } catch (error) {
      console.error('Failed to update note:', error)
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
    } catch (error) {
      console.error('Failed to update draft note:', error)
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1
            className="text-2xl font-bold"
            style={{
              background: 'linear-gradient(to right, #111827, #2563eb, #111827)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            编辑笔记
          </h1>
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

      {/* 协作区块：放在编辑器上方，保证可见 */}
      <div
        className="bg-white"
        style={{
          borderRadius: '12px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div className="grid gap-6 p-6 md:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">协作</div>
              <a href={`/dashboard/notes/${id}/versions`} className="text-xs text-blue-600">查看版本</a>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">可见性</span>
              <select
                className="rounded border px-2 py-1 text-xs"
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
            <CollaboratorsPanel noteId={id} />
          </div>
          <div className="space-y-3">
            <CommentsPanel noteId={id} selection={selection} />
          </div>
        </div>
      </div>

      <div
        className="bg-white"
        style={{
          borderRadius: '12px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div className="grid gap-6 border-b border-gray-100 p-6 md:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">选择分类</span>
              {metaLoading && <span className="text-xs text-gray-400">加载中...</span>}
            </div>
            <select
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
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
                <span className="text-sm font-medium text-gray-700">附属分类（仅用于标签）</span>
              </div>
              <div className="max-h-56 overflow-auto rounded-lg border border-gray-200 p-3">
                {(childrenByParent['__root__'] || []).map(root => renderCategoryNode(root, 0))}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">标签（可多选）</span>
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
                className="flex-1 rounded-lg border border-gray-200 p-2 text-sm"
              />
              <button
                className="px-3 py-1 rounded border text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => setSelectedTags([])}
              >清空标签</button>
            </div>
            {tagInput && (
              <div className="mb-2 rounded-lg border border-gray-200 p-2 bg-white shadow-sm">
                <div className="text-xs text-gray-500 mb-1">建议</div>
                <div className="flex flex-wrap gap-2">
                  {tags.filter(t => t.name.toLowerCase().includes(tagInput.toLowerCase())).slice(0, 10).map(t => {
                    const id = (t.id || (t as unknown as { _id?: string })?._id || '')
                    return (
                      <button key={id || t.name} type="button" onClick={() => id && toggleTag(id)} className="rounded-full border px-3 py-1 text-xs hover:border-blue-300 hover:text-blue-600">
                        {t.name}
                      </button>
                    )
                  })}
                  <button type="button" onClick={() => { addTagsByNames([tagInput]); setTagInput('') }} className="rounded-full border px-3 py-1 text-xs text-gray-700 hover:bg-gray-50">
                    创建标签 “{tagInput}”
                  </button>
                </div>
              </div>
            )}
            {tags.length === 0 ? (
              <p className="text-sm text-gray-400">
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
                      className={`rounded-full border px-3 py-1 text-sm transition ${isActive
                        ? 'border-blue-500 bg-blue-50 text-blue-600 shadow-sm'
                        : 'border-gray-200 text-gray-600 hover:border-blue-200 hover:text-blue-500'
                        }`}
                      style={{ minHeight: 44 }}
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
          </div>
        </div>
        {editorMode === 'rich' ? (
          <TiptapEditor
            noteId={id}
            initialHTML={note.content || '<p></p>'}
            onSave={async (html: string) => { await handleSave(note.title || '', html) }}
            user={{ id: 'me', name: '我' }}
            readOnly={false}
            onSelectionChange={(start, end) => setSelection({ start, end })}
          />
        ) : (
          <MarkdownEditor
            initialContent={note.content || ''}
            initialTitle={note.title || ''}
            onSave={handleSave}
            onSaveDraft={handleSaveDraft}
            isNew={false}
            draftKey={`note:${id}`}
            onSelectionChange={(start, end) => setSelection({ start, end })}
          />
        )}
      </div>
    </div>
  )
}
