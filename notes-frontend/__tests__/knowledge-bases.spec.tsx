import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const mockKnowledgeBasesAPI = {
  getAll: jest.fn(),
  create: jest.fn(),
  getNotes: jest.fn(),
  addNote: jest.fn(),
  removeNote: jest.fn(),
  buildGraphProposal: jest.fn(),
  getGraph: jest.fn(),
  saveGraph: jest.fn(),
}

const mockToast = {
  success: jest.fn(),
  error: jest.fn(),
}

jest.mock('@/lib/api', () => ({
  knowledgeBasesAPI: mockKnowledgeBasesAPI,
}))

jest.mock('react-hot-toast', () => ({
  toast: mockToast,
}))

jest.mock('@/components/knowledge-bases/KnowledgeGraphCanvas', () => ({
  KnowledgeGraphCanvas: ({ graph }: { graph: typeof graphProposal }) => <div data-testid="knowledge-graph-canvas">{graph.nodes.map((node) => <span key={node.id}>{node.label}</span>)}{graph.edges.map((edge) => <span key={edge.id}>{edge.relation}</span>)}</div>,
}))

const kb = {
  id: 'kb-1',
  name: 'AI Research',
  description: 'Graph work',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

const kb2 = {
  ...kb,
  id: 'kb-2',
  name: '第二知识库',
  description: 'Second graph',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const linkedNote = {
  id: 'link-1',
  knowledgeBaseId: 'kb-1',
  noteId: 'note-1',
  note: {
    id: 'note-1',
    title: 'Transformer Notes',
    summary: 'Attention and graph notes',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
  },
  createdAt: '2026-06-03T00:00:00.000Z',
}

const graphProposal = {
  knowledgeBaseId: 'kb-1',
  generatedAt: '2026-06-05T00:00:00.000Z',
  nodes: [
    { id: 'kg_concept_attention', label: 'Attention', type: 'concept', confidence: 0.92, noteIds: ['note-1'] },
    { id: 'kg_topic_graphs', label: 'Graphs', type: 'topic', confidence: 0.8, noteIds: ['note-1'] },
  ],
  edges: [
    { id: 'edge-1', source: 'kg_concept_attention', target: 'kg_topic_graphs', relation: 'supports', weight: 0.74, noteIds: ['note-1'] },
  ],
  warnings: ['Low evidence edge kept for review.'],
}

const emptyGraph = {
  knowledgeBaseId: 'kb-1',
  generatedAt: '2026-06-05T00:00:00.000Z',
  nodes: [],
  edges: [],
  warnings: [],
}

describe('knowledge base frontend entry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockKnowledgeBasesAPI.getAll.mockResolvedValue([kb])
    mockKnowledgeBasesAPI.getNotes.mockResolvedValue([linkedNote])
    mockKnowledgeBasesAPI.create.mockResolvedValue({
      id: 'kb-2',
      name: 'Project Memory',
      description: 'Shipping notes',
      createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:00:00.000Z',
    })
    mockKnowledgeBasesAPI.addNote.mockResolvedValue(linkedNote)
    mockKnowledgeBasesAPI.removeNote.mockResolvedValue({ ok: true })
    mockKnowledgeBasesAPI.buildGraphProposal.mockResolvedValue(graphProposal)
    mockKnowledgeBasesAPI.getGraph.mockResolvedValue(emptyGraph)
    mockKnowledgeBasesAPI.saveGraph.mockResolvedValue({ ...graphProposal, warnings: [] })
  })

  test('lists knowledge bases, creates one, and removes a note from the selected base', async () => {
    const { default: KnowledgeBasesPage } = await import('@/app/dashboard/knowledge-bases/page')

    render(<KnowledgeBasesPage />)

    expect((await screen.findAllByText('AI Research')).length).toBeGreaterThan(0)
    expect(document.querySelector('.product-kb-layout')).toBeInTheDocument()
    expect(document.querySelectorAll('.product-kb-layout > .prototype-panel')).toHaveLength(2)
    expect(document.querySelector('.knowledge-base-workspace')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /笔记 1/ }))
    expect(await screen.findByText('Transformer Notes')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('从知识库移除 Transformer Notes'))

    await waitFor(() => {
      expect(mockKnowledgeBasesAPI.removeNote).toHaveBeenCalledWith('kb-1', 'note-1')
    })

    fireEvent.click(screen.getByRole('button', { name: '新建知识库' }))
    fireEvent.change(screen.getByPlaceholderText('知识库名称'), {
      target: { value: 'Project Memory' },
    })
    fireEvent.change(screen.getByPlaceholderText('描述这个知识库的边界'), {
      target: { value: 'Shipping notes' },
    })
    fireEvent.click(screen.getByRole('button', { name: /创建知识库/ }))

    await waitFor(() => {
      expect(mockKnowledgeBasesAPI.create).toHaveBeenCalledWith({
        name: 'Project Memory',
        description: 'Shipping notes',
      })
    })
    expect((await screen.findAllByText('Project Memory')).length).toBeGreaterThan(0)
  })

  test('adds selected notes to a knowledge base from the notes selection flow', async () => {
    const { AddToKnowledgeBasePanel } = await import('@/components/knowledge-bases/AddToKnowledgeBasePanel')

    render(<AddToKnowledgeBasePanel noteIds={['note-1', 'note-2']} />)

    fireEvent.change(await screen.findByLabelText('目标知识库'), {
      target: { value: 'kb-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /加入知识库/ }))

    await waitFor(() => {
      expect(mockKnowledgeBasesAPI.addNote).toHaveBeenCalledTimes(2)
      expect(mockKnowledgeBasesAPI.addNote).toHaveBeenNthCalledWith(1, 'kb-1', 'note-1')
      expect(mockKnowledgeBasesAPI.addNote).toHaveBeenNthCalledWith(2, 'kb-1', 'note-2')
    })
    expect(mockToast.success).toHaveBeenCalledWith('已加入知识库，重复笔记会自动保持一份')
  })

  test('builds and renders a graph proposal for the selected knowledge base', async () => {
    const { default: KnowledgeBasesPage } = await import('@/app/dashboard/knowledge-bases/page')

    render(<KnowledgeBasesPage />)

    expect((await screen.findAllByText('AI Research')).length).toBeGreaterThan(0)
    await screen.findByRole('button', { name: /笔记 1/ })

    fireEvent.click(screen.getByTestId('build-graph-proposal'))

    await waitFor(() => {
      expect(mockKnowledgeBasesAPI.buildGraphProposal).toHaveBeenCalledWith('kb-1')
    })
    expect((await screen.findAllByText('Attention')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Graphs').length).toBeGreaterThan(0)
    expect(screen.getByText('supports')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Low evidence edge kept for review/ }))
    expect(screen.getAllByText('Low evidence edge kept for review.').length).toBeGreaterThan(0)
  })

  test('saves a generated graph proposal to the selected knowledge base', async () => {
    const { default: KnowledgeBasesPage } = await import('@/app/dashboard/knowledge-bases/page')

    render(<KnowledgeBasesPage />)

    expect((await screen.findAllByText('AI Research')).length).toBeGreaterThan(0)
    await screen.findByRole('button', { name: /笔记 1/ })
    fireEvent.click(screen.getByTestId('build-graph-proposal'))
    expect((await screen.findAllByText('Attention')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByTestId('save-graph-proposal'))

    await waitFor(() => {
      expect(mockKnowledgeBasesAPI.saveGraph).toHaveBeenCalledWith('kb-1', {
        nodes: graphProposal.nodes,
        edges: graphProposal.edges,
      })
    })
    expect(await screen.findByText(/已保存图谱/)).toBeInTheDocument()
  })

  test('shows empty states when no knowledge base exists', async () => {
    mockKnowledgeBasesAPI.getAll.mockResolvedValue([])
    const { default: KnowledgeBasesPage } = await import('@/app/dashboard/knowledge-bases/page')
    const { AddToKnowledgeBasePanel } = await import('@/components/knowledge-bases/AddToKnowledgeBasePanel')

    render(
      <>
        <KnowledgeBasesPage />
        <AddToKnowledgeBasePanel noteIds={['note-1']} />
      </>,
    )

    expect(await screen.findByText('还没有知识库。先创建一个，再从笔记列表加入内容。')).toBeInTheDocument()
    expect(await screen.findByText('暂无知识库')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /加入知识库/ })).toBeDisabled()
  })

  test('快速切换知识库时旧图谱请求不能覆盖当前选择', async () => {
    const oldGraph = deferred<typeof graphProposal>()
    mockKnowledgeBasesAPI.getAll.mockResolvedValue([kb, kb2])
    mockKnowledgeBasesAPI.getNotes.mockResolvedValue([])
    mockKnowledgeBasesAPI.getGraph
      .mockImplementationOnce(() => oldGraph.promise)
      .mockResolvedValueOnce({
        ...graphProposal,
        knowledgeBaseId: 'kb-2',
        nodes: [{ ...graphProposal.nodes[0], id: 'kb2-node', label: 'KB2 Node' }],
        edges: [],
      })
    const { default: KnowledgeBasesPage } = await import('@/app/dashboard/knowledge-bases/page')

    render(<KnowledgeBasesPage />)
    fireEvent.click(await screen.findByRole('button', { name: /第二知识库/ }))
    expect(await screen.findByText('KB2 Node')).toBeInTheDocument()

    oldGraph.resolve(graphProposal)

    await waitFor(() => expect(screen.queryByText('Attention')).not.toBeInTheDocument())
    expect(screen.getByText('KB2 Node')).toBeInTheDocument()
  })
})
