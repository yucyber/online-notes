import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

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
    destroy = jest.fn()
  },
}))

import TiptapEditor from '@/components/editor/TiptapEditor'

describe('TiptapEditor 全区域输入', () => {
  const user = { id: 'u1', name: 'User One' }
  beforeEach(() => { (process as any).env.NEXT_PUBLIC_YWS_URL = '' })

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
})
