'use client'

import { useEffect, useState } from 'react'
import type * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'

function isIndexedDbPersistenceError(reason: unknown) {
  const value = reason as { name?: string; message?: string; stack?: string } | null | undefined
  const message = String(value?.message || reason || '')
  const name = String(value?.name || '')
  const stack = String(value?.stack || '')
  const text = `${message}\n${stack}`
  return (
    /indexeddb|y-indexeddb|lib0\/indexeddb/i.test(text) ||
    /^UnknownError:\s*Internal error\.?$/i.test(message.trim()) ||
    (name === 'UnknownError' && /internal error/i.test(message))
  )
}

function preflightIndexedDbPersistence(name: string): Promise<boolean> {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(false)

  return new Promise((resolve) => {
    let settled = false
    const settle = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    try {
      const request = window.indexedDB.open(name)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('updates')) db.createObjectStore('updates', { autoIncrement: true })
        if (!db.objectStoreNames.contains('custom')) db.createObjectStore('custom')
      }
      request.onerror = () => settle(false)
      request.onblocked = () => settle(false)
      request.onsuccess = () => {
        const db = request.result
        const ok = db.objectStoreNames.contains('updates') && db.objectStoreNames.contains('custom')
        try { db.close() } catch { }
        settle(ok)
      }
    } catch {
      settle(false)
    }
  })
}

/** IndexedDB 持久化：断网/刷新后仍能恢复 Y.Doc */
export function useTiptapPersistence(room: string, ydoc: Y.Doc, enabled = true) {
  const [idbSynced, setIdbSynced] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setIdbSynced(false)
      return
    }
    let cancelled = false
    let persistence: IndexeddbPersistence | null = null
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isIndexedDbPersistenceError(event.reason)) return
      console.warn('[Collab] IndexedDB persistence unavailable; continuing without local Y.Doc cache', event.reason)
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    window.addEventListener('unhandledrejection', handleUnhandledRejection, true)

    const cleanup = () => {
      cancelled = true
      window.removeEventListener('unhandledrejection', handleUnhandledRejection, true)
      try {
        const destroyed = persistence?.destroy()
        if (destroyed && typeof (destroyed as Promise<void>).catch === 'function') {
          ;(destroyed as Promise<void>).catch((e) => {
            if (!isIndexedDbPersistenceError(e)) console.warn('[Collab] Failed to destroy IndexedDB persistence', e)
          })
        }
      } catch { }
    }

    const persistenceName = `online-notes:${room}`
    const startPersistence = async () => {
      const canUseIndexedDb = await preflightIndexedDbPersistence(persistenceName).catch((e) => {
        if (!isIndexedDbPersistenceError(e)) console.warn('[Collab] IndexedDB preflight failed', e)
        return false
      })
      if (cancelled) return
      if (!canUseIndexedDb) {
        console.warn('[Collab] IndexedDB unavailable; continuing without local Y.Doc cache')
        return
      }

      try {
        persistence = new IndexeddbPersistence(persistenceName, ydoc)
      } catch (e) {
        console.warn('[Collab] Failed to init IndexedDB persistence', e)
        return
      }

      const dbPromise = (persistence as any)?._db
      if (dbPromise && typeof dbPromise.catch === 'function') {
        dbPromise.catch((e: unknown) => {
          if (!cancelled) console.warn('[Collab] IndexedDB open failed; continuing without local Y.Doc cache', e)
        })
      }

      persistence.whenSynced
        .then(() => {
          if (cancelled) return
          setIdbSynced(true)

          try {
            const frag = ydoc.getXmlFragment('prosemirror') as any
            const hasContent = frag && typeof frag.length === 'number' ? frag.length > 0 : false
            if (hasContent) {
              const meta = ydoc.getMap('meta')
              if (!meta.get('seeded')) {
                meta.set('seeded', { by: 'indexeddb', at: Date.now() })
              }
            }
          } catch { }
        })
        .catch((e) => {
          console.warn('[Collab] IndexedDB whenSynced failed', e)
        })
    }

    void startPersistence()

    return cleanup
  }, [room, ydoc, enabled])

  return { idbSynced }
}
