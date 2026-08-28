import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import NoteEditorShell from '@/components/editor/NoteEditorShell'
import { notesAPI } from '@/lib/api'

let mockQuery = new Map<string, string>()
let mockEditorMarkup = ''
let mockPublishEditorMarkup = (_value: string) => undefined

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: (key: string) => mockQuery.get(key) ?? null }),
}))

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => function MockEditor(props: any) {
    const rootRef = React.useRef<HTMLDivElement>(null)
    const [markup, setMarkup] = React.useState(() => mockEditorMarkup)
    React.useEffect(() => {
      mockPublishEditorMarkup = (value: string) => setMarkup(value)
      props.onReady?.(rootRef.current)
      return () => {
        mockPublishEditorMarkup = () => undefined
        props.onReady?.(null)
      }
    }, [props.onReady])
    return <div ref={rootRef} className="ProseMirror" dangerouslySetInnerHTML={{ __html: markup }} />
  },
}))

jest.mock('@/lib/auth', () => ({ getCurrentUser: () => ({ id: 'owner', email: 'owner@example.com' }) }))
jest.mock('@/lib/app-toast', () => ({ appToast: { error: jest.fn(), dismiss: jest.fn() } }))
jest.mock('@/lib/api', () => ({
  fetchNoteById: jest.fn(),
  fetchNotes: jest.fn().mockResolvedValue({ items: [], page: 1, size: 50, total: 0 }),
  fetchCategories: jest.fn().mockResolvedValue([]),
  fetchTags: jest.fn().mockResolvedValue([]),
  updateNote: jest.fn().mockResolvedValue(undefined),
  boardsAPI: { create: jest.fn() },
  mindmapsAPI: { create: jest.fn() },
  notesAPI: { getChunkLocation: jest.fn() },
  aclAPI: { get: jest.fn().mockResolvedValue({ visibility: 'private', acl: [] }) },
  invitationsAPI: { list: jest.fn().mockResolvedValue([]), create: jest.fn() },
  commentsAPI: { list: jest.fn().mockResolvedValue([]), reply: jest.fn(), delete: jest.fn() },
  listComments: jest.fn().mockResolvedValue([]),
}))

const mockNotesAPI = notesAPI as jest.Mocked<typeof notesAPI>
const note = {
  id: 'note-1', title: '证据笔记', content: '<h2>Child</h2><p>精确证据正文</p>', tags: [],
  createdAt: '2026-08-28', updatedAt: '2026-08-28', userId: 'owner', visibility: 'private', acl: [],
}
const scrollIntoView = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  mockQuery = new Map([
    ['chunkId', 'chunk-1'],
    ['heading', 'Root > Child'],
  ])
  mockEditorMarkup = '<h2>Child</h2><p data-testid="anchor-block">精确证据正文及后续内容</p>'
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
})

test('有效 chunkId 在编辑器渲染后定位 anchorText 并滚动', async () => {
  mockNotesAPI.getChunkLocation.mockResolvedValue({
    chunkId: 'chunk-1', headingPath: ['Root', 'Child'], anchorText: '精确证据正文',
  })

  render(<NoteEditorShell id="note-1" initialData={note as any} initialContent={note.content} />)

  await waitFor(() => expect(mockNotesAPI.getChunkLocation).toHaveBeenCalledWith('note-1', 'chunk-1'))
  await waitFor(() => expect(screen.getByTestId('anchor-block')).toHaveClass('evidence-location-target'))
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  expect(screen.queryByText('未找到原证据位置')).not.toBeInTheDocument()
})

test('chunkId 失效后按 URL headingPath 定位标题', async () => {
  mockNotesAPI.getChunkLocation.mockRejectedValue(new Error('404'))

  render(<NoteEditorShell id="note-1" initialData={note as any} initialContent={note.content} />)

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Child' })).toHaveClass('evidence-location-target'))
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  expect(screen.queryByText('未找到原证据位置')).not.toBeInTheDocument()
})

test('chunk 与 heading 都无法定位时保持页面可用并显示降级提示', async () => {
  mockNotesAPI.getChunkLocation.mockRejectedValue(new Error('404'))
  mockQuery.set('heading', 'Root > Missing')

  render(<NoteEditorShell id="note-1" initialData={note as any} initialContent={note.content} />)

  expect(await screen.findByText('未找到原证据位置')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '证据笔记' })).toBeInTheDocument()
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
})

test('协同正文晚于 editor view 到达时自动重试定位', async () => {
  mockEditorMarkup = ''
  mockNotesAPI.getChunkLocation.mockResolvedValue({
    chunkId: 'chunk-1', headingPath: ['Root', 'Child'], anchorText: '异步到达的证据',
  })

  render(<NoteEditorShell id="note-1" initialData={note as any} initialContent={note.content} />)
  expect(await screen.findByText('未找到原证据位置')).toBeInTheDocument()

  await act(async () => {
    mockPublishEditorMarkup('<h2>Child</h2><p data-testid="late-anchor">异步到达的证据</p>')
  })

  await waitFor(() => expect(screen.getByTestId('late-anchor')).toHaveClass('evidence-location-target'))
  expect(mockNotesAPI.getChunkLocation).toHaveBeenCalledTimes(1)
})

test('重复标题按完整 headingPath 定位到正确章节', async () => {
  mockEditorMarkup = [
    '<h1>第一部分</h1><h2 data-testid="wrong-child">Child</h2>',
    '<h1>第二部分</h1><h2 data-testid="right-child">Child</h2>',
  ].join('')
  mockNotesAPI.getChunkLocation.mockRejectedValue(new Error('404'))
  mockQuery.set('heading', '证据笔记 > 第二部分 > Child')

  render(<NoteEditorShell id="note-1" initialData={note as any} initialContent={note.content} />)

  await waitFor(() => expect(screen.getByTestId('right-child')).toHaveClass('evidence-location-target'))
  expect(screen.getByTestId('wrong-child')).not.toHaveClass('evidence-location-target')
})

test('无关 DOM mutation 不重复回顶且协同正文晚到后仍能成功定位', async () => {
  mockEditorMarkup = '<p>其他正文</p>'
  mockNotesAPI.getChunkLocation.mockResolvedValue({
    chunkId: 'chunk-1', headingPath: ['Root', 'Child'], anchorText: '异步到达的证据',
  })

  render(<NoteEditorShell id="note-1" initialData={note as any} initialContent={note.content} />)
  expect(await screen.findByText('未找到原证据位置')).toBeInTheDocument()
  expect(scrollIntoView).toHaveBeenCalledTimes(1)

  await act(async () => {
    mockPublishEditorMarkup('<p>其他正文发生普通变化</p>')
  })
  await waitFor(() => expect(screen.getByText('其他正文发生普通变化')).toBeInTheDocument())
  expect(scrollIntoView).toHaveBeenCalledTimes(1)

  await act(async () => {
    mockPublishEditorMarkup('<p data-testid="eventual-anchor">异步到达的证据</p>')
  })
  await waitFor(() => expect(screen.getByTestId('eventual-anchor')).toHaveClass('evidence-location-target'))
  expect(scrollIntoView).toHaveBeenCalledTimes(2)
  expect(mockNotesAPI.getChunkLocation).toHaveBeenCalledTimes(1)
})
