import React, { StrictMode, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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

test('同步专注模式 viewport 后保留已选节点详情', () => {
  const session = createKnowledgeGraphSession()
  const { rerender } = render(<KnowledgeGraphCanvas graph={graph} links={[]} sessionState={session} />)

  fireEvent.click(screen.getByText('向量搜索'))
  expect(screen.getByLabelText('节点详情')).toBeInTheDocument()

  rerender(<KnowledgeGraphCanvas graph={graph} links={[]} sessionState={{ ...session, viewport: { x: 20, y: 30, zoom: 0.9 } }} />)

  expect(screen.getByLabelText('节点详情')).toBeInTheDocument()
})

test('切换节点类型时在事件阶段同步专注模式会话', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  let latestVisibleTypes: string[] = []

  function SessionHarness() {
    const [session, setSession] = useState(createKnowledgeGraphSession())
    latestVisibleTypes = session.visibleTypes
    return <KnowledgeGraphCanvas
      graph={graph}
      links={[]}
      sessionState={session}
      onSessionStateChange={(patch) => setSession((current) => ({ ...current, ...patch }))}
    />
  }

  render(<StrictMode><SessionHarness /></StrictMode>)
  fireEvent.click(screen.getByRole('button', { name: '概念' }))

  const consoleErrors = consoleError.mock.calls
  consoleError.mockRestore()
  expect(screen.getByRole('button', { name: '概念' })).toHaveAttribute('aria-pressed', 'false')
  expect(latestVisibleTypes).toEqual(['entity', 'topic', 'claim'])
  expect(consoleErrors).toEqual([])
})
