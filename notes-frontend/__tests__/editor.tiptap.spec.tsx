import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

const mockIndexeddbPersistenceConstructor = jest.fn()
const mockIndexeddbPersistenceDestroy = jest.fn()
const mockAppToastError = jest.fn()
const mockGetRoomTicket = jest.fn()
const mockListCommentMarks = jest.fn()
const mockWebsocketProviderInstances: any[] = []
const mockMarkedParse = jest.fn((raw: string) => {
  if (raw === '# 旧标题') return '<h1>旧标题</h1>\n'
  if (raw === '[OpenAI](https://openai.com)') return '<p><a href="https://openai.com">OpenAI</a></p>\n'
  if (raw.startsWith('| 名称 |')) return '<table><thead><tr><th>名称</th><th>状态</th></tr></thead><tbody><tr><td>编辑器</td><td>完成</td></tr></tbody></table>'
  if (raw.startsWith('```ts')) return '<pre><code class="language-ts">const ready = true\n</code></pre>\n'
  return `<p>${raw}</p>\n`
})

jest.mock('y-websocket', () => {
  class WebsocketProvider {
    awareness = {
      clientID: 1,
      states: new Map(),
      setLocalStateField: jest.fn(),
      getStates: jest.fn(() => new Map()),
      getLocalState: jest.fn(() => ({})),
      setLocalState: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    }
    on = jest.fn()
    off = jest.fn()
    destroy = jest.fn()
    disconnect = jest.fn()
    connect = jest.fn()
    wsconnected = false
    wsconnecting = false
    synced = false
    constructor(public url: string, public room: string, public doc: any, public options: any) {
      mockWebsocketProviderInstances.push(this)
    }
  }
  return { WebsocketProvider }
})

jest.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve()
    destroy = mockIndexeddbPersistenceDestroy
    constructor(public name: string, public doc: any) {
      mockIndexeddbPersistenceConstructor(name, doc)
    }
  },
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => () => <div data-testid="dynamic-editor" />,
}))
jest.mock('marked', () => ({ marked: { parse: mockMarkedParse } }))
jest.mock('@/lib/app-toast', () => ({ appToast: { error: mockAppToastError } }))
jest.mock('@/lib/api', () => ({
  fetchCategories: jest.fn(() => new Promise(() => {})),
  fetchTags: jest.fn(() => new Promise(() => {})),
  updateNote: jest.fn(),
  lockNote: jest.fn(),
  unlockNote: jest.fn(),
  boardsAPI: { create: jest.fn() },
  mindmapsAPI: { create: jest.fn() },
  commentsAPI: { list: (...args: unknown[]) => mockListCommentMarks(...args) },
}))
jest.mock('@/lib/api/notes', () => ({
  notesAPI: {
    getRoomTicket: mockGetRoomTicket,
  },
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: () => null }))
jest.mock('@/components/editor/NoteEditorDrawers', () => ({ NoteEditorDrawers: () => null }))
jest.mock('@/components/editor/useNoteSave', () => ({
  useNoteSave: () => ({ handleSave: jest.fn(), handleSaveDraft: jest.fn(), addTagsByNames: jest.fn() }),
}))
jest.mock('@/components/editor/useEditorAutoSave', () => ({
  useEditorAutoSave: () => ({ state: 'saved', saveNow: jest.fn() }),
}))
jest.mock('@/components/editor/note-permissions', () => ({
  canWriteNote: () => true,
  shouldManageNoteLock: () => false,
}))

import TiptapEditor, { isLegacyRawMarkdownDocument } from '@/components/editor/TiptapEditor'
import TiptapToolbar from '@/components/editor/TiptapToolbar'
import NoteEditorShell from '@/components/editor/NoteEditorShell'
import { Editor } from '@tiptap/core'
import * as Y from 'yjs'
import { createTiptapExtensions } from '@/components/editor/tiptap-extensions'

describe('TiptapEditor 全区域输入', () => {
  const user = { id: 'u1', name: 'User One' }
  const originalIndexedDB = Object.getOwnPropertyDescriptor(window, 'indexedDB')
  beforeEach(() => {
    ;(process as any).env.NEXT_PUBLIC_YWS_URL = ''
    mockIndexeddbPersistenceConstructor.mockClear()
    mockIndexeddbPersistenceDestroy.mockClear()
    mockAppToastError.mockClear()
    mockGetRoomTicket.mockReset().mockImplementation(() => new Promise(() => {}))
    mockListCommentMarks.mockReset().mockResolvedValue([])
    mockWebsocketProviderInstances.length = 0
    installIndexedDbMock()
  })

  afterEach(() => {
    if (originalIndexedDB) {
      Object.defineProperty(window, 'indexedDB', originalIndexedDB)
    } else {
      Reflect.deleteProperty(window, 'indexedDB')
    }
  })

  it('容器空白点击聚焦并在文末输入', () => {
    const onSave = jest.fn()
    render(<TiptapEditor noteId="n1" initialHTML={'<p>abc</p>'} onSave={async () => onSave('')} user={user} />)
    const container = screen.getByText(/连接状态：/).closest('div')!.nextElementSibling as HTMLElement
    const evt = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(evt, 'target', { value: container })
    Object.defineProperty(evt, 'currentTarget', { value: container })
    container.dispatchEvent(evt)
    const editable = document.querySelector('.ProseMirror') as HTMLElement
    editable.focus()
    fireEvent.keyDown(editable, { key: 'a' })
    expect(editable).toBeInTheDocument()
  })

  it('只读态禁用保存', () => {
    const onSave = jest.fn()
    render(<TiptapEditor noteId="n1" initialHTML={'<p></p>'} onSave={async () => onSave('')} user={user} readOnly />)
    const saveBtn = screen.getByRole('button', { name: '保存' })
    expect(saveBtn).toBeDisabled()
  })

  it('只读态忽略所有程序化编辑事件且不改变编辑器内容', async () => {
    render(<TiptapEditor noteId="readonly-events" initialHTML="<p>原始内容</p>" onSave={async () => {}} user={user} readOnly />)
    const editable = document.querySelector('.ProseMirror') as HTMLElement
    const originalHTML = editable.innerHTML

    document.dispatchEvent(new CustomEvent('editor:setContent', { detail: { html: '<p>外部覆盖</p>' } }))
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'INSERT_MINDMAP', payload: { id: 'mindmap-1' } },
    }))
    document.dispatchEvent(new CustomEvent('comments:mark', { detail: { start: 1, end: 3, commentId: 'comment-1' } }))
    document.dispatchEvent(new CustomEvent('comments:replay', { detail: { noteId: 'readonly-events' } }))
    await act(async () => { await Promise.resolve() })

    expect(editable.innerHTML).toBe(originalHTML)
    expect(editable.querySelector('resource-embed')).not.toBeInTheDocument()
    expect(editable.querySelector('[data-comment-id]')).not.toBeInTheDocument()
  })

  it('权限在 provider 延迟 apply 前变为只读时不改变 editor 或 Y.Doc', async () => {
    process.env.NEXT_PUBLIC_YWS_URL = 'ws://localhost:1234'
    mockGetRoomTicket.mockResolvedValueOnce({ ticket: 'writer-ticket', role: 'writer', expiresIn: 60 })
    const props = { noteId: 'delayed-readonly', initialHTML: '<p>初始内容</p>', onSave: async () => {}, user }
    const { rerender } = render(<TiptapEditor {...props} />)

    const editable = document.querySelector('.ProseMirror') as HTMLElement
    await waitFor(() => expect(editable).toHaveAttribute('contenteditable', 'true'))
    expect(mockWebsocketProviderInstances).toHaveLength(1)
    const provider = mockWebsocketProviderInstances[0]
    const ydoc = provider.doc as Y.Doc
    const originalYDoc = Array.from(Y.encodeStateAsUpdate(ydoc))

    document.dispatchEvent(new CustomEvent('editor:setContent', { detail: { html: '<p>延迟覆盖</p>' } }))
    expect(provider.on).toHaveBeenCalledWith('sync', expect.any(Function))
    rerender(<TiptapEditor {...props} readOnly />)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)) })

    expect(editable).not.toHaveTextContent('延迟覆盖')
    expect(Array.from(Y.encodeStateAsUpdate(ydoc))).toEqual(originalYDoc)
  })

  it('评论 replay 请求返回前权限变为只读时不写入 mark', async () => {
    mockGetRoomTicket.mockResolvedValueOnce({ ticket: 'writer-ticket', role: 'writer', expiresIn: 60 })
    let resolveComments!: (comments: any[]) => void
    mockListCommentMarks
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(new Promise(resolve => { resolveComments = resolve }))
    const props = { noteId: 'replay-readonly', initialHTML: '<p>原始内容</p>', onSave: async () => {}, user }
    const { rerender } = render(<TiptapEditor {...props} />)
    const editable = document.querySelector('.ProseMirror') as HTMLElement
    await waitFor(() => expect(editable).toHaveAttribute('contenteditable', 'true'))

    document.dispatchEvent(new CustomEvent('comments:replay', { detail: { noteId: 'replay-readonly' } }))
    await waitFor(() => expect(mockListCommentMarks).toHaveBeenCalledTimes(2))
    rerender(<TiptapEditor {...props} readOnly />)
    await act(async () => { resolveComments([{ _id: 'late-comment', start: 1, end: 3 }]); await Promise.resolve() })

    expect(editable.querySelector('[data-comment-id="late-comment"]')).not.toBeInTheDocument()
  })

  it('只读期间错过评论事件后在获得写权限时恢复 mark', async () => {
    mockGetRoomTicket.mockResolvedValueOnce({ ticket: 'writer-ticket', role: 'writer', expiresIn: 60 })
    mockListCommentMarks.mockResolvedValueOnce([{ _id: 'restored-comment', start: 1, end: 3 }])
    const props = { noteId: 'replay-after-permission', initialHTML: '<p>原始内容</p>', onSave: async () => {}, user }
    const { rerender } = render(<TiptapEditor {...props} readOnly />)
    const editable = document.querySelector('.ProseMirror') as HTMLElement

    document.dispatchEvent(new CustomEvent('comments:replay', { detail: { noteId: 'replay-after-permission' } }))
    expect(mockListCommentMarks).not.toHaveBeenCalled()

    rerender(<TiptapEditor {...props} />)

    await waitFor(() => expect(editable).toHaveAttribute('contenteditable', 'true'))
    await waitFor(() => expect(editable.querySelector('[data-comment-id="restored-comment"]')).toBeInTheDocument())
    expect(mockListCommentMarks).toHaveBeenCalledWith('replay-after-permission')
  })

  it('加载旧 Markdown 时显示转换后的富文本', () => {
    render(<TiptapEditor noteId="markdown-note" initialHTML={'# 旧标题'} onSave={async () => {}} user={user} />)

    expect(document.querySelector('.ProseMirror h1')).toHaveTextContent('旧标题')
  })

  it('旧 Markdown 转换失败时持续提示且编辑器保留原文', () => {
    mockMarkedParse.mockImplementationOnce(() => {
      throw new Error('conversion failed')
    })

    render(<TiptapEditor noteId="broken-note" initialHTML={'# 损坏 <内容>'} onSave={async () => {}} user={user} />)

    expect(document.querySelector('.ProseMirror')).toHaveTextContent('# 损坏 <内容>')
    expect(mockAppToastError).toHaveBeenCalledWith({
      id: 'content-conversion:broken-note',
      title: '内容格式转换失败',
      message: '已保留原始文本，请检查内容后重试。',
      persistent: true,
    })
  })

  it.each([
    ['链接', '[OpenAI](https://openai.com)', 'a[href="https://openai.com"]'],
    ['表格', '| 名称 | 状态 |\n| --- | --- |\n| 编辑器 | 完成 |', 'table'],
    ['代码块', '```ts\nconst ready = true\n```', 'pre code'],
  ])('将明确 Markdown %s 粘贴为富文本', async (_label, plainText, selector) => {
    mockGetRoomTicket.mockResolvedValueOnce({ ticket: 'test-ticket', role: 'writer', expiresIn: 60 })
    render(<TiptapEditor noteId={`paste-${_label}`} initialHTML={'<p></p>'} onSave={async () => {}} user={user} />)
    const editable = document.querySelector('.ProseMirror') as HTMLElement

    await waitFor(() => expect(editable).toHaveAttribute('contenteditable', 'true'))

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { getData: (type: string) => type === 'text/plain' ? plainText : '' },
    })
    editable.dispatchEvent(pasteEvent)

    expect(editable.querySelector(selector)).toBeInTheDocument()
  })

  it('忽略同一笔记的旧保存响应且保留当前编辑内容', async () => {
    mockGetRoomTicket.mockResolvedValueOnce({ ticket: 'test-ticket', role: 'writer', expiresIn: 60 })
    const props = { noteId: 'stable-seed', onSave: async () => {}, user }
    const { rerender } = render(<TiptapEditor {...props} initialHTML="<p>初稿</p>" />)
    let editable = document.querySelector('.ProseMirror') as HTMLElement
    await waitFor(() => expect(editable).toHaveAttribute('contenteditable', 'true'))

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { getData: (type: string) => type === 'text/plain' ? '[OpenAI](https://openai.com)' : '' },
    })
    editable.dispatchEvent(pasteEvent)
    expect(editable.querySelector('a[href="https://openai.com"]')).toBeInTheDocument()

    rerender(<TiptapEditor {...props} initialHTML="<p>旧保存响应</p>" updatedAt="2026-08-11T00:00:10.000Z" />)
    editable = document.querySelector('.ProseMirror') as HTMLElement

    await waitFor(() => {
      expect(editable.querySelector('a[href="https://openai.com"]')).toBeInTheDocument()
      expect(editable).not.toHaveTextContent('旧保存响应')
    })
  })

  it('suppresses IndexedDB persistence unhandled rejections', () => {
    const onSave = jest.fn()
    render(<TiptapEditor noteId="n1" initialHTML={'<p></p>'} onSave={async () => onSave('')} user={user} />)

    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    Object.defineProperty(event, 'reason', {
      value: new Error('UnknownError: Internal error. IndexedDB'),
    })
    const preventDefault = jest.spyOn(event, 'preventDefault')

    window.dispatchEvent(event)

    expect(preventDefault).toHaveBeenCalled()
  })

  it('suppresses y-indexeddb internal errors without an IndexedDB suffix', () => {
    const onSave = jest.fn()
    render(<TiptapEditor noteId="n1" initialHTML={'<p></p>'} onSave={async () => onSave('')} user={user} />)

    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    Object.defineProperty(event, 'reason', {
      value: new Error('UnknownError: Internal error.'),
    })
    const preventDefault = jest.spyOn(event, 'preventDefault')

    window.dispatchEvent(event)

    expect(preventDefault).toHaveBeenCalled()
  })

  it('keeps IndexedDB persistence errors away from later runtime overlay listeners', () => {
    const overlayListener = jest.fn()
    window.addEventListener('unhandledrejection', overlayListener)
    const onSave = jest.fn()

    try {
      render(<TiptapEditor noteId="n1" initialHTML={'<p></p>'} onSave={async () => onSave('')} user={user} />)

      const event = new Event('unhandledrejection') as Event & { reason?: unknown }
      Object.defineProperty(event, 'reason', {
        value: new Error('UnknownError: Internal error.'),
      })

      window.dispatchEvent(event)

      expect(overlayListener).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('unhandledrejection', overlayListener)
    }
  })

  it('skips y-indexeddb persistence when IndexedDB preflight fails', async () => {
    installIndexedDbMock({ failOpen: true })
    const onSave = jest.fn()

    render(<TiptapEditor noteId="n1" initialHTML={'<p></p>'} onSave={async () => onSave('')} user={user} />)

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mockIndexeddbPersistenceConstructor).not.toHaveBeenCalled()
  })

  it('starts y-indexeddb persistence when IndexedDB preflight passes', async () => {
    const onSave = jest.fn()

    render(<TiptapEditor noteId="n1" initialHTML={'<p></p>'} onSave={async () => onSave('')} user={user} />)

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mockIndexeddbPersistenceConstructor).toHaveBeenCalledWith('online-notes:note:n1', expect.anything())
  })
})

describe('Tiptap Markdown 快捷输入', () => {
  it.each(['heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock'])(
    '保留 %s input rules',
    (extensionName) => {
      const ydoc = new Y.Doc()
      const editor = new Editor({
        extensions: createTiptapExtensions({ collabEnabled: false, ydoc, provider: null, user: { id: 'u1', name: '用户' } }),
        content: '<p></p>',
      })

      expect(editor.extensionManager.extensions.find(({ name }) => name === extensionName)?.config.addInputRules).toEqual(expect.any(Function))

      editor.destroy()
      ydoc.destroy()
    },
  )
})

describe('旧 Yjs Markdown 安全迁移', () => {
  it('提供基于 ProseMirror document 等价的迁移判断', () => {
    expect(isLegacyRawMarkdownDocument).toEqual(expect.any(Function))
  })

  it.each([
    ['blockquote', '> 引用'],
    ['code block', '```ts\nconst ready = true\n```'],
    ['table', '| 名称 | 状态 |\n| --- | --- |\n| 编辑器 | 完成 |'],
  ])('识别已 seed 的 dirty %s', (_label, raw) => {
    const ydoc = new Y.Doc()
    const editor = new Editor({
      extensions: createTiptapExtensions({ collabEnabled: false, ydoc, provider: null, user: { id: 'u1', name: '用户' } }),
      content: raw,
    })

    expect(isLegacyRawMarkdownDocument(editor, raw, 'markdown')).toBe(true)

    editor.destroy()
    ydoc.destroy()
  })

  it('不迁移与后端旧 raw 不同的协作内容', () => {
    const ydoc = new Y.Doc()
    const editor = new Editor({
      extensions: createTiptapExtensions({ collabEnabled: false, ydoc, provider: null, user: { id: 'u1', name: '用户' } }),
      content: '<p>协作者的新内容</p>',
    })

    expect(isLegacyRawMarkdownDocument(editor, '> 后端旧引用', 'markdown')).toBe(false)

    editor.destroy()
    ydoc.destroy()
  })
})

describe('TiptapToolbar', () => {
  it('keeps each insertion action inside the named group', () => {
    render(<TiptapToolbar disabled={false} exec={jest.fn()} />)

    const insertGroup = screen.getByRole('group', { name: '插入' })
    expect(within(insertGroup).getByRole('button', { name: '插入更多内容' })).toBeEnabled()
    expect(within(insertGroup).getByRole('button', { name: '插入链接' })).toBeEnabled()
    expect(within(insertGroup).getByRole('button', { name: '插入图片' })).toBeEnabled()
    expect(within(insertGroup).getByRole('button', { name: '插入表格' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '评论' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '协作成员' })).toBeEnabled()
  })

  it('maps grouped insertion actions to the existing menu and command bus', () => {
    const exec = jest.fn()
    const openInsertMenu = jest.fn()
    const originalFileReader = window.FileReader
    const reader = {
      result: 'data:image/png;base64,toolbar-image',
      onload: null as (() => void) | null,
      readAsDataURL: jest.fn(),
    }
    reader.readAsDataURL.mockImplementation(() => reader.onload?.())
    Object.defineProperty(window, 'FileReader', { configurable: true, value: jest.fn(() => reader) })
    document.addEventListener('open:insert-menu', openInsertMenu)

    try {
      render(<TiptapToolbar disabled={false} exec={exec} />)
      const insertGroup = screen.getByRole('group', { name: '插入' })

      fireEvent.click(within(insertGroup).getByRole('button', { name: '插入更多内容' }))
      fireEvent.click(within(insertGroup).getByRole('button', { name: '插入链接' }))
      fireEvent.click(within(insertGroup).getByRole('button', { name: '插入表格' }))
      fireEvent.change(insertGroup.querySelector('input[type="file"]')!, {
        target: { files: [new File(['image'], 'toolbar.png', { type: 'image/png' })] },
      })

      expect(openInsertMenu).toHaveBeenCalledTimes(1)
      expect(exec).toHaveBeenCalledWith('link')
      expect(exec).toHaveBeenCalledWith('table')
      expect(exec).toHaveBeenCalledWith('image', { src: 'data:image/png;base64,toolbar-image' })
    } finally {
      document.removeEventListener('open:insert-menu', openInsertMenu)
      Object.defineProperty(window, 'FileReader', { configurable: true, value: originalFileReader })
    }
  })

  it('provides a discoverable tooltip for each icon-only action', () => {
    render(<TiptapToolbar disabled={false} exec={jest.fn()} />)

    for (const name of ['评论', '协作成员']) {
      expect(screen.getByRole('button', { name }).closest('[data-tooltip]')).toHaveAttribute('data-tooltip', name)
    }
  })
})

describe('NoteEditorShell insertion affordances', () => {
  it('does not render the removed floating insert button', () => {
    render(<NoteEditorShell id="n1" initialData={{ id: 'n1', title: '测试笔记', content: '', tags: [], visibility: 'private' } as any} />)

    expect(screen.getByRole('toolbar', { name: '编辑器工具栏' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '插入工具' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '插入更多内容' }))
    expect(screen.getByRole('menu', { name: '插入工具菜单' })).toBeInTheDocument()
  })

  it('不显示富文本与 Markdown 模式切换', () => {
    render(<NoteEditorShell id="n1" initialData={{ id: 'n1', title: '测试笔记', content: '', tags: [], visibility: 'private' } as any} />)

    expect(screen.queryByRole('option', { name: '富文本（协同）' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Markdown' })).not.toBeInTheDocument()
  })
})

function installIndexedDbMock(options: { failOpen?: boolean } = {}) {
  const indexedDB = {
    open: jest.fn(() => {
      const request: any = {}
      setTimeout(() => {
        if (options.failOpen) {
          request.error = new Error('UnknownError: Internal error.')
          request.onerror?.({ target: request })
          return
        }

        const storeNames = new Set<string>()
        const db = {
          objectStoreNames: {
            contains: (name: string) => storeNames.has(name),
          },
          createObjectStore: (name: string) => {
            storeNames.add(name)
          },
          close: jest.fn(),
        }
        request.result = db
        request.onupgradeneeded?.({ target: request })
        request.onsuccess?.({ target: request })
      }, 0)
      return request
    }),
  }

  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: indexedDB,
  })
}
