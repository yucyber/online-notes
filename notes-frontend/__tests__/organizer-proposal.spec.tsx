import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import OrganizerProposalPanel from '@/components/organizer/OrganizerProposalPanel'
import type { OrganizerProposal } from '@/components/organizer/organizer-types'

const baseProposal: OrganizerProposal = {
  id: 'proposal-1',
  userId: 'u1',
  status: 'pending',
  revision: 1,
  summary: '整理建议',
  actions: [
    {
      actionId: 'a1',
      type: 'create_knowledge_base',
      riskLevel: 'low',
      reason: '归入新主题',
      noteIds: ['n1', 'n2'],
      evidenceChunkIds: ['chunk-1'],
      expectedUpdatedAt: [],
      knowledgeBaseName: '前端',
    },
    {
      actionId: 'a2',
      type: 'rewrite_note',
      riskLevel: 'high',
      reason: '内容需要结构化',
      noteIds: ['n3'],
      evidenceChunkIds: [],
      expectedUpdatedAt: [],
      payload: { body: '建议正文' },
    },
  ],
}

test('renders checklist, evidence and never shows execute button', () => {
  render(<OrganizerProposalPanel proposal={baseProposal} />)

  expect(screen.getByTestId('organizer-proposal-panel')).toBeInTheDocument()
  expect(screen.getByTestId('proposal-action-a1')).toBeInTheDocument()
  expect(screen.getByTestId('proposal-action-a2')).toBeInTheDocument()
  expect(screen.getByText('高风险')).toBeInTheDocument()
  expect(screen.getByTestId('evidence-chunk')).toHaveTextContent('chunk-1')
  expect(screen.getByTestId('no-execute-hint')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /执行/ })).not.toBeInTheDocument()
})

test('can toggle actions and rename knowledge base', () => {
  const toggled: string[] = []
  const renamed: Array<{ actionId: string; name: string }> = []

  render(
    <OrganizerProposalPanel
      proposal={baseProposal}
      selectedActionIds={['a2']}
      onToggleAction={(actionId, checked) => toggled.push(`${actionId}:${checked}`)}
      onRenameKnowledgeBase={(actionId, name) => renamed.push({ actionId, name })}
    />,
  )

  const checkboxA1 = screen.getByLabelText('a1') as HTMLInputElement
  fireEvent.click(checkboxA1)
  expect(toggled).toEqual(['a1:true'])

  const nameInput = screen.getByLabelText('知识库名称') as HTMLInputElement
  fireEvent.change(nameInput, { target: { value: '前端重构' } })
  fireEvent.blur(nameInput)
  expect(renamed).toEqual([{ actionId: 'a1', name: '前端重构' }])
})

test('stale proposal shows rework warning and rework callback', () => {
  const reworked: string[] = []
  render(
    <OrganizerProposalPanel
      proposal={{ ...baseProposal, status: 'stale' }}
      onRework={(actionId) => reworked.push(actionId)}
    />,
  )

  expect(screen.getByTestId('proposal-status')).toHaveTextContent('stale')
  expect(screen.getByText(/执行前需要返工/)).toBeInTheDocument()
  const reworkButtons = screen.getAllByRole('button', { name: '返工' })
  expect(reworkButtons.length).toBeGreaterThan(0)
  fireEvent.click(reworkButtons[0])
  expect(reworked).toEqual(['a1'])
})
