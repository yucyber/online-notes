import dagre from 'dagre'
import type { Edge, Node } from '@xyflow/react'
import type { KnowledgeGraphNode, KnowledgeGraphNodeType, KnowledgeGraphProposal } from '@/types'

export type KnowledgeFlowNodeData = {
  graphNode: KnowledgeGraphNode
  typeLabel: string
}

const relationLabels: Record<string, string> = {
  describes: '描述',
  includes: '包含',
  contains: '包含',
  uses: '使用',
  covers: '覆盖',
  depends_on: '依赖',
  relies_on: '依赖',
  relates_to: '相关',
  related_to: '相关',
  defines: '定义',
  refers_to: '引用',
  causes: '导致',
  examples: '示例',
  exemplifies: '示例',
}

const nodeTypeLabels: Record<KnowledgeGraphNodeType, string> = {
  concept: '概念',
  entity: '实体',
  topic: '主题',
  claim: '论断',
}

export function toRelationLabel(relation: string): string {
  return relationLabels[relation] || relation
}

export function toNodeTypeLabel(type: KnowledgeGraphNodeType): string {
  return nodeTypeLabels[type] || type
}

export function buildKnowledgeGraphFlow(graph: KnowledgeGraphProposal): {
  nodes: Node<KnowledgeFlowNodeData>[]
  edges: Edge[]
} {
  const layout = new dagre.graphlib.Graph()
  layout.setDefaultEdgeLabel(() => ({}))
  layout.setGraph({ rankdir: 'LR', ranksep: 84, nodesep: 38, marginx: 36, marginy: 36 })

  for (const node of graph.nodes) layout.setNode(node.id, { width: 154, height: 64 })
  for (const edge of graph.edges) layout.setEdge(edge.source, edge.target)
  dagre.layout(layout)

  return {
    nodes: graph.nodes.map((graphNode) => {
      const position = layout.node(graphNode.id) || { x: 0, y: 0 }
      return {
        id: graphNode.id,
        type: 'knowledge',
        position: { x: position.x - 77, y: position.y - 32 },
        data: { graphNode, typeLabel: toNodeTypeLabel(graphNode.type) },
      }
    }),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      label: toRelationLabel(edge.relation),
      data: { relation: edge.relation, noteIds: edge.noteIds },
      className: 'knowledge-flow-edge',
      labelBgPadding: [7, 4],
      labelBgBorderRadius: 5,
    })),
  }
}
