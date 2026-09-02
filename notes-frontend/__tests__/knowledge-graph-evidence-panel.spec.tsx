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

test('选择 node 后懒加载证据，展开后由 ChunkEvidenceViewer 实时拉取正文', async () => {
  // ChunkEvidenceViewer 走 global.fetch（jsdom 无 Response）——普通对象 mock（仓库惯例，同 assistant-api.spec.ts）
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {
    noteId: 'note-1', noteTitle: '证据笔记', chunkId: 'chunk-1', headingPath: ['Root', 'Child'],
    content: '完整 Chunk 内容', noteUpdatedAt: '2026-08-28T00:00:00.000Z', relocated: false,
    neighbors: { before: [], after: [] },
  } }) }) as any) as any
  render(<KnowledgeGraphCanvas graph={graph} links={[]} />)

  fireEvent.click(screen.getByRole('button', { name: '节点 A' }))

  await waitFor(() => expect(mockKnowledgeBasesAPI.getNodeEvidence).toHaveBeenCalledWith('kb-1', 'node-a'))
  expect(await screen.findByText('证据笔记')).toBeInTheDocument()
  // 折叠态只展示标题/heading 与定位链接，不渲染图谱快照正文
  expect(screen.queryByText('短预览')).not.toBeInTheDocument()
  expect(screen.queryByText('完整 Chunk 内容')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '定位到原文' })).toHaveAttribute(
    'href',
    '/dashboard/notes/note-1?chunkId=chunk-1&heading=Root%20%3E%20Child',
  )

  fireEvent.click(screen.getByRole('button', { name: '展开更多' }))

  // 行内挂载的 viewer 实时拉取证据（含权限校验），请求带 heading query 锁定重定位
  expect(await screen.findByText('完整 Chunk 内容')).toBeInTheDocument()
  expect(global.fetch).toHaveBeenCalledWith('/api/notes/note-1/chunks/chunk-1/evidence?before=1&after=1&heading=Root%3EChild', expect.anything())
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
    items: [{ ...evidence.items[0], noteTitle: '关系证据笔记' }],
  })
  render(<KnowledgeGraphCanvas graph={graph} links={[]} />)

  fireEvent.click(screen.getByRole('button', { name: '节点 A' }))
  fireEvent.click(screen.getByRole('button', { name: '依赖' }))
  expect(await screen.findByText('关系证据笔记')).toBeInTheDocument()

  await act(async () => { oldRequest.resolve(evidence) })
  expect(screen.queryByText('证据笔记')).not.toBeInTheDocument()
  expect(screen.getByText('关系证据笔记')).toBeInTheDocument()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
