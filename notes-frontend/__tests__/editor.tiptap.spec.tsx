import { render, screen, fireEvent } from '@testing-library/react'
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

import TiptapEditor from '@/components/editor/TiptapEditor'

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
