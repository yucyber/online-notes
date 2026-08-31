'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import type { KnowledgeBaseNoteLink, KnowledgeGraphProposal } from '@/types'
import type { KnowledgeGraphSessionState } from './knowledge-graph-session'
import type { KnowledgeGraphTimingSummary } from './useKnowledgeBasePage'

const KnowledgeGraphCanvas = dynamic(() => import('./KnowledgeGraphCanvas').then((module) => module.KnowledgeGraphCanvas), { ssr: false, loading: () => <div className="knowledge-graph-empty">正在准备图谱画布…</div> })

export function KnowledgeGraphPanel(props: {
  links: KnowledgeBaseNoteLink[]
  graphProposal: KnowledgeGraphProposal | null
  visibleGraph: KnowledgeGraphProposal | null
  buildingGraph: boolean
  loadingLinks: boolean
  loadingGraph: boolean
  savingGraph: boolean
  graphTiming?: KnowledgeGraphTimingSummary | null
  onBuild: () => void
  onSave: () => void
  preserveGraphWhileLoading?: boolean
  sessionState?: KnowledgeGraphSessionState
  onSessionStateChange?: (patch: Partial<KnowledgeGraphSessionState>) => void
}) {
  const [warningsOpen, setWarningsOpen] = useState(false)
  const graph = props.visibleGraph
  const providerStages = props.graphTiming?.stages.filter((stage) => stage.name === 'provider') || []
  const providerDurationMs = providerStages
    .reduce((total, stage) => total + stage.durationMs, 0)
  const contextStages = props.graphTiming?.stages.filter((stage) => stage.name === 'context_prepare') || []
  const contextDurationMs = contextStages
    .reduce((total, stage) => total + stage.durationMs, 0)
  const formatDuration = (durationMs: number) => durationMs < 1000
    ? `${durationMs} 毫秒`
    : `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(durationMs / 1000)} 秒`
  return <section className="knowledge-graph-panel">
    <div className="knowledge-graph-toolbar"><span>{graph ? `${props.graphProposal ? '待保存提案' : '已保存图谱'} · 图谱来源存在 ${graph.warnings.length} 条模型兼容提示` : '生成后可查看概念、主题与来源笔记之间的关系'}</span><div>
      {props.graphProposal ? <button type="button" className="prototype-button" data-testid="save-graph-proposal" onClick={props.onSave} disabled={props.savingGraph}>{props.savingGraph ? '保存中…' : '保存图谱'}</button> : null}
      <button type="button" className="prototype-button prototype-button--primary" data-testid="build-graph-proposal" onClick={props.onBuild} disabled={props.buildingGraph || props.loadingLinks || props.loadingGraph || props.links.length === 0}>{props.buildingGraph ? '生成中…' : '生成提案'}</button>
    </div></div>
    {props.buildingGraph ? <div role="status" aria-live="polite" className="px-5 py-2 text-xs text-[var(--product-muted)]">准备数据 / 生成中</div> : null}
    {!props.buildingGraph && props.graphTiming ? <div aria-label="本次生成耗时" className="px-5 py-2 text-xs tabular-nums text-[var(--product-text-secondary)]">
      {props.graphTiming.durationMs !== undefined ? `总耗时 ${formatDuration(props.graphTiming.durationMs)} · ` : ''}
      {providerStages.length ? `模型 ${formatDuration(providerDurationMs)}` : contextStages.length ? `准备数据 ${formatDuration(contextDurationMs)}` : '阶段明细不可用'}
    </div> : null}
    {graph?.warnings.length ? <div className="knowledge-graph-warning"><button type="button" aria-expanded={warningsOpen} onClick={() => setWarningsOpen((value) => !value)}><span>△</span><b>{graph.warnings[0]}</b><em>{warningsOpen ? '收起' : '查看'} ›</em></button>{warningsOpen ? <ul>{graph.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}</div> : null}
    {props.loadingGraph && !(props.preserveGraphWhileLoading && graph) ? <div className="knowledge-graph-empty">正在加载知识图谱…</div> : graph ? <div className="knowledge-graph-view"><KnowledgeGraphCanvas graph={graph} links={props.links} sessionState={props.sessionState} onSessionStateChange={props.onSessionStateChange} />{props.loadingGraph ? <div className="knowledge-graph-loading-overlay" aria-live="polite">正在切换知识图谱…</div> : null}</div> : <div className="knowledge-graph-empty">{props.links.length ? '还没有图谱，生成提案后将在这里预览。' : '先从笔记中选择内容，再生成知识图谱。'}</div>}
  </section>
}
