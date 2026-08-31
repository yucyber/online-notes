import { createKnowledgeGraphSession, updateKnowledgeGraphSession } from '@/components/knowledge-bases/knowledge-graph-session'

test('按知识库隔离图谱会话且不修改旧对象', () => {
  const first = updateKnowledgeGraphSession({}, 'kb-1', { query: '向量' })
  const second = updateKnowledgeGraphSession(first, 'kb-2', { viewport: { x: 10, y: 20, zoom: 0.8 } })

  expect(second['kb-1'].query).toBe('向量')
  expect(second['kb-2'].viewport).toEqual({ x: 10, y: 20, zoom: 0.8 })
  expect(second).not.toBe(first)
  expect(second['kb-1']).toBe(first['kb-1'])
})

test('新会话包含全部节点类型和空画布状态', () => {
  expect(createKnowledgeGraphSession()).toEqual({
    query: '',
    visibleTypes: ['concept', 'entity', 'topic', 'claim'],
    viewport: null,
    positions: {},
  })
})
