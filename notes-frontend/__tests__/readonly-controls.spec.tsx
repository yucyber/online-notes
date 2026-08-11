import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import TiptapToolbar from '@/components/editor/TiptapToolbar'
import { NotesListCard } from '@/components/notes/NotesListCard'
import { NoteEditorHeader } from '@/components/editor/NoteEditorHeader'
import { NoteEditorDrawers } from '@/components/editor/NoteEditorDrawers'
import NoteEditorShell from '@/components/editor/NoteEditorShell'
import { updateNote, createTag } from '@/lib/api'

const mockAppToastError = jest.fn()
const mockCreateComment = jest.fn()
const mockCommentReply = jest.fn()
const mockCommentDelete = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => (props: any) => (
    <div>
      <button onClick={() => props.onContentChange('<h2 id="readonly-heading">只读目录</h2>')}>同步只读内容</button>
      <button onClick={() => props.onSave('<p>尝试写入</p>')}>模拟编辑器保存</button>
      <div id="readonly-heading">目录目标</div>
    </div>
  ),
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: () => ({ id: 'viewer', email: 'viewer@example.com' }) }))
jest.mock('@/lib/app-toast', () => ({
  appToast: { error: (...args: unknown[]) => mockAppToastError(...args), dismiss: jest.fn() },
}))
jest.mock('@/lib/api', () => ({
  fetchNoteById: jest.fn(),
  fetchCategories: jest.fn().mockResolvedValue([{ id: 'category-1', name: '分类一' }]),
  fetchTags: jest.fn().mockResolvedValue([{ id: 'tag-1', name: '标签一' }]),
  updateNote: jest.fn().mockResolvedValue(undefined),
  createTag: jest.fn().mockResolvedValue({ id: 'tag-new', name: '新标签' }),
  lockNote: jest.fn().mockResolvedValue(undefined),
  unlockNote: jest.fn().mockResolvedValue(undefined),
  boardsAPI: { create: jest.fn() },
  mindmapsAPI: { create: jest.fn() },
  aclAPI: { get: jest.fn().mockResolvedValue({ visibility: 'shared', acl: [] }) },
  invitationsAPI: { list: jest.fn().mockResolvedValue([]), create: jest.fn() },
  listComments: jest.fn().mockResolvedValue([]),
  createComment: (...args: unknown[]) => mockCreateComment(...args),
  commentsAPI: {
    list: jest.fn().mockResolvedValue([]),
    reply: (...args: unknown[]) => mockCommentReply(...args),
    delete: (...args: unknown[]) => mockCommentDelete(...args),
  },
}))

const note = {
  id: 'n1', title: '共享笔记', content: '<h2 id="readonly-heading">只读目录</h2>', tags: [],
  createdAt: '2026-08-10', updatedAt: '2026-08-10', userId: 'owner', visibility: 'shared',
  acl: [{ userId: 'viewer', role: 'viewer' as const }],
}

beforeEach(() => {
  jest.clearAllMocks()
})

test('read-only toolbar blocks mutating handlers but keeps read actions available', () => {
  const exec = jest.fn()
  render(<TiptapToolbar disabled exec={exec} />)

  for (const name of ['插入更多内容', '插入图片', '插入链接', '保存', '打开评论']) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }
  fireEvent.change(screen.getByRole('combobox', { name: '样式' }), { target: { value: 'h2' } })
  fireEvent.change(screen.getByLabelText('文字颜色'), { target: { value: '#ff0000' } })
  expect(exec).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: '协作成员' }))
  expect(exec).toHaveBeenCalledWith('collab')
  expect(screen.getByRole('button', { name: '进入全屏' })).toBeEnabled()
})

test('viewer sees a view action without a delete action', () => {
  render(<NotesListCard note={note} index={0} categoryMap={{}} isSelectionMode={false}
    selectedNoteIds={new Set()} onToggleSelection={jest.fn()} onRequestDelete={jest.fn()}
    resolveTagId={() => ''} resolveTagLabel={() => ''} currentUserId="viewer" />)

  expect(screen.getByTitle('查看')).toBeInTheDocument()
  expect(screen.queryByTitle('删除')).not.toBeInTheDocument()
})

test('read-only editor header describes viewing while retaining navigation and collaborator access', () => {
  const onBack = jest.fn()
  const onOpenCollab = jest.fn()
  render(<NoteEditorHeader note={note} editorMode="rich" leftCollapsed={false} rightCollapsed={false}
    onBack={onBack} onModeChange={jest.fn()} onVisibilityChange={jest.fn()}
    onToggleLeft={jest.fn()} onToggleRight={jest.fn()} onOpenCollab={onOpenCollab} readOnly />)

  expect(screen.getByText('查看笔记')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '返回笔记' }))
  fireEvent.click(screen.getByRole('button', { name: '打开协作' }))
  expect(onBack).toHaveBeenCalledTimes(1)
  expect(onOpenCollab).toHaveBeenCalledTimes(1)
})

test('read-only drawers expose existing collaboration data without writable comment or invite controls', async () => {
  render(<NoteEditorDrawers id="n1" selection={{ start: 0, end: 2 }} showCollabDrawer showCommentsDrawer
    commentsDrawerRef={{ current: null }} onCloseCollab={jest.fn()} onCloseComments={jest.fn()} readOnly />)

  expect((await screen.findAllByText('协作者')).length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: '发送邀请' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '提交评论' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '刷新邀请与协作者状态' })).toBeEnabled()
})

test('viewer write attempts never issue note, tag, or comment requests while read navigation still works', async () => {
  const scrollIntoView = jest.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
  render(<NoteEditorShell id="n1" initialData={note as any} />)

  await waitFor(() => expect(screen.getByRole('option', { name: '分类一' })).toBeInTheDocument())
  expect(screen.getByRole('combobox', { name: '样式' })).toBeDisabled()
  expect(screen.getByRole('option', { name: '未分类' }).closest('select')).toBeDisabled()
  expect(screen.getByRole('button', { name: '标签一' })).toBeDisabled()

  fireEvent.click(screen.getByText('同步只读内容'))
  fireEvent.click(await screen.findByRole('button', { name: '只读目录' }))
  expect(scrollIntoView).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByRole('button', { name: '打开协作' }))
  expect((await screen.findAllByText('协作者')).length).toBeGreaterThan(0)
  expect(mockAppToastError).not.toHaveBeenCalled()

  fireEvent.keyDown(document, { key: 's', ctrlKey: true })
  document.dispatchEvent(new CustomEvent('tiptap:exec', { detail: { cmd: 'save' } }))
  fireEvent.click(screen.getByText('模拟编辑器保存'))

  await waitFor(() => expect(mockAppToastError).toHaveBeenCalledWith(expect.objectContaining({
    id: 'permission:n1',
    title: '当前笔记仅可查看',
  })))
  expect(updateNote).not.toHaveBeenCalled()
  expect(createTag).not.toHaveBeenCalled()
  expect(mockCreateComment).not.toHaveBeenCalled()
  expect(mockCommentReply).not.toHaveBeenCalled()
  expect(mockCommentDelete).not.toHaveBeenCalled()
})
