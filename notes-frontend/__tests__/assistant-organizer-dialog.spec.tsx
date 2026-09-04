import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import AssistantOrganizerDialog from '@/components/assistant/AssistantOrganizerDialog'

const mockListProposals = jest.fn()
const mockListExecutions = jest.fn()
const mockRunAgent = jest.fn()
const mockExecuteProposal = jest.fn()
const mockUndoExecution = jest.fn()
const mockGetAll = jest.fn()

jest.mock('@/lib/api/organizer', () => ({
  organizerAPI: {
    listProposals: (...args: unknown[]) => mockListProposals(...args),
    listExecutions: (...args: unknown[]) => mockListExecutions(...args),
    runAgent: (...args: unknown[]) => mockRunAgent(...args),
    executeProposal: (...args: unknown[]) => mockExecuteProposal(...args),
    undoExecution: (...args: unknown[]) => mockUndoExecution(...args),
  },
}))

jest.mock('@/lib/api/notes', () => ({
  notesAPI: { getAll: (...args: unknown[]) => mockGetAll(...args) },
}))

const noteTitles: Record<string, string> = { n1: '毫秒基线笔记', n2: 'MCP 总结笔记' }

const proposal = {
  id: 'proposal-1',
  userId: 'u1',
  status: 'pending',
  revision: 1,
  summary: '小助手生成的整理提案',
  actions: [
    {
      actionId: 'a1',
      type: 'create_knowledge_base',
      riskLevel: 'low',
      reason: '新主题',
      noteIds: ['n1'],
      evidenceChunkIds: [],
      expectedUpdatedAt: [],
      knowledgeBaseName: '毫秒基线库',
    },
    {
      actionId: 'a2',
      type: 'rewrite_note',
      riskLevel: 'high',
      reason: '结构化',
      noteIds: ['n2'],
      evidenceChunkIds: [],
      expectedUpdatedAt: [],
      payload: { body: '新正文' },
    },
  ],
}

function renderDialog() {
  return render(<AssistantOrganizerDialog open onOpenChange={() => undefined} />)
}

describe('assistant organizer dialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockListProposals.mockResolvedValue([proposal])
    mockListExecutions.mockResolvedValue([])
    mockRunAgent.mockResolvedValue({ generated: false, reason: 'pending_exists' })
    mockGetAll.mockImplementation((params: any = {}) => {
      const ids: string[] = Array.isArray(params?.ids) ? params.ids : []
      return Promise.resolve({
        items: ids
          .filter((id: string) => noteTitles[id])
          .map((id: string) => ({
            id,
            title: noteTitles[id],
            content: '',
            categoryId: undefined,
            category: null,
            tags: [],
            createdAt: '',
            updatedAt: '',
            userId: 'u1',
            status: 'published',
          })),
        page: 1,
        size: ids.length,
        total: ids.length,
      })
    })
  })

  test('shows proposals with note names and two-step execute confirm', async () => {
    renderDialog()
    expect(await screen.findByText('小助手整理提案')).toBeInTheDocument()
    expect(await screen.findByText('小助手生成的整理提案')).toBeInTheDocument()
    expect(await screen.findByText((_, element) => element?.textContent === '涉及笔记：毫秒基线笔记')).toBeInTheDocument()
    expect(screen.getByTestId('diff-a2')).toHaveTextContent('建议正文')

    fireEvent.click(screen.getByRole('button', { name: '执行所选建议' }))
    expect(await screen.findByTestId('assistant-execute-scope')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-execute-scope-a1')).toHaveTextContent('创建知识库并归属笔记')
    expect(screen.getByRole('button', { name: '确认执行（含高风险）' })).toBeInTheDocument()

    mockExecuteProposal.mockResolvedValue({ id: 'exec-1', status: 'executed', actions: [] })
    fireEvent.click(screen.getByRole('button', { name: '确认执行（含高风险）' }))
    await waitFor(() => expect(mockExecuteProposal).toHaveBeenCalled())
    const args = mockExecuteProposal.mock.calls[0]
    expect(args[0]).toBe('proposal-1')
    expect(args[1]).toEqual(['a1', 'a2'])
    expect(typeof args[2]).toBe('string')
    expect(await screen.findByText('整理已执行，可在 30 天内整批撤销')).toBeInTheDocument()
  })

  test('manual generate button calls agent run and reports pending proposal', async () => {
    renderDialog()
    const generateButton = await screen.findByRole('button', { name: '立即生成提案' })
    await waitFor(() => expect(generateButton).toBeEnabled())
    fireEvent.click(generateButton)
    await waitFor(() => expect(mockRunAgent).toHaveBeenCalled())
    expect(await screen.findByText('已有一条待确认提案，先处理它再生成新的')).toBeInTheDocument()
  })

  test('undo conflict keeps confirm disabled and lists affected notes', async () => {
    mockListExecutions.mockResolvedValue([{
      id: 'exec-1',
      proposalId: 'proposal-1',
      proposalRevision: 1,
      status: 'executed',
      actions: [{ actionId: 'a1', type: 'create_knowledge_base', noteIds: ['n1'] }],
      createdAt: '2026-09-04T08:00:00.000Z',
      undoDeadline: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    }])
    mockUndoExecution.mockResolvedValue({
      ok: false,
      conflicts: [{ noteId: 'n1', message: '笔记在执行后被编辑过，已阻止自动覆盖' }],
    })

    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: '整批撤销' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认撤销' }))
    await waitFor(() => expect(mockUndoExecution).toHaveBeenCalled())
    expect(await screen.findByText(/毫秒基线笔记/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认撤销' })).toBeDisabled()
  })
})
