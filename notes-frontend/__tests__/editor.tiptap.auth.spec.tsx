import { act, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

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
    jest.useFakeTimers()
    localStorage.clear()
    ;(WebsocketProvider as any).instances.length = 0
    process.env.NEXT_PUBLIC_YWS_URL = 'ws://localhost:1234'
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  function jwtWithExp(expMs: number) {
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', exp: Math.floor(expMs / 1000) })).toString('base64')
    return `header.${payload}.signature`
  }

  test('passes access_token to WebsocketProvider when token exists', () => {
    const token = jwtWithExp(Date.now() + 60_000)
    localStorage.setItem('notes_token', token)

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => { }} user={user} />)

    expect((WebsocketProvider as any).instances).toHaveLength(1)
    expect((WebsocketProvider as any).instances[0].options.params.access_token).toBe(token)
  })

  test('does not create provider when token is missing', () => {
    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => { }} user={user} />)

    expect((WebsocketProvider as any).instances).toHaveLength(0)
    expect(screen.getByText('协作需要登录')).toBeInTheDocument()
  })

  test('renders readable status when websocket url is missing', () => {
    localStorage.setItem('notes_token', jwtWithExp(Date.now() + 60_000))
    delete process.env.NEXT_PUBLIC_YWS_URL

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => { }} user={user} />)

    expect(screen.getByText('协作配置缺失')).toBeInTheDocument()
  })

  test('destroys provider and degrades when token expires during an active session', () => {
    localStorage.setItem('notes_token', jwtWithExp(Date.now() + 5_000))

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => { }} user={user} />)
    expect((WebsocketProvider as any).instances).toHaveLength(1)
    const instance = (WebsocketProvider as any).instances[0]

    act(() => {
      jest.advanceTimersByTime(5_100)
    })

    expect(instance.destroy).toHaveBeenCalled()
    expect(screen.getByText('登录已过期，协作已暂停')).toBeInTheDocument()
  })
})
