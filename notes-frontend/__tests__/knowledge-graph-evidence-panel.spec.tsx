import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { KnowledgeGraphCanvas } from '@/components/knowledge-bases/KnowledgeGraphCanvas'
import { knowledgeBasesAPI } from '@/lib/api/knowledge-bases'

jest.mock('@/lib/api/knowledge-bases', () => ({
  knowledgeBasesAPI: {
    getNodeEvidence: jest.fn(),
    getEdgeEvidence: jest.fn(),
  },
}))

jest.mock('@xyflow/react', () => {
  const React = require('react')
  const viewport = { fitView: jest.fn(), setViewport: jest.fn(), zoomIn: jest.fn(), zoomOut: jest.fn() }
  return {
    Background: () => null,
    Handle: () => null,
    MiniMap: () => null,
    Position: { Left: 'left', Right: 'right' },
    ReactFlowProvider: ({ children }: any) => children,
    useReactFlow: () => viewport,
    useNodesState: (initial: any[]) => {
      const [items, setItems] = React.useState(initial)
      return [items, setItems, jest.fn()]
    },
    useEdgesState: (initial: any[]) => {
      const [items, setItems] = React.useState(initial)
      return [items, setItems, jest.fn()]
    },
    ReactFlow: ({ nodes, edges, onNodeClick, onEdgeClick }: any) => <div>
      {nodes.map((node: any) => <button key={node.id} onClick={() => onNodeClick({}, node)}>{node.data.graphNode.label}</button>)}
      {edges.map((edge: any) => <button key={edge.id} onClick={() => onEdgeClick?.({}, edge)}>{edge.label}</button>)}
    </div>,
  }
})

const mockKnowledgeBasesAPI = knowledgeBasesAPI as jest.Mocked<typeof knowledgeBasesAPI>
const graph = {
  knowledgeBaseId: 'kb-1',
  generatedAt: '2026-08-28T00:00:00.000Z',
  nodes: [
    { id: 'node-a', label: '节点 A', type: 'concept' as const, confidence: 0.9, noteIds: ['note-1'] },
    { id: 'node-b', label: '节点 B', type: 'entity' as const, confidence: 0.8, noteIds: ['note-1'] },
  ],
  edges: [{ id: 'edge-a', source: 'node-a', target: 'node-b', relation: '依赖', weight: 0.7, noteIds: ['note-1'] }],
  warnings: [],
}
const evidence = {
  compatibility: 'evidence_available' as const,
  items: [{
    noteId: 'note-1', noteTitle: '证据笔记', chunkId: 'chunk-1', headingPath: ['Root', 'Child'],
    preview: '短预览', content: '完整 Chunk 内容',
  }],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockKnowledgeBasesAPI.getNodeEvidence.mockResolvedValue(evidence)
  mockKnowledgeBasesAPI.getEdgeEvidence.mockResolvedValue(evidence)
})

test('选择 node 后懒加载证据，并仅在展开后显示完整 content', async () => {
  render(<KnowledgeGraphCanvas graph={graph} links={[]} />)

  fireEvent.click(screen.getByRole('button', { name: '节点 A' }))

  await waitFor(() => expect(mockKnowledgeBasesAPI.getNodeEvidence).toHaveBeenCalledWith('kb-1', 'node-a'))
  expect(await screen.findByText('短预览')).toBeInTheDocument()
  expect(screen.queryByText('完整 Chunk 内容')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '展开更多' }))
  expect(screen.getByText('完整 Chunk 内容')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '定位到原文' })).toHaveAttribute(
    'href',
    '/dashboard/notes/note-1?chunkId=chunk-1&heading=Root%20%3E%20Child',
  )
})

test('选择 edge 后显示关系详情并加载 edge evidence', async () => {
  render(<KnowledgeGraphCanvas graph={graph} links={[]} />)

  fireEvent.click(screen.getByRole('button', { name: '依赖' }))

  expect(await screen.findByLabelText('关系详情')).toHaveTextContent('节点 A')
  expect(screen.getByLabelText('关系详情')).toHaveTextContent('依赖')
  expect(screen.getByLabelText('关系详情')).toHaveTextContent('节点 B')
  await waitFor(() => expect(mockKnowledgeBasesAPI.getEdgeEvidence).toHaveBeenCalledWith('kb-1', 'edge-a'))
})

test('切换选择后旧请求晚到不能覆盖当前证据', async () => {
  const oldRequest = deferred<typeof evidence>()
  mockKnowledgeBasesAPI.getNodeEvidence.mockReturnValue(oldRequest.promise)
  mockKnowledgeBasesAPI.getEdgeEvidence.mockResolvedValue({
    ...evidence,
    items: [{ ...evidence.items[0], preview: '关系新证据', content: '关系完整证据' }],
  })
  render(<KnowledgeGraphCanvas graph={graph} links={[]} />)

  fireEvent.click(screen.getByRole('button', { name: '节点 A' }))
  fireEvent.click(screen.getByRole('button', { name: '依赖' }))
  expect(await screen.findByText('关系新证据')).toBeInTheDocument()

  await act(async () => { oldRequest.resolve(evidence) })
  expect(screen.queryByText('短预览')).not.toBeInTheDocument()
  expect(screen.getByText('关系新证据')).toBeInTheDocument()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
