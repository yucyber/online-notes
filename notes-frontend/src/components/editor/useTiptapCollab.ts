'use client'

import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { notesAPI } from '@/lib/api/notes'
import { appToast } from '@/lib/app-toast'
import type { CollabStatus } from './tiptap-utils'

type CollabUser = { id: string; name: string }

export function useTiptapCollab(opts: {
  noteId: string
  versionKey?: string
  room: string
  ydoc: Y.Doc
  user: CollabUser
  localOnly?: boolean
}) {
  const { noteId, versionKey, room, ydoc, user, localOnly = false } = opts
  const userRef = useRef(user)
  userRef.current = user
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [connStatus, setConnStatus] = useState<CollabStatus>('connecting')
  // roomTicket 用 ref 而不是 state：ticket 变更只需更新 provider URL，不得触发 provider 重建；
  // provider 重建会 destroy 旧 awareness → 广播 null state → 对方协作者头像/光标消失。
  const roomTicketRef = useRef<string | null>(null)
  const [hasTicket, setHasTicket] = useState(false)
  const [roomRole, setRoomRole] = useState<'writer' | 'reader' | null>(localOnly ? 'writer' : null)
  const [ticketError, setTicketError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Array<{ id: string; name?: string }>>([])
  const participantsCache = useRef<Array<{ id: string; name?: string }>>([])
  const cacheTimeout = useRef<ReturnType<typeof setTimeout>>()
  const [collabEnabled, setCollabEnabled] = useState(!localOnly)
  const [localMode, setLocalMode] = useState(localOnly)
  const [wsDebug, setWsDebug] = useState<{ connecting: boolean; connected: boolean; synced: boolean }>({
    connecting: false,
    connected: false,
    synced: false,
  })

  useEffect(() => {
    if (!noteId || localOnly) return
    let cancelled = false
    setRoomRole(null)
    notesAPI.getRoomTicket(noteId)
      .then((data) => {
        if (!cancelled && data?.ticket) {
          const isFirst = !roomTicketRef.current
          roomTicketRef.current = data.ticket
          setRoomRole(data.role)
          setTicketError(null)
          // 第一次拿到 ticket 时触发 provider 创建；后续刷新只更新 URL，不重建 provider。
          if (isFirst) setHasTicket(true)
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          console.error('[Collab] Failed to get room ticket:', err)
          setTicketError(err?.message || 'ticket-failed')
        }
      })
    return () => { cancelled = true }
  }, [noteId, localOnly])

  useEffect(() => {
    if (localOnly) {
      setProvider(null)
      setRoomRole('writer')
      setLocalMode(true)
      setCollabEnabled(false)
      setConnStatus('local')
      return
    }
    const yws = process.env.NEXT_PUBLIC_YWS_URL

    if (!yws) {
      setLocalMode(true)
      setCollabEnabled(false)
      setProvider(null)
      setConnStatus('config-missing')
      return
    }

    if (!hasTicket) {
      if (ticketError) {
        setLocalMode(true)
        setCollabEnabled(false)
        setProvider(null)
        setConnStatus('auth-failed')
      }
      return
    }

    const initialTicket = roomTicketRef.current!
    let p: WebsocketProvider | null = null
    try {
      console.log('[Collab] Connecting:', { url: yws, room })
      p = new WebsocketProvider(yws, room, ydoc, {
        connect: true,
        maxBackoffTime: 10000,
        disableBc: true,
        params: { access_token: initialTicket },
      })
    } catch (e) {
      console.error('[Collab] Failed to create provider:', e)
      setLocalMode(true)
      return
    }

    setProvider(p)
    setConnStatus('connecting')
    let offlineToastVisible = false
    let reconnectFailures = 0
    let reconnectInFlight = false

    const requestReconnect = () => {
      setConnStatus('connecting')
      setWsDebug((previous) => ({ ...previous, connecting: true, connected: false }))
      try { p?.connect() } catch { }
    }

    const markUnavailable = () => {
      setConnStatus('disconnected')
      setLocalMode(true)
      setWsDebug((previous) => ({ ...previous, connecting: false, connected: false, synced: false }))
      if (offlineToastVisible) return

      offlineToastVisible = true
      appToast.error({
        id: `collab:${noteId}`,
        title: '实时协作暂不可用',
        message: '已切换为离线编辑，恢复服务后可重新连接。',
        action: { label: '重新连接', onClick: requestReconnect },
        persistent: true,
      })
    }

    const refreshProviderTicket = async () => {
      try {
        const d = await notesAPI.getRoomTicket(noteId)
        if (!d?.ticket) return false
        const base = (yws || '').replace(/\/+$/, '')
        roomTicketRef.current = d.ticket
        p!.url = `${base}/${room}?access_token=${encodeURIComponent(d.ticket)}`
        return true
      } catch (err) {
        console.error('[Collab] Failed to refresh room ticket:', err)
        return false
      }
    }

    const reconnectWithFreshTicket = () => {
      if (reconnectInFlight) return
      reconnectInFlight = true
      reconnectFailures += 1
      if (reconnectFailures > 3) {
        reconnectInFlight = false
        console.warn('[Collab] Too many reconnect failures; switching to offline editing')
        markUnavailable()
        return
      }
      void refreshProviderTicket().then((ok) => {
        reconnectInFlight = false
        if (!ok) {
          markUnavailable()
          return
        }
        try { p?.connect() } catch { }
      })
    }

    p.on('connection-error', (e: any) => {
      console.error('[Collab] Connection error:', e)
      const message = String(e?.message || e || '')
      if (message.includes('401') || message.toLowerCase().includes('unauthorized')) {
        console.warn('[Collab] Auth error; waiting for close to refresh ticket')
      }
    })
    p.on('connection-close', (e: any) => {
      console.warn('[Collab] Connection closed:', e?.code, e?.reason)
      if (e?.code === 1008 || e?.code === 4401 || String(e?.reason || '').includes('401')) {
        console.warn('[Collab] Auth failure on close; refreshing room ticket and reconnecting')
        reconnectWithFreshTicket()
        return
      }
      reconnectWithFreshTicket()
    })

    const statusHandler = (status: any) => {
      const s = (typeof status === 'object' ? status.status : status) as 'connecting' | 'connected' | 'disconnected'
      if (s === 'disconnected') {
        setConnStatus('disconnected')
        setWsDebug((prev) => ({ ...prev, connecting: false, connected: false }))
        return
      }
      setConnStatus(s)
      setWsDebug((prev) => ({
        ...prev,
        connected: s === 'connected',
        connecting: s === 'connecting',
      }))

      if (s === 'connected') {
        reconnectFailures = 0
        setLocalMode(false)
        setCollabEnabled(true)
        if (offlineToastVisible) {
          offlineToastVisible = false
          appToast.dismiss(`collab:${noteId}`)
        }

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
      const myClientId = aw.clientID
      const myUserId = userRef.current.id
      const byId = new Map<string, { id: string; name?: string }>()
      for (const [clientId, s] of entries) {
        const uid = String(s?.user?.id || s?.user?.name || clientId)
        // 排除自己：只展示其他协作者的头像/光标，避免把自己算入协作者列表。
        if (clientId === myClientId || uid === myUserId) continue
        const name = s?.user?.name
        if (!byId.has(uid)) byId.set(uid, { id: uid, name })
      }
      const newParticipants = Array.from(byId.values())

      // 光标移动会高频更新 awareness；只有协作者集合真正变化时才更新 React 状态，
      // 否则每次移动光标都会因新数组引用触发编辑页整树重渲染（CLS 抖动）。
      const previous = participantsCache.current
      const unchanged = previous.length === newParticipants.length
        && previous.every((item, index) => item.id === newParticipants[index].id && item.name === newParticipants[index].name)
      participantsCache.current = newParticipants
      if (!unchanged) setParticipants(newParticipants)

      if (cacheTimeout.current) {
        clearTimeout(cacheTimeout.current)
      }

      // 同室其他协作者 awareness 降为 0 时，主动重播自己的 user state，
      // 防止对方在 provider 重建后因未收到我方 announce 而永远看不到我方光标/头像。
      if (newParticipants.length === 0 && (p as any).wsconnected) {
        const u = userRef.current
        aw.setLocalStateField('user', {
          id: u.id,
          name: u.name,
          clientId: aw.clientID,
          timestamp: Date.now(),
        })
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
      const nextDebug = {
        connecting: Boolean((p as any).wsconnecting),
        connected: Boolean((p as any).wsconnected),
        synced: Boolean((p as any).synced),
      }
      // 状态未变化时不写 state，避免每 5 秒无意义地重渲染编辑页。
      setWsDebug((previous) => (
        previous.connecting === nextDebug.connecting
        && previous.connected === nextDebug.connected
        && previous.synced === nextDebug.synced
          ? previous
          : nextDebug
      ))
      if (disconnected) {
        failCount++
        if (failCount >= 2) {
          console.warn('[Collab] Connection unavailable; switching to offline editing')
          markUnavailable()
        }
      } else {
        failCount = 0
      }
    }, 5000)

    // awareness 心跳每 8s 更新一次：
    // y-protocols 客户端每 3s 检查对方 awareness.meta.lastUpdated，超过 30s 自动 GC；
    // 心跳固定 15s 最坏情况下对方收到我方更新的间隔可达 29s+，刚好触发 GC；
    // 改为 8s 可确保安全裕量内发一次，绝不触发 GC。
    const appHeartbeat = setInterval(() => {
      if (p && (p as any).wsconnected) {
        p.awareness.setLocalStateField('lastPing', Date.now())
      }
    }, 8000)

    // room-ticket 有效期 5 分钟；每 4 分钟静默换新，避免断线重连时使用过期票据。
    const ticketRefreshTimer = setInterval(() => {
      if (!(p as any)?.wsconnected) return
      void refreshProviderTicket()
    }, 240000)

    return () => {
      console.log('[Collab] Disconnecting provider')
      clearInterval(degradeTimer)
      clearInterval(appHeartbeat)
      clearInterval(ticketRefreshTimer)
      if (cacheTimeout.current) {
        clearTimeout(cacheTimeout.current)
      }
      if (offlineToastVisible) appToast.dismiss(`collab:${noteId}`)
      p?.off('status', statusHandler)
      p?.off('sync', syncHandler as any)
      p?.off('destroy', destroyHandler)
      ydoc.off('update', updateHandler)
      aw.off('update', updateAwareness)
      p?.destroy()
    }
  }, [noteId, versionKey, ydoc, hasTicket, room, localOnly])

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

  // 组件真正 unmount 时才销毁 ydoc；不能把 provider 加入 deps，
  // 否则 provider null→实例的正常初始化就会触发 cleanup 销毁 ydoc，
  // 导致 awareness 被 destroy → setLocalState(null) → 对方看到 0 entries。
  useEffect(() => {
    return () => {
      try {
        if (process.env.NODE_ENV === 'production') {
          ydoc?.destroy()
        }
      } catch { }
    }
  }, [ydoc])

  const reconnect = () => {
    try { provider?.connect() } catch { }
    setConnStatus('connecting')
    setWsDebug((previous) => ({ ...previous, connecting: true, connected: false }))
  }

  return {
    provider,
    roomRole,
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
