import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

const mockHandleSave = jest.fn()
const mockSetNewTitle = jest.fn()
const mockSetCurrentContent = jest.fn()

jest.mock('next/dynamic', () => () => function MockTiptapEditor(props: any) {
  return (
    <div
      data-testid="new-note-tiptap"
      data-local-only={String(Boolean(props.localOnly))}
    >
      <button type="button" onClick={() => props.onContentChange?.('<p>正文</p>')}>输入正文</button>
    </div>
  )
})

jest.mock('@/app/dashboard/notes/new/useNewNotePage', () => ({
  useNewNotePage: () => ({
    categories: [],
    tags: [],
    directoryNotes: [{ id: 'existing-1', title: '已有笔记', content: '', tags: [], visibility: 'private' }],
    directorySearch: '',
    setDirectorySearch: jest.fn(),
    handleOpenNote: jest.fn(),
    selectedCategory: '',
    setSelectedCategory: jest.fn(),
    selectedTags: [],
    setSelectedTags: jest.fn(),
    tagInput: '',
    setTagInput: jest.fn(),
    metaLoading: false,
    metaError: '',
    newTitle: '计划标题',
    setNewTitle: mockSetNewTitle,
    currentContent: '<p></p>',
    setCurrentContent: mockSetCurrentContent,
    selection: { start: 0, end: 0 },
    setSelection: jest.fn(),
    isFullscreen: false,
    saving: false,
    saveError: '',
    editorContainerRef: { current: null },
    resolveCategoryId: jest.fn(),
    resolveTagId: jest.fn(),
    toggleTag: jest.fn(),
    addTagsByNames: jest.fn(),
    handleToggleFullscreen: jest.fn(),
    handleSave: mockHandleSave,
    handleCancel: jest.fn(),
  }),
}))

import NewNotePage from '@/app/dashboard/notes/new/page'

describe('NewNotePage', () => {
  beforeEach(() => {
    mockHandleSave.mockReset()
    mockSetNewTitle.mockReset()
    mockSetCurrentContent.mockReset()
  })

  test('uses the current editor workspace and local-only editor mode', () => {
    const { container } = render(<NewNotePage />)

    expect(screen.getByRole('main', { name: '新建笔记编辑器' })).toHaveClass('new-note-editor')
    expect(container.querySelector('.editor-layout-grid')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '编辑器导航' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '大纲' })).toBeInTheDocument()
    expect(container.querySelector('.editor-header')).toBeInTheDocument()
    expect(container.querySelector('.editor-paper')).toBeInTheDocument()
    expect(screen.getByTestId('new-note-tiptap')).toHaveAttribute('data-local-only', 'true')
    expect(screen.getByRole('button', { name: '创建笔记' })).toBeInTheDocument()
    expect(screen.queryByText(/仅本地/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开评论' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开协作' })).not.toBeInTheDocument()
    expect(container.querySelector('[style*="linear-gradient"]')).toBeNull()
  })

  test('keeps properties collapsed until the user opens them', () => {
    render(<NewNotePage />)

    expect(screen.queryByRole('complementary', { name: '笔记属性' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打开笔记属性' }))
    const properties = screen.getByRole('dialog', { name: '笔记属性' })
    expect(properties).toBeInTheDocument()
    expect(screen.queryByLabelText('可见性')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '查看历史版本' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭笔记属性' }))
    expect(screen.queryByRole('dialog', { name: '笔记属性' })).not.toBeInTheDocument()
  })

  test('uses the same draft content for header save and editor updates', () => {
    render(<NewNotePage />)

    fireEvent.click(screen.getByRole('button', { name: '输入正文' }))
    expect(mockSetCurrentContent).toHaveBeenCalledWith('<p>正文</p>')

    fireEvent.click(screen.getByRole('button', { name: '创建笔记' }))
    expect(mockHandleSave).toHaveBeenCalledWith('计划标题', '<p></p>')
  })
})
