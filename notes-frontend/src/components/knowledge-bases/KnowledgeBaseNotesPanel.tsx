'use client'

import Link from 'next/link'
import { Loader2, RefreshCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { formatDate } from '@/utils'
import type { KnowledgeBase, KnowledgeBaseNoteLink, KnowledgeGraphProposal } from '@/types'
import { KnowledgeGraphPanel } from './KnowledgeGraphPanel'

export function KnowledgeBaseNotesPanel(props: {
  selectedId: string
  selectedKnowledgeBase: KnowledgeBase | null
  links: KnowledgeBaseNoteLink[]
  loadingLinks: boolean
  removingNoteId: string
  graphProposal: KnowledgeGraphProposal | null
  visibleGraph: KnowledgeGraphProposal | null
  graphNodeLabels: Map<string, string>
  buildingGraph: boolean
  loadingGraph: boolean
  savingGraph: boolean
  onRefresh: () => void
  onRemoveNote: (noteId: string) => void
  onBuildGraph: () => void
  onSaveGraph: () => void
}) {
  const {
    selectedId,
    selectedKnowledgeBase,
    links,
    loadingLinks,
    removingNoteId,
    graphProposal,
    visibleGraph,
    graphNodeLabels: _graphNodeLabels,
    buildingGraph,
    loadingGraph,
    savingGraph,
    onRefresh,
    onRemoveNote,
    onBuildGraph,
    onSaveGraph,
  } = props

  return (
    <Card style={{ borderColor: 'var(--border)' }}>
      <CardHeader className="border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-xl">{selectedKnowledgeBase?.name || '知识库笔记'}</CardTitle>
            <CardDescription>
              {selectedKnowledgeBase?.description || '选择一个知识库查看其中的笔记'}
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={!selectedId || loadingLinks}>
            {loadingLinks ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            刷新
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {selectedId && (
          <KnowledgeGraphPanel
            links={links}
            graphProposal={graphProposal}
            visibleGraph={visibleGraph}
            buildingGraph={buildingGraph}
            loadingLinks={loadingLinks}
            loadingGraph={loadingGraph}
            savingGraph={savingGraph}
            onBuild={onBuildGraph}
            onSave={onSaveGraph}
          />
        )}
        {!selectedId ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            创建或选择知识库后，这里会显示纳入的笔记。
          </div>
        ) : loadingLinks ? (
          <div className="flex min-h-[180px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            加载笔记...
          </div>
        ) : links.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            这个知识库还没有笔记。前往“我的笔记”批量选择后加入。
          </div>
        ) : (
          <div className="space-y-3">
            {links.map((link) => (
              <div
                key={link.id}
                className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
              >
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/notes/${link.note.id}`}
                    className="font-semibold hover:text-primary-600"
                    style={{ color: 'var(--on-surface)' }}
                  >
                    {link.note.title || '无标题'}
                  </Link>
                  <p className="mt-1 line-clamp-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                    {link.note.summary || '暂无摘要'}
                  </p>
                  <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    更新时间：{formatDate(link.note.updatedAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`从知识库移除 ${link.note.title || '无标题'}`}
                  title="从知识库移除"
                  disabled={removingNoteId === link.noteId}
                  onClick={() => onRemoveNote(link.noteId)}
                >
                  {removingNoteId === link.noteId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
