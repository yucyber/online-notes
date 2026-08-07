'use client'

import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { notesAPI } from '@/lib/api/notes'
import type { CollabStatus } from './tiptap-utils'

type CollabUser = { id: string; name: string }

export function useTiptapCollab(opts: {
  noteId: string
  versionKey?: string
  room: string
  ydoc: Y.Doc
  user: CollabUser
}) {
  const { noteId, versionKey, room, ydoc, user } = opts
  const userRef = useRef(user)
  userRef.current = user
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [connStatus, setConnStatus] = useState<CollabStatus>('connecting')
  const [roomTicket, setRoomTicket] = useState<string | null>(null)
  const [ticketError, setTicketError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Array<{ id: string; name?: string }>>([])
  const participantsCache = useRef<Array<{ id: string; name?: string }>>([])
  const cacheTimeout = useRef<ReturnType<typeof setTimeout>>()
  const [collabEnabled, setCollabEnabled] = useState(true)
  const [localMode, setLocalMode] = useState(false)
  const [wsDebug, setWsDebug] = useState<{ connecting: boolean; connected: boolean; synced: boolean }>({
    connecting: false,
    connected: false,
    synced: false,
  })

  useEffect(() => {
    if (!noteId) return
    let cancelled = false
    notesAPI.getRoomTicket(noteId)
      .then((data) => {
        if (!cancelled && data?.ticket) {
          setRoomTicket(data.ticket)
          setTicketError(null)
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          console.error('[Collab] Failed to get room ticket:', err)
          setTicketError(err?.message || 'ticket-failed')
        }
      })
    return () => { cancelled = true }
  }, [noteId])

  useEffect(() => {
    const yws = process.env.NEXT_PUBLIC_YWS_URL

    if (!yws) {
      setLocalMode(true)
      setCollabEnabled(false)
      setProvider(null)
      setConnStatus('config-missing')
      return
    }

    if (!roomTicket) {
      if (ticketError) {
        setLocalMode(true)
        setCollabEnabled(false)
        setProvider(null)
        setConnStatus('auth-failed')
      }
      return
    }

    let p: WebsocketProvider | null = null
    try {
      console.log('[Collab] Connecting:', { url: yws, room })
      p = new WebsocketProvider(yws, room, ydoc, {
        connect: true,
        maxBackoffTime: 10000,
        disableBc: true,
        params: { access_token: roomTicket },
      })
    } catch (e) {
      console.error('[Collab] Failed to create provider:', e)
      setLocalMode(true)
      return
    }

    setProvider(p)
    setConnStatus('connecting')

    const markAuthFailure = (status: CollabStatus) => {
      setConnStatus(status)
      setLocalMode(true)
      setCollabEnabled(false)
      try { p?.disconnect() } catch { }
    }

    p.on('connection-error', (e: any) => {
      console.error('[Collab] Connection error:', e)
      const message = String(e?.message || e || '')
      if (message.includes('401') || message.toLowerCase().includes('unauthorized')) {
        markAuthFailure('auth-failed')
      }
    })
    p.on('connection-close', (e: any) => {
      console.warn('[Collab] Connection closed:', e?.code, e?.reason)
      if (e?.code === 1008 || e?.code === 4401 || String(e?.reason || '').includes('401')) {
        markAuthFailure('auth-failed')
      }
    })

    const statusHandler = (status: any) => {
      const s = (typeof status === 'object' ? status.status : status) as 'connecting' | 'connected' | 'disconnected'
      setConnStatus(s)
      setWsDebug((prev) => ({
        ...prev,
        connected: s === 'connected',
        connecting: s === 'connecting',
      }))

      if (s === 'connected') {
        setLocalMode(false)
        setCollabEnabled(true)

        const aw = p!.awareness
        const u = userRef.current
        aw.setLocalStateField('user', {
          id: u.id,
          name: u.name,
          clientId: aw.clientID,
          timestamp: Date.now(),
        })

        if (participantsCache.current.length > 0) {
          setParticipants([...participantsCache.current])
        }

        try {
          const evt = new CustomEvent('rum', { detail: { type: 'collab', name: 'ws_status', meta: { status: s }, ts: Date.now() } })
          document.dispatchEvent(evt)
        } catch { }
      }
    }

    p.on('status', statusHandler)

    const syncHandler = (synced: boolean) => {
      console.log('[Collab] Sync status changed:', synced)
      setWsDebug((prev) => ({ ...prev, synced }))
      try {
        const evt = new CustomEvent('rum', { detail: { type: 'collab', name: 'ws_sync', meta: { synced }, ts: Date.now() } })
        document.dispatchEvent(evt)
      } catch { }
    }
    p.on('sync', syncHandler as any)

    const updateHandler = (update: Uint8Array, origin: any) => {
      console.log('[Collab] YDoc update received:', {
        byteLength: update.byteLength,
        origin: origin?.constructor?.name || origin,
        isLocal: origin === null || origin === p,
      })
    }
    ydoc.on('update', updateHandler)

    const aw = p.awareness

    const updateAwareness = () => {
      const entries = Array.from(aw.getStates().entries()) as any[]
      console.log('[Collab] Awareness update:', entries.length, 'entries')
      const byId = new Map<string, { id: string; name?: string }>()
      for (const [clientId, s] of entries) {
        const uid = String(s?.user?.id || s?.user?.name || clientId)
        const name = s?.user?.name
        if (!byId.has(uid)) byId.set(uid, { id: uid, name })
      }
      const newParticipants = Array.from(byId.values())

      participantsCache.current = newParticipants
      setParticipants(newParticipants)

      if (cacheTimeout.current) {
        clearTimeout(cacheTimeout.current)
      }
    }

    {
      const u = userRef.current
      aw.setLocalStateField('user', {
        id: u.id,
        name: u.name,
        clientId: aw.clientID,
        timestamp: Date.now(),
      })
    }

    aw.on('update', updateAwareness)
    updateAwareness()

    const destroyHandler = () => {
      console.log('[Collab] Provider destroy event - keeping collaborators cache for 5s')
      cacheTimeout.current = setTimeout(() => {
        if ((p as any).wsconnected === false) {
          console.log('[Collab] Cache timeout - clearing collaborators')
          participantsCache.current = []
          setParticipants([])
        } else {
          console.log('[Collab] Reconnected - keeping collaborators')
        }
      }, 5000)
    }
    p.on('destroy', destroyHandler)

    let failCount = 0
    const degradeTimer = setInterval(() => {
      const disconnected = (p as any).wsconnected === false && (p as any).wsconnecting === false
      setWsDebug({
        connecting: Boolean((p as any).wsconnecting),
        connected: Boolean((p as any).wsconnected),
        synced: Boolean((p as any).synced),
      })
      if (disconnected) {
        failCount++
        if (failCount >= 2) {
          console.warn('[Collab] Connection unstable but keeping retry...')
        }
      } else {
        failCount = 0
      }
    }, 5000)

    // 心跳每 15s 更新 awareness，防止服务端因闲置关闭 WebSocket 连接。
    const appHeartbeat = setInterval(() => {
      if (p && (p as any).wsconnected) {
        p.awareness.setLocalStateField('lastPing', Date.now())
      }
    }, 15000)

    return () => {
      console.log('[Collab] Disconnecting provider')
      clearInterval(degradeTimer)
      clearInterval(appHeartbeat)
      if (cacheTimeout.current) {
        clearTimeout(cacheTimeout.current)
      }
      p?.off('status', statusHandler)
      p?.off('sync', syncHandler as any)
      p?.off('destroy', destroyHandler)
      ydoc.off('update', updateHandler)
      aw.off('update', updateAwareness)
      p?.destroy()
    }
  }, [noteId, versionKey, ydoc, roomTicket, room, ticketError])

  useEffect(() => {
    if (provider && provider.awareness) {
      provider.awareness.setLocalStateField('user', {
        id: user.id,
        name: user.name,
        clientId: provider.awareness.clientID,
        timestamp: Date.now(),
      })
    }
  }, [user.id, user.name, provider])

  useEffect(() => {
    return () => {
      try {
        if (process.env.NODE_ENV === 'production') {
          provider?.destroy()
          ydoc?.destroy()
        } else {
          ;(provider as any)?.disconnect?.()
        }
      } catch { }
    }
  }, [provider, ydoc])

  const reconnect = () => {
    try { provider?.connect() } catch { }
    setLocalMode(false)
    setCollabEnabled(true)
  }

  return {
    provider,
    connStatus,
    participants,
    collabEnabled,
    localMode,
    wsDebug,
    setLocalMode,
    setCollabEnabled,
    reconnect,
  }
}
