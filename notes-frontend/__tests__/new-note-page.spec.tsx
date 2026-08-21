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
    selectedCategory: '',
    setSelectedCategory: jest.fn(),
    selectedTags: [],
    setSelectedTags: jest.fn(),
    tagInput: '',
    setTagInput: jest.fn(),
    metaLoading: false,
    metaError: '',
    visibility: 'private',
    setVisibility: jest.fn(),
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
    expect(screen.getByTestId('new-note-tiptap')).toHaveAttribute('data-local-only', 'true')
    expect(screen.getByRole('button', { name: '创建笔记' })).toBeInTheDocument()
    expect(container.querySelector('[style*="linear-gradient"]')).toBeNull()
  })

  test('uses the same draft content for header save and editor updates', () => {
    render(<NewNotePage />)

    fireEvent.click(screen.getByRole('button', { name: '输入正文' }))
    expect(mockSetCurrentContent).toHaveBeenCalledWith('<p>正文</p>')

    fireEvent.click(screen.getByRole('button', { name: '创建笔记' }))
    expect(mockHandleSave).toHaveBeenCalledWith('计划标题', '<p></p>')
  })
})
