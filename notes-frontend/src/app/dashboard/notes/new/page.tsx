'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createNote, fetchCategories, fetchTags, createTag } from '@/lib/api'
import MarkdownEditor from '@/components/editor/MarkdownEditor'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import type { Category, Tag } from '@/types'

export default function NewNotePage() {
  const router = useRouter()
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [auxCategoryIds, setAuxCategoryIds] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({})
  const [metaLoading, setMetaLoading] = useState(true)
  const [metaError, setMetaError] = useState('')

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
      } catch (error) {
        console.error('Failed to load categories or tags:', error)
        setMetaError('无法加载分类或标签，请稍后重试')
      } finally {
        setMetaLoading(false)
      }
    }

    loadMeta()
  }, [])

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
  }

  const resolveCategoryId = (category: Category) =>
    category.id ||
    (category as unknown as { _id?: string })?._id ||
    ''

  const resolveTagId = (tag: Tag) =>
    tag.id || (tag as unknown as { _id?: string })?._id || ''

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
        const id = resolveTagId(hit)
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
    if (!title.trim()) {
      throw new Error('请输入笔记标题')
    }

    try {
      const auxNames = auxCategoryIds
        .map(id => categories.find(c => resolveCategoryId(c) === id)?.name)
        .filter((n): n is string => Boolean(n))
      if (auxNames.length > 0) {
        await addTagsByNames(auxNames)
      }
      const newNote = await createNote({
        title: title.trim(),
        content: content.trim(),
        categoryId: selectedCategory || undefined,
        categoryIds: auxCategoryIds.length > 0 ? auxCategoryIds : undefined,
        tags: selectedTags,
      })
      router.push(`/dashboard/notes/${newNote.id}`)
    } catch (error) {
      console.error('Failed to create note:', error)
      throw new Error('创建笔记失败，请重试')
    }
  }

  const handleSaveDraft = async (title: string, content: string) => {
    if (!title.trim()) {
      throw new Error('请输入笔记标题')
    }
    try {
      const auxNames = auxCategoryIds
        .map(id => categories.find(c => resolveCategoryId(c) === id)?.name)
        .filter((n): n is string => Boolean(n))
      if (auxNames.length > 0) {
        await addTagsByNames(auxNames)
      }
      const newNote = await createNote({
        title: title.trim(),
        content: content.trim(),
        categoryId: selectedCategory || undefined,
        categoryIds: auxCategoryIds.length > 0 ? auxCategoryIds : undefined,
        tags: selectedTags,
        status: 'draft'
      })
      router.push(`/dashboard/notes/${newNote.id}`)
    } catch (error) {
      console.error('Failed to create draft note:', error)
      throw new Error('保存草稿失败，请重试')
    }
  }

  const handleCancel = () => {
    if (window.confirm('确定要放弃编辑吗？未保存的内容将丢失。')) {
      router.back()
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCancel}
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
            新建笔记
          </h1>
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
              {categories.map((category) => (
                <option
                  key={resolveCategoryId(category) || category.name}
                  value={resolveCategoryId(category)}
                >
                  {category.name}
                </option>
              ))}
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
                    const id = resolveTagId(t)
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
                  const tagId = resolveTagId(tag)
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

        <MarkdownEditor
          initialContent=""
          initialTitle=""
          onSave={handleSave}
          onSaveDraft={handleSaveDraft}
          isNew={true}
          draftKey={'note:new'}
        />
      </div>
    </div>
  )
}
