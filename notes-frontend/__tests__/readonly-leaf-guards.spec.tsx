import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CommentsPanel } from '@/components/collab/CommentsPanel'
import { CollaboratorsPanel } from '@/components/collab/CollaboratorsPanel'
import { commentsAPI, createComment, invitationsAPI } from '@/lib/api'

jest.mock('@/lib/api', () => ({
  aclAPI: { get: jest.fn().mockResolvedValue({ visibility: 'private', canManage: true, acl: [] }) },
  invitationsAPI: {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ token: 'invite-token', expiresAt: '2026-08-12T00:00:00.000Z' }),
  },
  listComments: jest.fn().mockResolvedValue([]),
  createComment: jest.fn().mockResolvedValue({ id: 'created-comment' }),
  commentsAPI: {
    list: jest.fn().mockResolvedValue([{
      _id: 'comment-1', authorId: 'viewer', start: 0, end: 2, text: '已有评论', replies: [],
    }]),
    reply: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  },
}))

beforeEach(() => {
  localStorage.setItem('notes_user_id', 'viewer')
  jest.clearAllMocks()
})

test('comment leaf handlers reject create, reply, and delete after permission becomes read-only', async () => {
  const props = { noteId: 'note-1', selection: { start: 0, end: 2 } }
  const { rerender } = render(<CommentsPanel {...props} readOnly={false} />)
  await screen.findByText('已有评论')

  fireEvent.change(screen.getByRole('textbox', { name: '评论内容' }), { target: { value: '新评论' } })
  fireEvent.change(screen.getByRole('textbox', { name: '回复内容' }), { target: { value: '新回复' } })
  rerender(<CommentsPanel {...props} readOnly />)

  for (const name of ['提交评论', '提交回复', '删除评论']) {
    const button = screen.getByRole('button', { name })
    button.removeAttribute('disabled')
    fireEvent.click(button)
  }

  await waitFor(() => {
    expect(createComment).not.toHaveBeenCalled()
    expect(commentsAPI.reply).not.toHaveBeenCalled()
    expect(commentsAPI.delete).not.toHaveBeenCalled()
  })
})

test('invitation controls disappear after permission becomes read-only', async () => {
  const { rerender } = render(<CollaboratorsPanel noteId="note-1" readOnly={false} />)
  const email = await screen.findByRole('textbox', { name: '邀请邮箱' })
  fireEvent.change(email, { target: { value: 'reader@example.com' } })

  rerender(<CollaboratorsPanel noteId="note-1" readOnly />)

  expect(screen.queryByRole('textbox', { name: '邀请邮箱' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '发送邀请' })).not.toBeInTheDocument()
  expect(invitationsAPI.create).not.toHaveBeenCalled()
})
