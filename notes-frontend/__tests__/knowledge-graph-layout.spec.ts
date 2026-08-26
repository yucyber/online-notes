import { buildKnowledgeGraphFlow, toNodeTypeLabel, toRelationLabel } from '@/components/knowledge-bases/knowledge-graph-layout'

const graph = {
  knowledgeBaseId: 'kb-1',
  generatedAt: '2026-08-26T00:00:00.000Z',
  nodes: [
    { id: 'a', label: 'React Diff', type: 'concept' as const, confidence: 0.92, noteIds: ['note-1'] },
    { id: 'b', label: 'useMemo', type: 'entity' as const, confidence: 0.8, noteIds: ['note-1'] },
  ],
  edges: [
    { id: 'edge-1', source: 'a', target: 'b', relation: 'uses', weight: 0.8, noteIds: ['note-1'] },
  ],
  warnings: [],
}

test('将领域图谱转换为有稳定位置的 React Flow 数据', () => {
  const flow = buildKnowledgeGraphFlow(graph)

  expect(flow.nodes).toHaveLength(2)
  expect(flow.nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true)
  expect(flow.edges[0]).toMatchObject({ source: 'a', target: 'b', label: '使用' })
})

test('关系和节点类型中文化，未知关系保留原值', () => {
  expect(toRelationLabel('depends_on')).toBe('依赖')
  expect(toRelationLabel('supports')).toBe('supports')
  expect(toNodeTypeLabel('claim')).toBe('论断')
})

test('关系网络布局稳定地分散在二维空间且节点不重叠', () => {
  const network = {
    ...graph,
    nodes: Array.from({ length: 12 }, (_, index) => ({
      id: `n${index}`,
      label: `节点 ${index}`,
      type: 'concept' as const,
      confidence: 0.8,
      noteIds: ['note-1'],
    })),
    edges: Array.from({ length: 15 }, (_, index) => ({
      id: `e${index}`,
      source: `n${index % 12}`,
      target: `n${(index * 5 + 3) % 12}`,
      relation: 'relates_to',
      weight: 0.8,
      noteIds: ['note-1'],
    })).filter((edge) => edge.source !== edge.target),
  }
  const first = buildKnowledgeGraphFlow(network)
  const second = buildKnowledgeGraphFlow(network)

  expect(second.nodes.map((node) => node.position)).toEqual(first.nodes.map((node) => node.position))
  expect(new Set(first.nodes.map((node) => Math.round(node.position.x / 40))).size).toBeGreaterThan(3)
  expect(new Set(first.nodes.map((node) => Math.round(node.position.y / 40))).size).toBeGreaterThan(3)
  for (let left = 0; left < first.nodes.length; left += 1) {
    for (let right = left + 1; right < first.nodes.length; right += 1) {
      const a = first.nodes[left].position
      const b = first.nodes[right].position
      expect(Math.abs(a.x - b.x) >= 140 || Math.abs(a.y - b.y) >= 58).toBe(true)
    }
  }
  expect(first.edges.every((edge) => edge.type !== 'smoothstep')).toBe(true)
  expect(first.edges.every((edge) => first.nodes.some((node) => node.id === edge.source) && first.nodes.some((node) => node.id === edge.target))).toBe(true)
})
