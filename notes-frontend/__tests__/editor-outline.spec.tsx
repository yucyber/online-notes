import { fireEvent, render, screen, within } from '@testing-library/react'
import NoteEditorShell from '@/components/editor/NoteEditorShell'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => (props: any) => {
    // 模拟 TiptapEditor 初始化时通过 onContentChange 填充大纲 toc。
    props?.onContentChange?.(props.initialHTML || '<p></p>')
    return <div data-testid="dynamic-editor" />
  },
}))
jest.mock('marked', () => ({ marked: { parse: jest.fn() } }))
jest.mock('react-hot-toast', () => ({
  Toaster: () => null,
  toast: { dismiss: jest.fn() },
}))
jest.mock('@/components/editor/TiptapToolbar', () => ({ __esModule: true, default: () => <div /> }))
jest.mock('@/components/editor/NoteEditorDrawers', () => ({ NoteEditorDrawers: () => null }))
jest.mock('@/components/editor/useNoteSave', () => ({
  useNoteSave: () => ({ handleSave: jest.fn(), handleSaveDraft: jest.fn(), addTagsByNames: jest.fn() }),
}))
jest.mock('@/components/editor/useEditorAutoSave', () => ({
  useEditorAutoSave: () => ({ state: { status: 'saved' }, saveNow: jest.fn() }),
}))
jest.mock('@/components/editor/note-permissions', () => ({
  canWriteNote: () => true,
  shouldManageNoteLock: () => false,
}))
jest.mock('@/lib/api', () => ({
  fetchCategories: jest.fn(() => new Promise(() => {})),
  fetchTags: jest.fn(() => new Promise(() => {})),
  fetchNoteById: jest.fn(),
  fetchNotes: jest.fn(() => Promise.resolve({ items: [] })),
  lockNote: jest.fn(),
  unlockNote: jest.fn(),
  boardsAPI: { create: jest.fn() },
  mindmapsAPI: { create: jest.fn() },
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: () => null }))

describe('编辑器大纲交互', () => {
  const note = { id: 'n1', title: '大纲测试', content: '<h1>第一节</h1><h2>子节</h2>', tags: [], visibility: 'private' } as any

  it('宽屏大纲条目点击派发 editor:scrollToHeading 事件', () => {
    const dispatch = jest.spyOn(document, 'dispatchEvent')
    render(<NoteEditorShell id="n1" initialData={note} />)
    const outline = screen.getByRole('complementary', { name: '大纲' })
    const item = within(outline).getByText('第一节')
    fireEvent.click(item)
    const evt = dispatch.mock.calls.map((c) => c[0] as CustomEvent).find((e) => e.type === 'editor:scrollToHeading')
    expect(evt).toBeDefined()
    expect((evt as CustomEvent).detail.index).toBe(0)
  })

  it('大纲隐藏按钮切换 pin 状态', () => {
    render(<NoteEditorShell id="n1" initialData={note} />)
    const outline = screen.getByRole('complementary', { name: '大纲' })
    fireEvent.click(within(outline).getByRole('button', { name: '隐藏大纲' }))
    expect(outline).toHaveAttribute('data-pinned', 'false')
  })

  it('抽屉大纲条目点击派发事件并关闭抽屉', () => {
    const dispatch = jest.spyOn(document, 'dispatchEvent')
    render(<NoteEditorShell id="n1" initialData={note} />)
    fireEvent.click(screen.getByRole('button', { name: '打开大纲' }))
    const dialog = screen.getByRole('dialog', { name: '大纲' })
    fireEvent.click(within(dialog).getByText('第一节'))
    const evt = dispatch.mock.calls.map((c) => c[0] as CustomEvent).find((e) => e.type === 'editor:scrollToHeading')
    expect(evt).toBeDefined()
    expect(screen.queryByRole('dialog', { name: '大纲' })).not.toBeInTheDocument()
  })
})
