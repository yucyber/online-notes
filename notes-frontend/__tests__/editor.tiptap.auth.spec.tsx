import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const mockGetRoomTicket = jest.fn()

jest.mock('@/lib/api/notes', () => ({
  notesAPI: {
    getRoomTicket: (...args: unknown[]) => mockGetRoomTicket(...args),
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
    on = jest.fn()
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
import { WebsocketProvider } from 'y-websocket'

describe('TiptapEditor collaboration auth', () => {
  const user = { id: 'u1', name: 'User One' }

  beforeEach(() => {
    mockGetRoomTicket.mockReset()
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
})
