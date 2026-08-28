import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { KnowledgeGraphCanvas } from '@/components/knowledge-bases/KnowledgeGraphCanvas'
import { createKnowledgeGraphSession } from '@/components/knowledge-bases/knowledge-graph-session'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = TestResizeObserver as typeof ResizeObserver

const graph = {
  knowledgeBaseId: 'kb-1',
  generatedAt: '2026-08-28T00:00:00.000Z',
  nodes: [{ id: 'node-1', label: '向量搜索', type: 'concept' as const, confidence: 0.9, noteIds: [] }],
  edges: [],
  warnings: [],
}

test('切换知识库时同步对应会话的筛选条件', () => {
  const first = { ...createKnowledgeGraphSession(), query: '第二' }
  const { rerender } = render(<KnowledgeGraphCanvas graph={graph} links={[]} sessionState={first} />)
  expect(screen.getByLabelText('按节点名称筛选')).toHaveValue('第二')

  rerender(<KnowledgeGraphCanvas graph={{ ...graph, knowledgeBaseId: 'kb-2' }} links={[]} sessionState={createKnowledgeGraphSession()} />)

  expect(screen.getByLabelText('按节点名称筛选')).toHaveValue('')
})
