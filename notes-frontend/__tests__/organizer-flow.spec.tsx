import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import OrganizerPage from '@/app/dashboard/organizer/page'

const mockListProposals = jest.fn()
const mockListExecutions = jest.fn()
const mockGetAll = jest.fn()
const mockExecuteProposal = jest.fn()
const mockUndoExecution = jest.fn()

jest.mock('@/lib/api/organizer', () => ({
  organizerAPI: {
    listProposals: (...args: unknown[]) => mockListProposals(...args),
    listExecutions: (...args: unknown[]) => mockListExecutions(...args),
    refreshStale: jest.fn(),
    deleteProposal: jest.fn(),
    createGlobal: jest.fn(),
    createIncremental: jest.fn(),
    executeProposal: (...args: unknown[]) => mockExecuteProposal(...args),
    undoExecution: (...args: unknown[]) => mockUndoExecution(...args),
  },
}))

jest.mock('@/lib/api/notes', () => ({
  notesAPI: { getAll: (...args: unknown[]) => mockGetAll(...args) },
}))

const proposal = {
  id: 'proposal-1',
  userId: 'u1',
  status: 'pending',
  revision: 1,
  summary: '整理建议',
  actions: [
    {
      actionId: 'a1',
      type: 'rewrite_note',
      riskLevel: 'high',
      reason: '结构化',
      noteIds: ['n1'],
      evidenceChunkIds: [],
      expectedUpdatedAt: [],
      payload: { body: '新正文' },
    },
    {
      actionId: 'a2',
      type: 'create_knowledge_base',
      riskLevel: 'low',
      reason: '新主题',
      noteIds: ['n2'],
      evidenceChunkIds: [],
      expectedUpdatedAt: [],
      knowledgeBaseName: '新库',
    },
  ],
}

describe('organizer execute and undo flow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockListProposals.mockResolvedValue([proposal])
    mockListExecutions.mockResolvedValue([])
    mockGetAll.mockResolvedValue({ items: [], total: 0 })
  })

  test('opens execute confirm dialog and lists affected notes', async () => {
    render(<OrganizerPage />)
    const executeButton = await screen.findByRole('button', { name: '执行所选建议' })
    fireEvent.click(executeButton)
    expect(await screen.findByText('确认执行所选建议')).toBeInTheDocument()
    expect(screen.getByTestId('execute-scope')).toBeInTheDocument()
    expect(screen.getByTestId('execute-scope-a1')).toHaveTextContent('改写笔记内容')
    expect(screen.getByTestId('execute-scope-a1')).toHaveTextContent('涉及笔记：n1')
    expect(screen.getByTestId('execute-scope-a2')).toHaveTextContent('创建知识库并归属笔记')
  })

  test('confirm execute calls backend with selected action ids', async () => {
    mockExecuteProposal.mockResolvedValue({
      id: 'exec-1',
      proposalId: 'proposal-1',
      proposalRevision: 1,
      status: 'executed',
      actions: [],
      undoDeadline: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    })
    render(<OrganizerPage />)
    const executeButton = await screen.findByRole('button', { name: '执行所选建议' })
    fireEvent.click(executeButton)
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    await waitFor(() => expect(mockExecuteProposal).toHaveBeenCalled())
    const args = mockExecuteProposal.mock.calls[0]
    expect(args[0]).toBe('proposal-1')
    expect(args[1]).toEqual(['a1', 'a2'])
    expect(typeof args[2]).toBe('string')
  })
})

test('undo conflict keeps dialog open and shows notes requiring manual handling', async () => {
  mockListExecutions.mockResolvedValue([{
    id: 'exec-1',
    proposalId: 'proposal-1',
    proposalRevision: 1,
    status: 'executed',
    actions: [{ actionId: 'a1', type: 'rewrite_note', noteIds: ['n1'] }],
    undoDeadline: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  }])
  mockUndoExecution.mockResolvedValue({
    ok: false,
    conflicts: [{ noteId: 'n1', message: '笔记在执行后被编辑过，已阻止自动覆盖' }],
  })
  render(<OrganizerPage />)

  const undoButton = await screen.findByRole('button', { name: '整批撤销' })
  fireEvent.click(undoButton)
  fireEvent.click(await screen.findByRole('button', { name: '确认撤销' }))
  await waitFor(() => expect(mockUndoExecution).toHaveBeenCalled())
  expect(await screen.findByText(/笔记 n1：/)).toBeInTheDocument()
  expect(screen.getByText(/已阻止自动覆盖/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '确认撤销' })).toBeDisabled()
})
