'use client'

import { CategoryFormPanel } from '@/components/categories/CategoryFormPanel'
import { CategoryListPanel } from '@/components/categories/CategoryListPanel'
import { CategoryOverviewPanel } from '@/components/categories/CategoryOverviewPanel'
import { useCategoriesPage } from '@/components/categories/useCategoriesPage'

export default function CategoriesPage() {
  const page = useCategoriesPage()
  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold" style={{ background: 'linear-gradient(to right, #111827, #2563eb, #111827)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>分类管理</h1>
        <p className="text-gray-600 text-lg">用颜色和描述快速区分不同的知识领域，支撑高效的笔记归档与检索</p>
      </div>
      {page.error && <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-600">{page.error}</div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <CategoryFormPanel
          categories={page.categories}
          editingId={page.editingId}
          formState={page.formState}
          saving={page.saving}
          progressMeta={page.progressMeta}
          templateCandidates={page.templateCandidates}
          onSubmit={page.handleSubmit}
          onChange={(field, value) => page.setFormState((previous) => ({ ...previous, [field]: value }))}
          onReset={page.resetForm}
          onApplyTemplate={page.applyTemplate}
        />
        <div className="space-y-6 lg:col-span-2">
          <CategoryOverviewPanel stats={page.stats} />
          <CategoryListPanel
            categories={page.categories}
            loading={page.loading}
            selectedCategoryIds={page.selectedCategoryIds}
            batchColor={page.batchColor}
            batchParentId={page.batchParentId}
            batchProcessing={page.batchProcessing}
            allSelected={page.allSelected}
            parentLookup={page.parentLookup}
            onSetBatchColor={page.setBatchColor}
            onSetBatchParentId={page.setBatchParentId}
            onSelectAll={page.handleSelectAll}
            onRefresh={page.loadCategories}
            onToggleSelection={page.toggleSelection}
            onBatchColorUpdate={page.handleBatchColorUpdate}
            onBatchParentUpdate={page.handleBatchParentUpdate}
            onBatchDelete={page.handleBatchDelete}
            onEdit={page.startEdit}
            onDelete={page.handleDelete}
          />
        </div>
      </div>
    </div>
  )
}
