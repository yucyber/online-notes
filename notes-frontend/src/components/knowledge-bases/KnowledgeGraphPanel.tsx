'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import type { KnowledgeBaseNoteLink, KnowledgeGraphProposal } from '@/types'

const KnowledgeGraphCanvas = dynamic(() => import('./KnowledgeGraphCanvas').then((module) => module.KnowledgeGraphCanvas), { ssr: false, loading: () => <div className="knowledge-graph-empty">正在准备图谱画布…</div> })

export function KnowledgeGraphPanel(props: {
  links: KnowledgeBaseNoteLink[]
  graphProposal: KnowledgeGraphProposal | null
  visibleGraph: KnowledgeGraphProposal | null
  buildingGraph: boolean
  loadingLinks: boolean
  loadingGraph: boolean
  savingGraph: boolean
  onBuild: () => void
  onSave: () => void
  preserveGraphWhileLoading?: boolean
}) {
  const [warningsOpen, setWarningsOpen] = useState(false)
  const graph = props.visibleGraph
  return <section className="knowledge-graph-panel">
    <div className="knowledge-graph-toolbar"><span>{graph ? `${props.graphProposal ? '待保存提案' : '已保存图谱'} · 图谱来源存在 ${graph.warnings.length} 条模型兼容提示` : '生成后可查看概念、主题与来源笔记之间的关系'}</span><div>
      {props.graphProposal ? <button type="button" className="prototype-button" data-testid="save-graph-proposal" onClick={props.onSave} disabled={props.savingGraph}>{props.savingGraph ? '保存中…' : '保存图谱'}</button> : null}
      <button type="button" className="prototype-button prototype-button--primary" data-testid="build-graph-proposal" onClick={props.onBuild} disabled={props.buildingGraph || props.loadingLinks || props.loadingGraph || props.links.length === 0}>{props.buildingGraph ? '生成中…' : '生成提案'}</button>
    </div></div>
    {graph?.warnings.length ? <div className="knowledge-graph-warning"><button type="button" aria-expanded={warningsOpen} onClick={() => setWarningsOpen((value) => !value)}><span>△</span><b>{graph.warnings[0]}</b><em>{warningsOpen ? '收起' : '查看'} ›</em></button>{warningsOpen ? <ul>{graph.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}</div> : null}
    {props.loadingGraph && !(props.preserveGraphWhileLoading && graph) ? <div className="knowledge-graph-empty">正在加载知识图谱…</div> : graph ? <div className="knowledge-graph-view"><KnowledgeGraphCanvas graph={graph} links={props.links} />{props.loadingGraph ? <div className="knowledge-graph-loading-overlay" aria-live="polite">正在切换知识图谱…</div> : null}</div> : <div className="knowledge-graph-empty">{props.links.length ? '还没有图谱，生成提案后将在这里预览。' : '先从笔记中选择内容，再生成知识图谱。'}</div>}
  </section>
}
