'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createCategory, deleteCategory, fetchCategories, updateCategory } from '@/lib/api'
import type { Category } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/utils'
import {
  AlertTriangle,
  BarChart3,
  Layers,
  Pencil,
  PlusCircle,
  RefreshCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'

const DEFAULT_COLOR = '#3B82F6'
const defaultTemplates = [
  {
    name: '项目推进',
    description: '规划里程碑、风险与复盘记录，适合跨团队协作类内容',
    color: '#2563EB',
  },
  {
    name: '知识沉淀',
    description: '总结学习要点、代码片段或资料索引，方便后续复用',
    color: '#14B8A6',
  },
  {
    name: '灵感碎片',
    description: '随手记录创意、洞察或素材，后续统一梳理',
    color: '#F97316',
  },
]

const emptyForm = {
  name: '',
  description: '',
  color: DEFAULT_COLOR,
  parentId: '',
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object') {
    const axiosLikeError = error as { response?: { data?: { message?: string } } }
    if (axiosLikeError.response?.data?.message) {
      return axiosLikeError.response.data.message
    }
  }
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return fallback
}

const extractData = <T,>(payload: T | { data: T }): T => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

type CategoryWithDatabaseId = Omit<Category, 'id'> & {
  id?: string | null
  _id?: string | { toString: () => string }
  parentId?: string | null
}

const normalizeCategory = (category: CategoryWithDatabaseId): Category => {
  const rawId = category.id ?? category._id
  const id =
    typeof rawId === 'string'
      ? rawId
      : typeof rawId === 'object' && rawId?.toString
        ? rawId.toString()
        : ''

  return {
    ...category,
    id,
    parentId: category.parentId ?? null,
  }
}

const getDaysSinceUpdate = (date?: string) => {
  if (!date) return null
  const timestamp = Date.parse(date)
  if (Number.isNaN(timestamp)) return null
  return Math.max(0, Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24)))
}

const normalizeParentId = (value: string) => (value ? value : '')

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [formState, setFormState] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [batchColor, setBatchColor] = useState(DEFAULT_COLOR)
  const [batchParentId, setBatchParentId] = useState('')
  const [batchProcessing, setBatchProcessing] = useState(false)

  const loadCategories = async () => {
    try {
      setLoading(true)
      setError('')
      const data = await fetchCategories()
      const normalized = extractData<Category[]>(data).map((category) =>
        normalizeCategory(category as CategoryWithDatabaseId),
      )
      setCategories(normalized)
    } catch (error) {
      console.error('Failed to fetch categories', error)
      setError(getErrorMessage(error, '加载分类失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCategories()
  }, [])

  useEffect(() => {
    setSelectedCategoryIds((prev) => prev.filter((id) => categories.some((category) => category.id === id)))
  }, [categories])

  const resetForm = () => {
    setEditingId(null)
    setFormState(emptyForm)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!formState.name.trim()) {
      setError('请输入分类名称')
      return
    }

    try {
      setSaving(true)
      setError('')
      const normalizedParent = formState.parentId ? formState.parentId : null
      if (editingId) {
        const updatedResponse = await updateCategory(editingId, {
          name: formState.name.trim(),
          description: formState.description.trim() || undefined,
          color: formState.color,
          parentId: normalizedParent,
        })
        const updated = normalizeCategory(
          extractData<Category>(updatedResponse) as CategoryWithDatabaseId,
        )
        setCategories((prev) =>
          prev.map((category) => (category.id === editingId ? updated : category)),
        )
      } else {
        const createdResponse = await createCategory({
          name: formState.name.trim(),
          description: formState.description.trim() || undefined,
          color: formState.color,
          parentId: normalizedParent,
        })
        const created = normalizeCategory(
          extractData<Category>(createdResponse) as CategoryWithDatabaseId,
        )
        setCategories((prev) => [created, ...prev])
      }
      resetForm()
    } catch (error) {
      console.error('Failed to save category', error)
      setError(getErrorMessage(error, '保存分类失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('删除后不可恢复，确定要删除该分类吗？')) return
    try {
      await deleteCategory(id)
      setCategories((prev) => prev.filter((category) => category.id !== id))
      if (editingId === id) {
        resetForm()
      }
    } catch (error) {
      console.error('Failed to delete category', error)
      setError(getErrorMessage(error, '删除分类失败，请稍后再试'))
    }
  }

  const startEdit = (category: Category) => {
    setEditingId(category.id)
    setFormState({
      name: category.name,
      description: category.description || '',
      color: category.color || DEFAULT_COLOR,
      parentId: normalizeParentId(category.parentId ?? ''),
    })
  }

  const recentTemplates = useMemo(() => {
    return [...categories]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 3)
      .map((category) => ({
        name: category.name,
        description: category.description || '延续现有结构，保持命名一致性',
        color: category.color || DEFAULT_COLOR,
      }))
  }, [categories])

  const templateCandidates = recentTemplates.length > 0 ? recentTemplates : defaultTemplates

  const progressMeta = useMemo(() => {
    const steps = [
      Boolean(formState.name.trim()),
      Boolean(formState.description.trim()),
      Boolean(formState.color && formState.color !== DEFAULT_COLOR),
    ]
    const percent = Math.round((steps.filter(Boolean).length / steps.length) * 100)
    let message = '填写基础信息，智能推荐才能更精准'
    if (percent >= 100) {
      message = '信息完整，随时可以保存并套用模板'
    } else if (percent >= 66) {
      message = '很好，再补充一项，便于团队理解'
    }
    return { percent, message }
  }, [formState])

  const stats = useMemo(() => {
    if (categories.length === 0) {
      return {
        total: 0,
        active: 0,
        idle: 0,
        idlePreview: [] as Category[],
        stalePreview: [] as Array<{ category: Category; days: number }>,
        colorUsage: [] as Array<[string, number]>,
      }
    }

    let active = 0
    const idleList: Category[] = []
    const staleList: Array<{ category: Category; days: number }> = []
    const colorUsage = new Map<string, number>()

    categories.forEach((category) => {
      const noteTotal = category.noteCount ?? 0
      if (noteTotal > 0) {
        active += 1
      } else {
        idleList.push(category)
      }

      const days = getDaysSinceUpdate(category.updatedAt)
      if (days !== null && days >= 30) {
        staleList.push({ category, days })
      }

      const colorKey = (category.color || DEFAULT_COLOR).toLowerCase()
      colorUsage.set(colorKey, (colorUsage.get(colorKey) ?? 0) + 1)
    })

    return {
      total: categories.length,
      active,
      idle: categories.length - active,
      idlePreview: idleList.slice(0, 3),
      stalePreview: staleList
        .sort((a, b) => b.days - a.days)
        .slice(0, 2),
      colorUsage: Array.from(colorUsage.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4),
    }
  }, [categories])

  const parentLookup = useMemo(() => {
    return categories.reduce<Record<string, Category>>((acc, category) => {
      acc[category.id] = category
      return acc
    }, {})
  }, [categories])

  const allSelected = categories.length > 0 && selectedCategoryIds.length === categories.length

  const toggleSelection = (id: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id],
    )
  }

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedCategoryIds([])
      return
    }
    setSelectedCategoryIds(categories.map((category) => category.id))
  }

  const applyTemplate = (template: { name: string; description?: string; color?: string }) => {
    setFormState((prev) => ({
      ...prev,
      name: template.name,
      description: template.description || prev.description,
      color: template.color || prev.color,
    }))
  }

  const handleBatchDelete = async () => {
    if (selectedCategoryIds.length === 0) return
    if (!window.confirm(`确定要删除选中的 ${selectedCategoryIds.length} 个分类吗？此操作不可撤回。`)) {
      return
    }

    try {
      setBatchProcessing(true)
      await Promise.all(selectedCategoryIds.map((id) => deleteCategory(id)))
      setCategories((prev) => prev.filter((category) => !selectedCategoryIds.includes(category.id)))
      if (selectedCategoryIds.includes(editingId || '')) {
        resetForm()
      }
      setSelectedCategoryIds([])
    } catch (batchError) {
      console.error('Failed to batch delete categories', batchError)
      setError(getErrorMessage(batchError, '批量删除失败，请稍后重试'))
    } finally {
      setBatchProcessing(false)
    }
  }

  const handleBatchColorUpdate = async () => {
    if (selectedCategoryIds.length === 0) return
    try {
      setBatchProcessing(true)
      const updates = await Promise.all(
        selectedCategoryIds.map(async (id) => {
          const response = await updateCategory(id, { color: batchColor })
          return normalizeCategory(extractData<Category>(response) as CategoryWithDatabaseId)
        }),
      )
      setCategories((prev) =>
        prev.map((category) => updates.find((item) => item.id === category.id) ?? category),
      )
      setSelectedCategoryIds([])
    } catch (batchError) {
      console.error('Failed to batch update color', batchError)
      setError(getErrorMessage(batchError, '批量修改颜色失败，请稍后再试'))
    } finally {
      setBatchProcessing(false)
    }
  }

  const handleBatchParentUpdate = async () => {
    if (selectedCategoryIds.length === 0) return
    if (batchParentId && selectedCategoryIds.includes(batchParentId)) {
      setError('无法将分类设置为自身或互相作为父级，请重新选择')
      return
    }

    try {
      setBatchProcessing(true)
      const resolvedParent = batchParentId ? batchParentId : null
      const updates = await Promise.all(
        selectedCategoryIds.map(async (id) => {
          const response = await updateCategory(id, { parentId: resolvedParent })
          return normalizeCategory(extractData<Category>(response) as CategoryWithDatabaseId)
        }),
      )
      setCategories((prev) =>
        prev.map((category) => updates.find((item) => item.id === category.id) ?? category),
      )
      setSelectedCategoryIds([])
    } catch (batchError) {
      console.error('Failed to batch update parent', batchError)
      setError(getErrorMessage(batchError, '批量调整层级失败，请稍后再试'))
    } finally {
      setBatchProcessing(false)
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col gap-3">
        <h1
          className="text-4xl font-bold"
          style={{
            background: 'linear-gradient(to right, #111827, #2563eb, #111827)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          分类管理
        </h1>
        <p className="text-gray-600 text-lg">
          用颜色和描述快速区分不同的知识领域，支撑高效的笔记归档与检索
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="shadow-md" style={{ borderColor: 'var(--border)' }}>
          <CardHeader className="border-b pb-4" style={{ borderColor: 'var(--border)' }}>
            <CardTitle className="text-xl font-bold" style={{ color: 'var(--on-surface)' }}>{editingId ? '编辑分类' : '新建分类'}</CardTitle>
            <CardDescription className="mt-2 text-base">
              设置分类的名称、描述与颜色，帮助后续更快定位笔记
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div>
              <div className="flex items-center justify-between text-sm" style={{ color: 'var(--on-surface)' }}>
                <span>信息完整度</span>
                <span>{progressMeta.percent}%</span>
              </div>
              <div className="mt-2 h-2 w-full rounded-full" style={{ background: 'var(--surface-2)' }}>
                <div
                  className="h-2 rounded-full transition-all"
                  style={{ width: `${progressMeta.percent}%`, background: 'var(--primary-600)' }}
                />
              </div>
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>{progressMeta.message}</p>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>分类名称</label>
                <Input
                  placeholder="例如：项目管理、技术沉淀"
                  value={formState.name}
                  disabled={saving}
                  onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>描述</label>
                <Textarea
                  placeholder="补充说明分类用途，方便团队理解和协作"
                  rows={3}
                  value={formState.description}
                  disabled={saving}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, description: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>标识颜色</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={formState.color}
                    disabled={saving}
                    onChange={(e) => setFormState((prev) => ({ ...prev, color: e.target.value }))}
                    className="h-10 w-20 cursor-pointer rounded border p-1"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
                  />
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{formState.color}</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>父级分类</label>
                <select
                  value={formState.parentId}
                  disabled={saving}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, parentId: event.target.value }))
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
                >
                  <option value="">无需父级（顶层分类）</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id} disabled={editingId === category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  为分类添加父级，可在列表中折叠展示，降低层级混乱。
                </p>
              </div>

              <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="h-4 w-4" />
                  智能模板推荐
                </div>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>根据最近使用和高频场景快速套用。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {templateCandidates.map((template) => (
                    <button
                      key={`${template.name}-${template.color}`}
                      type="button"
                      onClick={() => applyTemplate(template)}
                      className="group rounded-full border px-3 py-1 text-xs font-medium transition"
                      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
                    >
                      {template.name}
                      <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        一键套用
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving} className="flex-1">
                  <PlusCircle className="mr-2 h-4 w-4" />
                  {editingId ? '保存修改' : '创建分类'}
                </Button>
                {editingId && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={resetForm}
                  >
                    <X className="mr-2 h-4 w-4" />
                    取消
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card className="shadow-md" style={{ borderColor: 'var(--border)' }}>
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4" style={{ borderColor: 'var(--border)' }}>
              <div>
                <CardTitle className="text-xl font-bold" style={{ color: 'var(--on-surface)' }}>分类健康度</CardTitle>
                <CardDescription className="mt-1">
                  快速识别闲置分类、推荐合并与颜色治理建议
                </CardDescription>
              </div>
              <BarChart3 className="h-6 w-6 text-primary" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                  <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>总分类</p>
                  <p className="mt-2 text-2xl font-bold" style={{ color: 'var(--on-surface)' }}>{stats.total}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{stats.active} 个正在被引用</p>
                </div>
                <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                  <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>高频使用</p>
                  <p className="mt-2 text-2xl font-bold" style={{ color: 'var(--on-surface)' }}>{stats.active}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>持续保持良好活跃度</p>
                </div>
                <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                  <p className="flex items-center gap-1 text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    闲置提醒
                  </p>
                  <p className="mt-2 text-2xl font-bold" style={{ color: 'var(--on-surface)' }}>{stats.idle}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>考虑合并或删除冗余分类</p>
                </div>
              </div>

              {stats.idle > 0 && (
                <div className="rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}>
                  <p className="font-medium">闲置分类建议合并/清理</p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {stats.idlePreview.map((category) => category.name).join('、 ') || '暂无待处理'}
                  </p>
                </div>
              )}

              {stats.stalePreview.length > 0 && (
                <div className="rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--on-surface)' }}>
                  <p className="font-medium">长期未更新的分类</p>
                  <ul className="mt-2 space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {stats.stalePreview.map(({ category, days }) => (
                      <li key={category.id} className="flex items-center gap-2">
                        <Layers className="h-3.5 w-3.5" />
                        <span>{category.name}</span>
                        <span>已闲置 {days} 天</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {stats.colorUsage.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>颜色使用情况</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {stats.colorUsage.map(([color, count]) => (
                      <div key={color} className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium shadow-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}>
                        <span className="h-3 w-3 rounded-full shadow-inner" style={{ backgroundColor: color }} />
                        {color.toUpperCase()} · {count}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white shadow-md border-gray-200">
            <CardHeader className="flex flex-row items-center justify-between border-b border-gray-100 pb-4">
              <div>
                <CardTitle className="text-xl font-bold text-gray-900">分类列表</CardTitle>
                <CardDescription className="mt-1">共 {categories.length} 条分类</CardDescription>
              </div>
              <div className="flex items-center gap-3">
                {categories.length > 0 && (
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={handleSelectAll}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    全选
                  </label>
                )}
                <Button variant="outline" size="sm" onClick={loadCategories} disabled={loading} className="shadow-sm">
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  刷新
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedCategoryIds.length > 0 && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm text-gray-700 shadow-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <p className="font-medium">
                      已选中 {selectedCategoryIds.length} 个分类，可批量整理
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2 text-xs">
                        <span>颜色</span>
                        <input
                          type="color"
                          value={batchColor}
                          onChange={(event) => setBatchColor(event.target.value)}
                          className="h-8 w-16 cursor-pointer rounded border border-gray-200 bg-white p-1"
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={batchProcessing}
                          onClick={handleBatchColorUpdate}
                        >
                          同步颜色
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span>父级</span>
                        <select
                          value={batchParentId}
                          onChange={(event) => setBatchParentId(event.target.value)}
                          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs focus:border-primary focus:outline-none"
                          disabled={batchProcessing}
                        >
                          <option value="">清空父级</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={batchProcessing}
                          onClick={handleBatchParentUpdate}
                        >
                          调整层级
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={batchProcessing}
                        onClick={handleBatchDelete}
                      >
                        批量删除
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-10 text-gray-500">
                  正在加载分类...
                </div>
              ) : categories.length === 0 ? (
                <div className="text-center py-10 text-gray-500">
                  暂无分类，请在左侧创建您的第一个分类
                </div>
              ) : (
                categories.map((category) => (
                  <div
                    key={category.id}
                    className="group flex flex-col gap-4 rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-5 md:flex-row md:items-center md:justify-between hover:border-primary-400 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 ease-out cursor-pointer"
                  >
                    <div className="flex flex-1 items-start gap-4">
                      <input
                        type="checkbox"
                        checked={selectedCategoryIds.includes(category.id)}
                        onChange={() => toggleSelection(category.id)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <div
                        className="mt-1 h-5 w-5 rounded-full shadow-md ring-2 ring-white"
                        style={{ backgroundColor: category.color || DEFAULT_COLOR }}
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <p className="text-lg font-bold text-gray-900">{category.name}</p>
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 shadow-sm">
                            {category.noteCount ?? 0} 条笔记
                          </span>
                        </div>
                        {category.description && (
                          <p className="mt-2 text-sm text-gray-600 leading-relaxed">{category.description}</p>
                        )}
                        {category.parentId && parentLookup[category.parentId]?.name && (
                          <p className="mt-2 text-xs text-primary-700">
                            隶属于：{parentLookup[category.parentId]?.name}
                          </p>
                        )}
                        <p className="mt-3 text-xs text-gray-500">
                          更新于 {formatDate(category.updatedAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEdit(category)}
                        className="hover:bg-primary-50 hover:text-primary-700 transition-all duration-200"
                      >
                        <Pencil className="mr-1 h-4 w-4" />
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 transition-all duration-200"
                        onClick={() => handleDelete(category.id)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        删除
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

