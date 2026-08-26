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
