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
  const positions = buildNetworkPositions(graph)

  return {
    nodes: graph.nodes.map((graphNode) => {
      return {
        id: graphNode.id,
        type: 'knowledge',
        position: positions.get(graphNode.id) || { x: 0, y: 0 },
        data: { graphNode, typeLabel: toNodeTypeLabel(graphNode.type) },
      }
    }),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'straight',
      label: toRelationLabel(edge.relation),
      data: { relation: edge.relation, noteIds: edge.noteIds },
      className: 'knowledge-flow-edge',
      labelBgPadding: [7, 4],
      labelBgBorderRadius: 5,
    })),
  }
}

const NODE_WIDTH = 154
const NODE_HEIGHT = 64

function hashId(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

// 固定初始位置和迭代次数，让同一图谱稳定复现；力导向只表达关系密度，不制造父子层级。
function buildNetworkPositions(graph: KnowledgeGraphProposal): Map<string, { x: number; y: number }> {
  const count = graph.nodes.length
  if (!count) return new Map()
  const radius = Math.max(150, Math.sqrt(count) * 64)
  const points = graph.nodes.map((node, index) => {
    const jitter = (hashId(node.id) % 1000) / 1000
    const angle = index * 2.3999632297 + jitter * 0.32
    return { id: node.id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.72, vx: 0, vy: 0 }
  })
  const byId = new Map(points.map((point) => [point.id, point]))

  for (let iteration = 0; iteration < 260; iteration += 1) {
    for (let left = 0; left < points.length; left += 1) {
      for (let right = left + 1; right < points.length; right += 1) {
        const a = points[left], b = points[right]
        const dx = b.x - a.x || 0.01, dy = b.y - a.y || 0.01
        const distanceSquared = Math.max(900, dx * dx + dy * dy)
        const force = 13000 / distanceSquared
        const distance = Math.sqrt(distanceSquared)
        const fx = dx / distance * force, fy = dy / distance * force
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy
      }
    }
    for (const edge of graph.edges) {
      const source = byId.get(edge.source), target = byId.get(edge.target)
      if (!source || !target) continue
      const dx = target.x - source.x, dy = target.y - source.y
      const distance = Math.max(1, Math.hypot(dx, dy))
      const force = (distance - 165) * 0.02 * Math.max(0.45, edge.weight || 0)
      const fx = dx / distance * force, fy = dy / distance * force
      source.vx += fx; source.vy += fy; target.vx -= fx; target.vy -= fy
    }
    for (const point of points) {
      point.vx += -point.x * 0.004; point.vy += -point.y * 0.004
      point.vx *= 0.78; point.vy *= 0.78
      point.x += Math.max(-10, Math.min(10, point.vx))
      point.y += Math.max(-10, Math.min(10, point.vy))
    }
  }

  // 画布是横向矩形，压缩纵向跨度后再做碰撞分离，避免 fitView 为容纳高度而把卡片整体缩小。
  for (const point of points) point.y *= 0.66

  // React Flow 节点是矩形，最后做确定性碰撞分离，防止文字卡片互相覆盖。
  for (let pass = 0; pass < 36; pass += 1) {
    for (let left = 0; left < points.length; left += 1) {
      for (let right = left + 1; right < points.length; right += 1) {
        const a = points[left], b = points[right]
        const dx = b.x - a.x, dy = b.y - a.y
        const overlapX = NODE_WIDTH + 18 - Math.abs(dx)
        const overlapY = NODE_HEIGHT + 18 - Math.abs(dy)
        if (overlapX <= 0 || overlapY <= 0) continue
        if (overlapX < overlapY) {
          const shift = overlapX / 2 + 0.5, direction = dx >= 0 ? 1 : -1
          a.x -= shift * direction; b.x += shift * direction
        } else {
          const shift = overlapY / 2 + 0.5, direction = dy >= 0 ? 1 : -1
          a.y -= shift * direction; b.y += shift * direction
        }
      }
    }
  }

  const minX = Math.min(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  return new Map(points.map((point) => [point.id, { x: Math.round(point.x - minX + 36), y: Math.round(point.y - minY + 36) }]))
}
