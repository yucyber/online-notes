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

  it('大纲持续显示时按钮为有斜杠小眼睛，点击进入隐藏态', () => {
    render(<NoteEditorShell id="n1" initialData={note} />)
    const outline = screen.getByRole('complementary', { name: '大纲' })
    expect(outline).toHaveAttribute('data-pinned', 'true')
    // pinned=true 时按钮 aria-label 为"收起大纲"（有斜杠小眼睛 EyeOff）
    fireEvent.click(within(outline).getByRole('button', { name: '收起大纲' }))
    expect(outline).toHaveAttribute('data-pinned', 'false')
  })

  it('大纲隐藏态按钮为无斜杠小眼睛，点击正文不自动关闭', () => {
    render(<NoteEditorShell id="n1" initialData={note} />)
    const outline = screen.getByRole('complementary', { name: '大纲' })
    fireEvent.click(within(outline).getByRole('button', { name: '收起大纲' }))
    expect(outline).toHaveAttribute('data-pinned', 'false')
    // pinned=false 时按钮 aria-label 变为"展开大纲"（无斜杠小眼睛 Eye）
    expect(within(outline).getByRole('button', { name: '展开大纲' })).toBeInTheDocument()
    // 点击大纲条目不应自动关闭大纲（无抽屉/无自动隐藏）
    fireEvent.click(within(outline).getByText('第一节'))
    expect(screen.getByRole('complementary', { name: '大纲' })).toBeInTheDocument()
  })
})
