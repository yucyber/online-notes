import { render, screen, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom'

const mockIndexeddbPersistenceConstructor = jest.fn()
const mockIndexeddbPersistenceDestroy = jest.fn()

jest.mock('y-websocket', () => {
  class WebsocketProvider {
    awareness = {
      clientID: 1,
      setLocalStateField: jest.fn(),
      getStates: jest.fn(() => new Map()),
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
    constructor(public url: string, public room: string, public doc: any, public options: any) { }
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
jest.mock('marked', () => ({ marked: { parse: jest.fn() } }))
jest.mock('@/lib/api', () => ({
  fetchCategories: jest.fn(() => new Promise(() => {})),
  fetchTags: jest.fn(() => new Promise(() => {})),
  updateNote: jest.fn(),
  lockNote: jest.fn(),
  unlockNote: jest.fn(),
  boardsAPI: { create: jest.fn() },
  mindmapsAPI: { create: jest.fn() },
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

import TiptapEditor from '@/components/editor/TiptapEditor'
import TiptapToolbar from '@/components/editor/TiptapToolbar'
import NoteEditorShell from '@/components/editor/NoteEditorShell'

describe('TiptapEditor 全区域输入', () => {
  const user = { id: 'u1', name: 'User One' }
  const originalIndexedDB = Object.getOwnPropertyDescriptor(window, 'indexedDB')
  beforeEach(() => {
    ;(process as any).env.NEXT_PUBLIC_YWS_URL = ''
    mockIndexeddbPersistenceConstructor.mockClear()
    mockIndexeddbPersistenceDestroy.mockClear()
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
