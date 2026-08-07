'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createCategory, deleteCategory, fetchCategories, updateCategory } from '@/lib/api'
import type { Category } from '@/types'
import {
  CategoryTemplate,
  CategoryWithDatabaseId,
  defaultCategoryTemplates,
  DEFAULT_CATEGORY_COLOR,
  emptyCategoryForm,
  extractCategoryData,
  getCategoryErrorMessage,
  getDaysSinceCategoryUpdate,
  normalizeCategory,
} from './categories-page-utils'

export function useCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [formState, setFormState] = useState(emptyCategoryForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [batchColor, setBatchColor] = useState(DEFAULT_CATEGORY_COLOR)
  const [batchParentId, setBatchParentId] = useState('')
  const [batchProcessing, setBatchProcessing] = useState(false)

  const loadCategories = async () => {
    try {
      setLoading(true)
      setError('')
      const data = await fetchCategories()
      setCategories(
        extractCategoryData<Category[]>(data).map((category) =>
          normalizeCategory(category as CategoryWithDatabaseId),
        ),
      )
    } catch (loadError) {
      console.error('Failed to fetch categories', loadError)
      setError(getCategoryErrorMessage(loadError, '加载分类失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCategories()
  }, [])

  useEffect(() => {
    // 分类列表刷新后，过滤掉已被删除的选中 ID，防止对不存在的 ID 发起批量操作。
    setSelectedCategoryIds((prev) => prev.filter((id) => categories.some((category) => category.id === id)))
  }, [categories])

  const resetForm = () => {
    setEditingId(null)
    setFormState(emptyCategoryForm)
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
      const payload = {
        name: formState.name.trim(),
        description: formState.description.trim() || undefined,
        color: formState.color,
        parentId: formState.parentId || null,
      }

      if (editingId) {
        const response = await updateCategory(editingId, payload)
        const updated = normalizeCategory(
          extractCategoryData<Category>(response) as CategoryWithDatabaseId,
        )
        setCategories((prev) => prev.map((category) => (category.id === editingId ? updated : category)))
      } else {
        const response = await createCategory(payload)
        const created = normalizeCategory(
          extractCategoryData<Category>(response) as CategoryWithDatabaseId,
        )
        setCategories((prev) => [created, ...prev])
      }
      resetForm()
    } catch (saveError) {
      console.error('Failed to save category', saveError)
      setError(getCategoryErrorMessage(saveError, '保存分类失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('删除后不可恢复，确定要删除该分类吗？')) return
    try {
      await deleteCategory(id)
      setCategories((prev) => prev.filter((category) => category.id !== id))
      if (editingId === id) resetForm()
    } catch (deleteError) {
      console.error('Failed to delete category', deleteError)
      setError(getCategoryErrorMessage(deleteError, '删除分类失败，请稍后再试'))
    }
  }

  const startEdit = (category: Category) => {
    setEditingId(category.id)
    setFormState({
      name: category.name,
      description: category.description || '',
      color: category.color || DEFAULT_CATEGORY_COLOR,
      parentId: category.parentId || '',
    })
  }

  const recentTemplates = useMemo<CategoryTemplate[]>(() =>
    [...categories]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 3)
      .map((category) => ({
        name: category.name,
        description: category.description || '延续现有结构，保持命名一致性',
        color: category.color || DEFAULT_CATEGORY_COLOR,
      })),
  [categories])

  const templateCandidates = recentTemplates.length > 0 ? recentTemplates : defaultCategoryTemplates

  const progressMeta = useMemo(() => {
    const steps = [
      Boolean(formState.name.trim()),
      Boolean(formState.description.trim()),
      Boolean(formState.color && formState.color !== DEFAULT_CATEGORY_COLOR),
    ]
    const percent = Math.round((steps.filter(Boolean).length / steps.length) * 100)
    let message = '填写基础信息，智能推荐才能更精准'
    if (percent >= 100) message = '信息完整，随时可以保存并套用模板'
    else if (percent >= 66) message = '很好，再补充一项，便于团队理解'
    return { percent, message }
  }, [formState])

  const stats = useMemo(() => {
    let active = 0
    const idleList: Category[] = []
    const staleList: Array<{ category: Category; days: number }> = []
    const colorUsage = new Map<string, number>()

    categories.forEach((category) => {
      if ((category.noteCount ?? 0) > 0) active += 1
      else idleList.push(category)

      const days = getDaysSinceCategoryUpdate(category.updatedAt)
      if (days !== null && days >= 30) staleList.push({ category, days })

      const color = (category.color || DEFAULT_CATEGORY_COLOR).toLowerCase()
      colorUsage.set(color, (colorUsage.get(color) ?? 0) + 1)
    })

    return {
      total: categories.length,
      active,
      idle: categories.length - active,
      idlePreview: idleList.slice(0, 3),
      stalePreview: staleList.sort((a, b) => b.days - a.days).slice(0, 2),
      colorUsage: Array.from(colorUsage.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4),
    }
  }, [categories])

  const parentLookup = useMemo(
    () => categories.reduce<Record<string, Category>>((acc, category) => ({ ...acc, [category.id]: category }), {}),
    [categories],
  )
  const allSelected = categories.length > 0 && selectedCategoryIds.length === categories.length

  const toggleSelection = (id: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id],
    )
  }

  const handleSelectAll = () => {
    setSelectedCategoryIds(allSelected ? [] : categories.map((category) => category.id))
  }

  const applyTemplate = (template: CategoryTemplate) => {
    setFormState((prev) => ({
      ...prev,
      name: template.name,
      description: template.description || prev.description,
      color: template.color || prev.color,
    }))
  }

  const updateSelectedCategories = async (
    update: (id: string) => Promise<Category>,
    fallback: string,
  ) => {
    if (selectedCategoryIds.length === 0) return
    try {
      setBatchProcessing(true)
      const updates = await Promise.all(selectedCategoryIds.map(update))
      setCategories((prev) => prev.map((category) => updates.find((item) => item.id === category.id) ?? category))
      setSelectedCategoryIds([])
    } catch (batchError) {
      console.error('Failed to update categories in batch', batchError)
      setError(getCategoryErrorMessage(batchError, fallback))
    } finally {
      setBatchProcessing(false)
    }
  }

  const handleBatchDelete = async () => {
    if (selectedCategoryIds.length === 0) return
    if (!window.confirm(`确定要删除选中的 ${selectedCategoryIds.length} 个分类吗？此操作不可撤回。`)) return
    try {
      setBatchProcessing(true)
      await Promise.all(selectedCategoryIds.map((id) => deleteCategory(id)))
      setCategories((prev) => prev.filter((category) => !selectedCategoryIds.includes(category.id)))
      if (selectedCategoryIds.includes(editingId || '')) resetForm()
      setSelectedCategoryIds([])
    } catch (batchError) {
      console.error('Failed to batch delete categories', batchError)
      setError(getCategoryErrorMessage(batchError, '批量删除失败，请稍后重试'))
    } finally {
      setBatchProcessing(false)
    }
  }

  const handleBatchColorUpdate = () => updateSelectedCategories(
    async (id) => normalizeCategory(extractCategoryData<Category>(await updateCategory(id, { color: batchColor })) as CategoryWithDatabaseId),
    '批量修改颜色失败，请稍后再试',
  )

  const handleBatchParentUpdate = () => {
    // 防止把分类自身设为父级，产生无法渲染的循环层级关系。
    if (batchParentId && selectedCategoryIds.includes(batchParentId)) {
      setError('无法将分类设置为自身或互相作为父级，请重新选择')
      return Promise.resolve()
    }
    return updateSelectedCategories(
      async (id) => normalizeCategory(extractCategoryData<Category>(await updateCategory(id, { parentId: batchParentId || null })) as CategoryWithDatabaseId),
      '批量调整层级失败，请稍后再试',
    )
  }

  return {
    categories,
    formState,
    setFormState,
    editingId,
    loading,
    saving,
    error,
    selectedCategoryIds,
    batchColor,
    setBatchColor,
    batchParentId,
    setBatchParentId,
    batchProcessing,
    templateCandidates,
    progressMeta,
    stats,
    parentLookup,
    allSelected,
    loadCategories,
    resetForm,
    handleSubmit,
    handleDelete,
    startEdit,
    toggleSelection,
    handleSelectAll,
    applyTemplate,
    handleBatchDelete,
    handleBatchColorUpdate,
    handleBatchParentUpdate,
  }
}
