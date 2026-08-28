'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Background, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, type NodeProps } from '@xyflow/react'
import type { KnowledgeBaseNoteLink, KnowledgeGraphNodeType, KnowledgeGraphProposal } from '@/types'
import { buildKnowledgeGraphFlow, filterKnowledgeGraph, toNodeTypeLabel, type KnowledgeFlowNodeData } from './knowledge-graph-layout'
import type { KnowledgeGraphSessionState } from './knowledge-graph-session'
import { KnowledgeGraphEvidenceList } from './KnowledgeGraphEvidenceList'

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
const graphNodeTypes: KnowledgeGraphNodeType[] = ['concept', 'entity', 'topic', 'claim']

type GraphStageProps = {
  graph: KnowledgeGraphProposal
  links: KnowledgeBaseNoteLink[]
  sessionState?: KnowledgeGraphSessionState
  onSessionStateChange?: (patch: Partial<KnowledgeGraphSessionState>) => void
}

function GraphStage({ graph, links, sessionState, onSessionStateChange }: GraphStageProps) {
  const [query, setQuery] = useState(sessionState?.query || '')
  const [visibleTypes, setVisibleTypes] = useState<Set<KnowledgeGraphNodeType>>(() => new Set(sessionState?.visibleTypes || graphNodeTypes))
  const filteredGraph = useMemo(() => filterKnowledgeGraph(graph, query, visibleTypes), [graph, query, visibleTypes])
  const initial = useMemo(() => {
    const flow = buildKnowledgeGraphFlow(filteredGraph)
    return { ...flow, nodes: flow.nodes.map((node) => ({ ...node, position: sessionState?.positions[node.id] || node.position })) }
  }, [filteredGraph, sessionState?.positions])
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const [selectedKind, setSelectedKind] = useState<'node' | 'edge' | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [zoom, setZoom] = useState(1)
  const { fitView, setViewport, zoomIn, zoomOut } = useReactFlow()

  useEffect(() => {
    setQuery(sessionState?.query || '')
    setVisibleTypes(new Set(sessionState?.visibleTypes || graphNodeTypes))
  }, [graph.knowledgeBaseId, sessionState?.query, sessionState?.visibleTypes])

  useEffect(() => {
    setNodes(initial.nodes); setEdges(initial.edges); setSelectedKind(null); setSelectedId('')
    if (!sessionState?.viewport) requestAnimationFrame(() => void fitView({ padding: 0.12, minZoom: 0.82, maxZoom: 1.05, duration: 250 }))
  }, [fitView, initial, setEdges, setNodes])

  useEffect(() => {
    if (sessionState?.viewport) void setViewport(sessionState.viewport)
  }, [sessionState?.viewport, setViewport])

  const connectedIds = useMemo(() => {
    if (!selectedId) return new Set<string>()
    const selectedEdge = selectedKind === 'edge' ? filteredGraph.edges.find((edge) => edge.id === selectedId) : undefined
    const ids = new Set(selectedEdge ? [selectedEdge.source, selectedEdge.target] : [selectedId])
    if (selectedKind === 'node') filteredGraph.edges.forEach((edge) => {
      if (edge.source === selectedId) ids.add(edge.target)
      if (edge.target === selectedId) ids.add(edge.source)
    })
    return ids
  }, [filteredGraph.edges, selectedId, selectedKind])
  const visibleNodes = useMemo(() => nodes.map((node) => ({ ...node, className: selectedId && !connectedIds.has(node.id) ? 'is-dimmed' : undefined })), [connectedIds, nodes, selectedId])
  const visibleEdges = useMemo(() => edges.map((edge) => {
    const visible = !selectedId || (selectedKind === 'node'
      ? edge.source === selectedId || edge.target === selectedId
      : edge.id === selectedId)
    return { ...edge, label: zoom < 0.6 ? undefined : edge.label, className: visible ? 'knowledge-flow-edge' : 'knowledge-flow-edge is-dimmed' }
  }), [edges, selectedId, selectedKind, zoom])
  const selectedNode = selectedKind === 'node' ? filteredGraph.nodes.find((node) => node.id === selectedId) : undefined
  const selectedEdge = selectedKind === 'edge' ? filteredGraph.edges.find((edge) => edge.id === selectedId) : undefined
  const linkedNotes = selectedNode ? links.filter((link) => selectedNode.noteIds.includes(link.noteId)) : []
  const relayout = useCallback(() => {
    const next = buildKnowledgeGraphFlow(filteredGraph); setNodes(next.nodes); setEdges(next.edges)
    requestAnimationFrame(() => void fitView({ padding: 0.12, minZoom: 0.82, maxZoom: 1.05, duration: 300 }))
  }, [filteredGraph, fitView, setEdges, setNodes])

  const toggleType = useCallback((type: KnowledgeGraphNodeType) => {
    const next = new Set(visibleTypes)
    if (next.has(type) && next.size > 1) next.delete(type)
    else next.add(type)
    setVisibleTypes(next)
    onSessionStateChange?.({ visibleTypes: Array.from(next) })
  }, [onSessionStateChange, visibleTypes])

  return <div className="knowledge-graph-stage">
    <div className="knowledge-graph-canvas" data-testid="knowledge-graph-canvas">
      <ReactFlow nodes={visibleNodes} edges={visibleEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={(_, node) => {
        const closing = selectedKind === 'node' && selectedId === node.id
        setSelectedKind(closing ? null : 'node'); setSelectedId(closing ? '' : node.id)
      }} onEdgeClick={(_, edge) => {
        const closing = selectedKind === 'edge' && selectedId === edge.id
        setSelectedKind(closing ? null : 'edge'); setSelectedId(closing ? '' : edge.id)
      }} onPaneClick={() => { setSelectedKind(null); setSelectedId('') }} onMove={(_, viewport) => setZoom(viewport.zoom)} onMoveEnd={(_, viewport) => onSessionStateChange?.({ viewport })} onNodeDragStop={(_, moved) => onSessionStateChange?.({ positions: Object.fromEntries(nodes.map((node) => [node.id, node.id === moved.id ? moved.position : node.position])) })} minZoom={0.25} maxZoom={1.75} fitView fitViewOptions={{ padding: 0.12, minZoom: 0.82, maxZoom: 1.05 }} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
        <Background gap={22} size={1} />
        {filteredGraph.nodes.length > 20 ? <MiniMap pannable zoomable /> : null}
      </ReactFlow>
      <div className="knowledge-graph-filters" aria-label="节点筛选">
        <input aria-label="按节点名称筛选" value={query} onChange={(event) => { setQuery(event.target.value); onSessionStateChange?.({ query: event.target.value }) }} placeholder="筛选节点" />
        <div>{graphNodeTypes.map((type) => <button key={type} type="button" aria-pressed={visibleTypes.has(type)} onClick={() => toggleType(type)}>{toNodeTypeLabel(type)}</button>)}</div>
        {filteredGraph.nodes.length === 0 ? <span>没有匹配节点</span> : null}
      </div>
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
    {selectedNode ? <aside className="knowledge-node-detail" aria-label="节点详情">
      <button type="button" aria-label="关闭节点详情" onClick={() => { setSelectedKind(null); setSelectedId('') }}>×</button><small>节点详情</small><h3>{selectedNode.label}</h3><p>{Math.round(selectedNode.confidence * 100)}% 置信度 · {selectedNode.noteIds.length} 篇来源笔记</p><h4>来源笔记</h4>
      {linkedNotes.length ? linkedNotes.map((link) => <Link key={link.id} href={`/dashboard/notes/${link.noteId}`}><strong>{link.note.title || '无标题笔记'}</strong><span>{link.note.summary || '查看笔记内容'} →</span></Link>) : <p>当前节点没有可访问的来源笔记。</p>}
      <h4>原文证据</h4><KnowledgeGraphEvidenceList knowledgeBaseId={graph.knowledgeBaseId} kind="node" graphItemId={selectedNode.id} />
    </aside> : null}
    {selectedEdge ? <aside className="knowledge-node-detail" aria-label="关系详情">
      <button type="button" aria-label="关闭关系详情" onClick={() => { setSelectedKind(null); setSelectedId('') }}>×</button><small>关系详情</small>
      <h3>{graph.nodes.find((node) => node.id === selectedEdge.source)?.label || selectedEdge.source}</h3>
      <p>{selectedEdge.relation}</p>
      <h3>{graph.nodes.find((node) => node.id === selectedEdge.target)?.label || selectedEdge.target}</h3>
      <h4>原文证据</h4><KnowledgeGraphEvidenceList knowledgeBaseId={graph.knowledgeBaseId} kind="edge" graphItemId={selectedEdge.id} />
    </aside> : null}
  </div>
}

export function KnowledgeGraphCanvas(props: GraphStageProps) {
  if (props.graph.nodes.length === 0) return <div className="knowledge-graph-empty">图谱中暂时没有节点。</div>
  return <ReactFlowProvider><GraphStage {...props} /></ReactFlowProvider>
}
