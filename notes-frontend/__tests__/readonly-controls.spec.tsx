import { render, screen } from '@testing-library/react'
import TiptapToolbar from '@/components/editor/TiptapToolbar'
import { NotesListCard } from '@/components/notes/NotesListCard'
import { NoteEditorHeader } from '@/components/editor/NoteEditorHeader'

const note = {
  id: 'n1', title: '共享笔记', content: 'body', tags: [],
  createdAt: '2026-08-10', updatedAt: '2026-08-10', userId: 'owner',
  acl: [{ userId: 'viewer', role: 'viewer' as const }],
}

test('read-only toolbar disables every mutating control but keeps fullscreen available', () => {
  render(<TiptapToolbar disabled exec={jest.fn()} />)

  for (const name of ['左对齐', '居中', '高亮', '上标', '撤销', '保存', '打开评论']) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }
  expect(screen.getByLabelText('文字颜色')).toBeDisabled()
  expect(screen.getByRole('button', { name: '进入全屏' })).toBeEnabled()
})

test('viewer sees a view action without a delete action', () => {
  render(<NotesListCard note={note} index={0} categoryMap={{}} isSelectionMode={false}
    selectedNoteIds={new Set()} onToggleSelection={jest.fn()} onRequestDelete={jest.fn()}
    resolveTagId={() => ''} resolveTagLabel={() => ''} currentUserId="viewer" />)

  expect(screen.getByTitle('查看')).toBeInTheDocument()
  expect(screen.queryByTitle('删除')).not.toBeInTheDocument()
})

test('read-only editor header describes the page as viewing', () => {
  render(<NoteEditorHeader note={note} editorMode="rich" showSidebar onBack={jest.fn()}
    onModeChange={jest.fn()} onVisibilityChange={jest.fn()} onToggleSidebar={jest.fn()}
    onOpenCollab={jest.fn()} readOnly />)

  expect(screen.getByText('查看笔记')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '打开协作' })).toBeEnabled()
})
