'use client'

import { Loader2, Network, Save, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { KnowledgeGraphProposal } from '@/types'

export function KnowledgeGraphPanel(props: {
  linksCount: number
  graphProposal: KnowledgeGraphProposal | null
  visibleGraph: KnowledgeGraphProposal | null
  graphNodeLabels: Map<string, string>
  buildingGraph: boolean
  loadingLinks: boolean
  loadingGraph: boolean
  savingGraph: boolean
  onBuild: () => void
  onSave: () => void
}) {
  const {
    linksCount,
    graphProposal,
    visibleGraph,
    graphNodeLabels,
    buildingGraph,
    loadingLinks,
    loadingGraph,
    savingGraph,
    onBuild,
    onSave,
  } = props

  return (
    <div
      className="mb-6 rounded-xl border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>
            <Network className="h-4 w-4" />
            {visibleGraph && (
              <span className="rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                {graphProposal ? '待保存提案' : '已保存图谱'}
              </span>
            )}
            知识图谱提案
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            当前边界内 {linksCount} 篇笔记，生成结果只作为待确认草稿。
          </p>
        </div>
        {graphProposal && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="save-graph-proposal"
            onClick={onSave}
            disabled={savingGraph}
          >
            {savingGraph ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            保存图谱
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="build-graph-proposal"
          onClick={onBuild}
          disabled={buildingGraph || loadingLinks || loadingGraph || linksCount === 0}
        >
          {buildingGraph ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          生成提案
        </Button>
      </div>

      {linksCount === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed p-4 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          加入笔记后才能构建图谱，空知识库不会触发 AI 请求。
        </div>
      ) : visibleGraph ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Nodes
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {visibleGraph.nodes.length === 0 ? (
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无节点</span>
              ) : (
                visibleGraph.nodes.map((node) => (
                  <span
                    key={node.id}
                    className="rounded-full border px-3 py-1 text-xs"
                    style={{ borderColor: 'var(--border)', color: 'var(--on-surface)', background: 'var(--surface-0)' }}
                    title={`${node.type} · ${Math.round(node.confidence * 100)}%`}
                  >
                    {node.label}
                  </span>
                ))
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Edges
            </p>
            <div className="mt-2 space-y-2">
              {visibleGraph.edges.length === 0 ? (
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无关系</span>
              ) : (
                visibleGraph.edges.slice(0, 6).map((edge) => (
                  <div key={edge.id} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--border)' }}>
                    <span style={{ color: 'var(--on-surface)' }}>{graphNodeLabels.get(edge.source) || edge.source}</span>
                    <span className="mx-2" style={{ color: 'var(--text-muted)' }}>{edge.relation}</span>
                    <span style={{ color: 'var(--on-surface)' }}>{graphNodeLabels.get(edge.target) || edge.target}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          {visibleGraph.warnings.length > 0 && (
            <div className="lg:col-span-2 rounded-lg border px-3 py-2 text-xs text-amber-800" style={{ borderColor: '#fde68a', background: '#fffbeb' }}>
              {visibleGraph.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed p-4 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          生成后会在这里预览节点、关系和需要人工复核的提示。
        </div>
      )}
    </div>
  )
}
