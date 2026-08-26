'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Background, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, type NodeProps } from '@xyflow/react'
import type { KnowledgeBaseNoteLink, KnowledgeGraphProposal } from '@/types'
import { buildKnowledgeGraphFlow, type KnowledgeFlowNodeData } from './knowledge-graph-layout'

function KnowledgeNode({ data, selected }: NodeProps) {
  const value = data as KnowledgeFlowNodeData
  const node = value.graphNode
  return <div className={`knowledge-flow-node knowledge-flow-node--${node.type} ${selected ? 'is-selected' : ''}`}>
    <Handle type="target" position={Position.Left} />
    <strong>{node.label}</strong><span>{value.typeLabel} · {Math.round(node.confidence * 100)}% · {node.noteIds.length} 篇</span>
    <Handle type="source" position={Position.Right} />
  </div>
}

const nodeTypes = { knowledge: KnowledgeNode }

function GraphStage({ graph, links }: { graph: KnowledgeGraphProposal; links: KnowledgeBaseNoteLink[] }) {
  const initial = useMemo(() => buildKnowledgeGraphFlow(graph), [graph])
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const [selectedId, setSelectedId] = useState('')
  const [zoom, setZoom] = useState(1)
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  useEffect(() => {
    setNodes(initial.nodes); setEdges(initial.edges); setSelectedId('')
    requestAnimationFrame(() => void fitView({ padding: 0.12, minZoom: 0.82, maxZoom: 1.05, duration: 250 }))
  }, [fitView, initial, setEdges, setNodes])

  const connectedIds = useMemo(() => {
    if (!selectedId) return new Set<string>()
    const ids = new Set([selectedId])
    graph.edges.forEach((edge) => {
      if (edge.source === selectedId) ids.add(edge.target)
      if (edge.target === selectedId) ids.add(edge.source)
    })
    return ids
  }, [graph.edges, selectedId])
  const visibleNodes = useMemo(() => nodes.map((node) => ({ ...node, className: selectedId && !connectedIds.has(node.id) ? 'is-dimmed' : undefined })), [connectedIds, nodes, selectedId])
  const visibleEdges = useMemo(() => edges.map((edge) => ({ ...edge, label: zoom < 0.6 ? undefined : edge.label, className: !selectedId || edge.source === selectedId || edge.target === selectedId ? 'knowledge-flow-edge' : 'knowledge-flow-edge is-dimmed' })), [edges, selectedId, zoom])
  const selected = graph.nodes.find((node) => node.id === selectedId)
  const linkedNotes = selected ? links.filter((link) => selected.noteIds.includes(link.noteId)) : []
  const relayout = useCallback(() => {
    const next = buildKnowledgeGraphFlow(graph); setNodes(next.nodes); setEdges(next.edges)
    requestAnimationFrame(() => void fitView({ padding: 0.12, minZoom: 0.82, maxZoom: 1.05, duration: 300 }))
  }, [fitView, graph, setEdges, setNodes])

  return <div className="knowledge-graph-stage">
    <div className="knowledge-graph-canvas" data-testid="knowledge-graph-canvas">
      <ReactFlow nodes={visibleNodes} edges={visibleEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={(_, node) => setSelectedId((current) => current === node.id ? '' : node.id)} onPaneClick={() => setSelectedId('')} onMove={(_, viewport) => setZoom(viewport.zoom)} minZoom={0.25} maxZoom={1.75} fitView fitViewOptions={{ padding: 0.12, minZoom: 0.82, maxZoom: 1.05 }} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
        <Background gap={22} size={1} />
        {graph.nodes.length > 20 ? <MiniMap pannable zoomable /> : null}
      </ReactFlow>
      <div className="knowledge-graph-controls" aria-label="图谱控制">
        <button type="button" aria-label="缩小" onClick={() => void zoomOut()}>−</button>
        <button type="button" aria-label="放大" onClick={() => void zoomIn()}>＋</button>
        <button type="button" aria-label="适应画布" onClick={() => void fitView({ padding: 0.12, minZoom: 0.82, maxZoom: 1.05, duration: 250 })}>⌗</button>
        <i />
        <button type="button" aria-label="重新布局" onClick={relayout}>↻</button>
      </div>
      <div className="knowledge-graph-hint">滚轮缩放 · 拖拽画布平移 · 点击节点查看来源</div>
      <div className="knowledge-graph-legend"><span data-type="concept">概念</span><span data-type="entity">实体</span><span data-type="topic">主题</span><span data-type="claim">论断</span></div>
    </div>
    {selected ? <aside className="knowledge-node-detail" aria-label="节点详情">
      <button type="button" aria-label="关闭节点详情" onClick={() => setSelectedId('')}>×</button><small>节点详情</small><h3>{selected.label}</h3><p>{Math.round(selected.confidence * 100)}% 置信度 · {selected.noteIds.length} 篇来源笔记</p><h4>来源笔记</h4>
      {linkedNotes.length ? linkedNotes.map((link) => <Link key={link.id} href={`/dashboard/notes/${link.noteId}`}><strong>{link.note.title || '无标题笔记'}</strong><span>{link.note.summary || '查看笔记内容'} →</span></Link>) : <p>当前节点没有可访问的来源笔记。</p>}
    </aside> : null}
  </div>
}

export function KnowledgeGraphCanvas(props: { graph: KnowledgeGraphProposal; links: KnowledgeBaseNoteLink[] }) {
  if (props.graph.nodes.length === 0) return <div className="knowledge-graph-empty">图谱中暂时没有节点。</div>
  return <ReactFlowProvider><GraphStage {...props} /></ReactFlowProvider>
}
