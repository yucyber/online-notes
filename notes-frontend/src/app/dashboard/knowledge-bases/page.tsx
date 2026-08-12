'use client'

import Link from 'next/link'
import { FileText, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KnowledgeBaseList } from '@/components/knowledge-bases/KnowledgeBaseList'
import { KnowledgeBaseNotesPanel } from '@/components/knowledge-bases/KnowledgeBaseNotesPanel'
import { useKnowledgeBasePage } from '@/components/knowledge-bases/useKnowledgeBasePage'

export default function KnowledgeBasesPage() {
  const page = useKnowledgeBasePage()

  if (page.loadingBases) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
        <RefreshCcw className="mr-2 h-5 w-5 animate-spin" />
        加载知识库...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="product-page-header flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-heading">
            知识库
          </h1>
          <p className="page-description">
            用知识库划定笔记集合，后续图谱构建会以单个知识库为边界。
          </p>
        </div>
        <Link href="/dashboard/notes">
          <Button variant="outline">
            <FileText className="mr-2 h-4 w-4" />
            从笔记选择
          </Button>
        </Link>
      </div>

      {page.error && (
        <div className="rounded-lg border px-3 py-2 text-sm text-red-700" style={{ borderColor: '#fecaca', background: '#fef2f2' }}>
          {page.error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <KnowledgeBaseList
          knowledgeBases={page.knowledgeBases}
          selectedId={page.selectedId}
          formState={page.formState}
          saving={page.saving}
          onSelect={page.setSelectedId}
          onFormChange={page.setFormState}
          onSubmit={page.handleSubmit}
        />
        <KnowledgeBaseNotesPanel
          selectedId={page.selectedId}
          selectedKnowledgeBase={page.selectedKnowledgeBase}
          links={page.links}
          loadingLinks={page.loadingLinks}
          removingNoteId={page.removingNoteId}
          graphProposal={page.graphProposal}
          visibleGraph={page.visibleGraph}
          graphNodeLabels={page.graphNodeLabels}
          buildingGraph={page.buildingGraph}
          loadingGraph={page.loadingGraph}
          savingGraph={page.savingGraph}
          onRefresh={() => { void page.loadLinks(page.selectedId) }}
          onRemoveNote={(noteId) => { void page.handleRemoveNote(noteId) }}
          onBuildGraph={() => { void page.handleBuildGraphProposal() }}
          onSaveGraph={() => { void page.handleSaveGraph() }}
        />
      </div>
    </div>
  )
}
