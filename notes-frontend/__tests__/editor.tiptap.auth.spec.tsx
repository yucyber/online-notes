import { act, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const mockGetRoomTicket = jest.fn()
const mockAppToastError = jest.fn()
const mockAppToastDismiss = jest.fn()

jest.mock('@/lib/api/notes', () => ({
  notesAPI: {
    getRoomTicket: (...args: unknown[]) => mockGetRoomTicket(...args),
  },
}))

jest.mock('@/lib/app-toast', () => ({
  appToast: {
    error: (...args: unknown[]) => mockAppToastError(...args),
    dismiss: (...args: unknown[]) => mockAppToastDismiss(...args),
  },
}))

jest.mock('y-websocket', () => {
  const providerInstances: any[] = []
  class WebsocketProvider {
    static instances = providerInstances
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
    handlers = new Map<string, Set<(value: unknown) => void>>()
    on = jest.fn((event: string, handler: (value: unknown) => void) => {
      const handlers = this.handlers.get(event) ?? new Set()
      handlers.add(handler)
      this.handlers.set(event, handlers)
    })
    off = jest.fn()
    destroy = jest.fn()
    disconnect = jest.fn()
    connect = jest.fn()
    wsconnected = false
    wsconnecting = false
    synced = false
    constructor(public url: string, public room: string, public doc: any, public options: any) {
      providerInstances.push(this)
    }
    emit(event: string, value: unknown) {
      this.handlers.get(event)?.forEach((handler) => handler(value))
    }
  }
  return { WebsocketProvider }
})

jest.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve()
    destroy = jest.fn()
  },
}))

jest.mock('marked', () => ({ marked: { parse: (raw: string) => `<p>${raw}</p>` } }))

import TiptapEditor from '@/components/editor/TiptapEditor'
import { WebsocketProvider } from 'y-websocket'

describe('TiptapEditor collaboration auth', () => {
  const user = { id: 'u1', name: 'User One' }

  beforeEach(() => {
    mockGetRoomTicket.mockReset()
    mockAppToastError.mockReset()
    mockAppToastDismiss.mockReset()
    ;(WebsocketProvider as any).instances.length = 0
    process.env.NEXT_PUBLIC_YWS_URL = 'ws://localhost:1234'
  })

  test('passes the room ticket to WebsocketProvider after ticket issuance', async () => {
    mockGetRoomTicket.mockResolvedValue({ ticket: 'room-ticket', role: 'writer', expiresIn: 300 })

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => { }} user={user} />)

    await waitFor(() => expect((WebsocketProvider as any).instances).toHaveLength(1))
    expect(mockGetRoomTicket).toHaveBeenCalledWith('n1')
    expect((WebsocketProvider as any).instances[0].options.params.access_token).toBe('room-ticket')
  })

  test('reader room ticket keeps the editor non-editable', async () => {
    mockGetRoomTicket.mockResolvedValue({ ticket: 'reader-ticket', role: 'reader', expiresIn: 300 })
    const onSave = jest.fn()

    const { container } = render(
      <TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async (html) => { onSave(html) }} user={user} />,
    )

    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
    })
    document.dispatchEvent(new CustomEvent('tiptap:exec', { detail: { cmd: 'save' } }))
    expect(onSave).not.toHaveBeenCalled()
  })

  test('degrades without creating a provider when room-ticket issuance fails', async () => {
    mockGetRoomTicket.mockRejectedValue(new Error('unauthorized'))

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => { }} user={user} />)

    expect(await screen.findByText('协作鉴权失败')).toBeInTheDocument()
    expect((WebsocketProvider as any).instances).toHaveLength(0)
  })

  test('renders readable status when websocket url is missing', async () => {
    mockGetRoomTicket.mockResolvedValue({ ticket: 'room-ticket', role: 'writer', expiresIn: 300 })
    delete process.env.NEXT_PUBLIC_YWS_URL

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => { }} user={user} />)

    await waitFor(() => expect(mockGetRoomTicket).toHaveBeenCalledWith('n1'))
    expect(await screen.findByText('协作配置缺失')).toBeInTheDocument()
    expect((WebsocketProvider as any).instances).toHaveLength(0)
  })

  test('断线后进入离线编辑且统一重连 Toast 只出现一次，成功后恢复', async () => {
    mockGetRoomTicket.mockResolvedValue({ ticket: 'room-ticket', role: 'writer', expiresIn: 300 })

    render(<TiptapEditor noteId="offline-note" initialHTML="<p>x</p>" onSave={async () => { }} user={user} />)

    await waitFor(() => expect((WebsocketProvider as any).instances).toHaveLength(1))
    const provider = (WebsocketProvider as any).instances[0]

    act(() => {
      provider.emit('status', { status: 'connected' })
      provider.emit('status', { status: 'disconnected' })
      provider.emit('connection-error', new Error('network unavailable'))
    })

    expect(await screen.findByText('实时协作暂不可用，已离线编辑')).toBeInTheDocument()
    expect(mockAppToastError).toHaveBeenCalledTimes(1)
    expect(mockAppToastError).toHaveBeenCalledWith(expect.objectContaining({
      id: 'collab:offline-note',
      title: '实时协作暂不可用',
      persistent: true,
      action: expect.objectContaining({ label: '重新连接' }),
    }))

    const toastOptions = mockAppToastError.mock.calls[0][0]
    act(() => toastOptions.action.onClick())
    expect(provider.connect).toHaveBeenCalledTimes(1)

    act(() => provider.emit('status', { status: 'connected' }))
    expect(await screen.findByText('已连接')).toBeInTheDocument()
    expect(mockAppToastDismiss).toHaveBeenCalledWith('collab:offline-note')
  })

  test.each([
    ['401 connection error', 'connection-error', new Error('401 Unauthorized')],
    ['4401 close', 'connection-close', { code: 4401, reason: 'unauthorized' }],
    ['1008 close', 'connection-close', { code: 1008, reason: 'policy violation' }],
  ])('%s 后的 disconnected 事件不覆盖鉴权失败终态', async (_caseName, event, payload) => {
    mockGetRoomTicket.mockResolvedValue({ ticket: 'room-ticket', role: 'writer', expiresIn: 300 })

    render(<TiptapEditor noteId={`auth-${event}`} initialHTML="<p>x</p>" onSave={async () => { }} user={user} />)

    await waitFor(() => expect((WebsocketProvider as any).instances).toHaveLength(1))
    const provider = (WebsocketProvider as any).instances[0]

    act(() => {
      provider.emit(event, payload)
      provider.emit('status', { status: 'disconnected' })
    })

    expect(await screen.findByText('协作鉴权失败')).toBeInTheDocument()
    expect(screen.queryByText('实时协作暂不可用，已离线编辑')).not.toBeInTheDocument()
    expect(mockAppToastError).not.toHaveBeenCalled()
  })
})
