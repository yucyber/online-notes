import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const mockKnowledgeBasesAPI = {
  getAll: jest.fn(),
  create: jest.fn(),
  getNotes: jest.fn(),
  addNote: jest.fn(),
  removeNote: jest.fn(),
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

const kb = {
  id: 'kb-1',
  name: 'AI Research',
  description: 'Graph work',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
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
  })

  test('lists knowledge bases, creates one, and removes a note from the selected base', async () => {
    const { default: KnowledgeBasesPage } = await import('@/app/dashboard/knowledge-bases/page')

    render(<KnowledgeBasesPage />)

    expect((await screen.findAllByText('AI Research')).length).toBeGreaterThan(0)
    expect(await screen.findByText('Transformer Notes')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('从知识库移除 Transformer Notes'))

    await waitFor(() => {
      expect(mockKnowledgeBasesAPI.removeNote).toHaveBeenCalledWith('kb-1', 'note-1')
    })

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
})
