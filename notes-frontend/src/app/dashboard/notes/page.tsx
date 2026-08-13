'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Pagination, PageSizeSelect } from '@/components/ui/pagination'
import { Plus, FileText, ListChecks, Sparkles, Check } from 'lucide-react'
import { AggregateSummaryDialog } from '@/components/ai/AggregateSummaryDialog'
import { AddToKnowledgeBasePanel } from '@/components/knowledge-bases/AddToKnowledgeBasePanel'
import { NotesListCard } from '@/components/notes/NotesListCard'
import { useNotesPage } from '@/components/notes/useNotesPage'
import { getCurrentUser } from '@/lib/auth'

const SearchFilterBar = dynamic(() => import('@/components/SearchFilterBar'), { ssr: false })
const SmartRecommendations = dynamic(() => import('@/components/SmartRecommendations'), { ssr: false })

function NotesPageContent() {
  const currentUserId = getCurrentUser()?.id || ''
  const {
    searchParams,
    notes,
    loading,
    error,
    fallbackMsg,
    categoryMap,
    pendingDeleteId,
    setPendingDeleteId,
    page,
    size,
    total,
    isSelectionMode,
    selectedNoteIds,
    setSelectedNoteIds,
    showSummaryDialog,
    setShowSummaryDialog,
    summaryResult,
    summaryLoading,
    toggleSelectionMode,
    toggleNoteSelection,
    handleGenerateSummary,
    handleSaveSummary,
    handleDelete,
    resolveTagId,
    resolveTagLabel,
    handlePageSizeChange,
    handlePageChange,
    clearError,
  } = useNotesPage()

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-900">我的笔记</h1>
          <Link href="/dashboard/notes/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              新建笔记
            </Button>
          </Link>
        </div>
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {fallbackMsg && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          {fallbackMsg}
        </div>
      )}
      {error && notes.length === 0 && (
        <div
          className="rounded-md border p-3 text-sm flex items-center justify-between"
          style={{ color: 'var(--on-surface)', background: 'var(--surface-2)', borderColor: 'var(--border)' }}
        >
          <span>{error}</span>
          <button
            onClick={clearError}
            className="px-3 py-1 rounded"
            style={{ background: 'var(--primary-600)', color: '#fff' }}
          >
            重试
          </button>
        </div>
      )}

      <div className="product-page-header flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-heading">我的笔记</h1>
          <p className="page-description">管理和组织您的所有笔记</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={toggleSelectionMode}
            className={isSelectionMode ? 'bg-blue-50 border-blue-200 text-blue-600' : ''}
          >
            {isSelectionMode ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                完成
              </>
            ) : (
              <>
                <ListChecks className="mr-2 h-4 w-4" />
                批量
              </>
            )}
          </Button>

          {isSelectionMode && selectedNoteIds.size >= 1 && (
            <>
              <AddToKnowledgeBasePanel
                noteIds={Array.from(selectedNoteIds)}
                onAdded={() => setSelectedNoteIds(new Set())}
              />
              <Button
                onClick={handleGenerateSummary}
                className="text-white"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                生成摘要 ({selectedNoteIds.size})
              </Button>
            </>
          )}

          {!isSelectionMode && (
            <Link href="/dashboard/notes/new">
              <Button aria-label="新建笔记"><Plus className="h-4 w-4" />新建笔记</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <SearchFilterBar />

          {error && notes.length === 0 && (
            <div className="p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">{error}</div>
          )}

          {notes.length === 0 ? (
            <Card
              className="border-2 border-dashed"
              style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', borderRadius: '16px' }}
            >
              <CardContent className="text-center py-16">
                <div
                  className="inline-flex p-4 mb-6"
                  style={{ borderRadius: '50%', backgroundColor: 'var(--surface-2)' }}
                >
                  <FileText className="h-12 w-12" style={{ color: 'var(--text-muted)' }} />
                </div>
                <h3 className="text-2xl font-bold mb-3" style={{ color: 'var(--on-surface)' }}>
                  没有找到笔记
                </h3>
                <p className="mb-2 text-lg" style={{ color: 'var(--text-muted)' }}>
                  尝试调整筛选条件或创建新笔记
                </p>
                {searchParams.get('nlq') === '1' && (
                  <p className="mb-6" style={{ color: 'var(--text-muted)' }}>
                    语义检索未命中（可能受阈值或过滤条件影响），可切换到“关键词”模式或降低阈值
                  </p>
                )}
                <Link href="/dashboard/notes/new">
                  <Button>
                    <Plus className="mr-2 h-5 w-5" />
                    创建第一篇笔记
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="product-list-surface divide-y divide-[var(--product-line-soft)]">
              {notes.map((note, i) => (
                <NotesListCard
                  key={note.id || `${String(note.title || 'note')}-${String(note.updatedAt || '')}-${i}`}
                  note={note}
                  index={i}
                  categoryMap={categoryMap}
                  isSelectionMode={isSelectionMode}
                  selectedNoteIds={selectedNoteIds}
                  onToggleSelection={toggleNoteSelection}
                  onRequestDelete={setPendingDeleteId}
                  resolveTagId={resolveTagId}
                  resolveTagLabel={resolveTagLabel}
                  currentUserId={currentUserId}
                />
              ))}
            </div>
          )}

          {notes.length > 0 && (
            <div className="product-list-surface flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <PageSizeSelect size={size} onSizeChange={handlePageSizeChange} />
              <Pagination page={page} size={size} total={total} onPageChange={handlePageChange} />
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <SmartRecommendations
            context={{
              keyword: searchParams.get('keyword') || undefined,
              categoryId: searchParams.get('categoryId') || undefined,
              categoryIds: searchParams.getAll('categoryIds').length > 0 ? searchParams.getAll('categoryIds') : undefined,
              categoriesMode: (searchParams.get('categoriesMode') as 'any' | 'all') || undefined,
              tagIds: searchParams.getAll('tagIds').length > 0 ? searchParams.getAll('tagIds') : undefined,
              tagsMode: (searchParams.get('tagsMode') as 'any' | 'all') || undefined,
              startDate: searchParams.get('startDate') || undefined,
              endDate: searchParams.get('endDate') || undefined,
              status: (searchParams.get('status') as 'published' | 'draft') || undefined,
            }}
          />
        </div>
      </div>

      {pendingDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--overlay)' }}>
          <div
            className="rounded-xl shadow-xl w-[92%] max-w-md p-5 border"
            style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', color: 'var(--on-surface)' }}
          >
            <h3 className="text-lg font-semibold mb-2">确认删除</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
              确定要删除这条笔记吗？此操作无法撤销。
            </p>
            <div className="flex justify-end gap-3">
              <button
                className="px-4 py-2 rounded border"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
                onClick={() => setPendingDeleteId(null)}
              >
                取消
              </button>
              <button
                className="px-4 py-2 rounded"
                style={{ background: 'var(--primary-600)', color: '#fff' }}
                onClick={() => handleDelete(pendingDeleteId)}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      <AggregateSummaryDialog
        open={showSummaryDialog}
        onClose={() => setShowSummaryDialog(false)}
        loading={summaryLoading}
        summary={summaryResult}
        onSave={handleSaveSummary}
      />
    </div>
  )
}

export default function NotesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="text-center text-gray-500">加载中...</div>
        </div>
      }
    >
      <NotesPageContent />
    </Suspense>
  )
}
