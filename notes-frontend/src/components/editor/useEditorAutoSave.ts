'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { appToast } from '@/lib/app-toast'
import type { EditorSnapshot } from './editor-save-types'

export type SaveState = 'idle' | 'saving' | 'saved' | 'local' | 'error'

type SaveSnapshot = {
  noteId: string
  key: string
  payload: EditorSnapshot
}

type SaveQueue = {
  running: Promise<void> | null
  pending: SaveSnapshot | null
  lastSavedKey: string
}

type UseEditorAutoSaveOptions = {
  noteId: string
  snapshot: EditorSnapshot
  enabled: boolean
  save: (snapshot: EditorSnapshot) => Promise<void>
  delayMs: number
}

function copySnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return {
    ...snapshot,
    categoryIds: snapshot.categoryIds ? [...snapshot.categoryIds] : undefined,
    tags: [...snapshot.tags],
  }
}

function toSaveSnapshot(noteId: string, snapshot: EditorSnapshot): SaveSnapshot {
  const payload = copySnapshot(snapshot)
  return {
    noteId,
    key: JSON.stringify([noteId, payload]),
    payload,
  }
}

function createQueue(lastSavedKey: string): SaveQueue {
  return { running: null, pending: null, lastSavedKey }
}

export function useEditorAutoSave({ noteId, snapshot, enabled, save, delayMs }: UseEditorAutoSaveOptions) {
  const currentSnapshot = toSaveSnapshot(noteId, snapshot)
  const [state, setState] = useState<SaveState>('idle')
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<EditorSnapshot | null>(null)
  const latestSnapshotRef = useRef(currentSnapshot)
  const queueRef = useRef<SaveQueue>(createQueue(currentSnapshot.key))
  const debounceRef = useRef<{ key: string; timer: number } | null>(null)
  const disposedRef = useRef(false)
  const observedNoteIdRef = useRef(noteId)
  const wasEnabledRef = useRef(enabled)
  const onlineRetryRef = useRef(false)
  const enabledRef = useRef(enabled)
  const saveRef = useRef(save)
  const enqueueRef = useRef<(snapshot: SaveSnapshot) => Promise<void>>(() => Promise.resolve())

  latestSnapshotRef.current = currentSnapshot
  enabledRef.current = enabled
  saveRef.current = save

  const drain = useCallback(async (queue: SaveQueue) => {
    while (queue.pending) {
      const requestedSnapshot = queue.pending
      queue.pending = null

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        queue.pending = requestedSnapshot
        onlineRetryRef.current = false
        if (queueRef.current === queue && !disposedRef.current && enabledRef.current) setState('local')
        return
      }

      const canWriteUi = () => (
        queueRef.current === queue &&
        !disposedRef.current &&
        enabledRef.current &&
        latestSnapshotRef.current.noteId === requestedSnapshot.noteId
      )
      if (canWriteUi()) setState('saving')

      try {
        await saveRef.current(copySnapshot(requestedSnapshot.payload))
        queue.lastSavedKey = requestedSnapshot.key

        // 运行中再次提交同一快照无需重复写；失败分支不能做此去重，否则 A → B → A 会丢失最后 A。
        const latestPending = queue.pending as SaveSnapshot | null
        if (latestPending?.key === requestedSnapshot.key) queue.pending = null
        if (canWriteUi()) {
          setLastSavedSnapshot(copySnapshot(requestedSnapshot.payload))
          if (!queue.pending) {
            setState('saved')
            appToast.dismiss(`save:${requestedSnapshot.noteId}`)
          }
        }
      } catch {
        // 失败时优先保留运行期间到达的最新快照；没有更新输入时才把本轮快照放回队列。
        if (!queue.pending) queue.pending = requestedSnapshot
        if (canWriteUi()) {
          setState('error')
          appToast.error({
            id: `save:${requestedSnapshot.noteId}`,
            title: '保存失败',
            message: '内容已保留在本地，可重新保存。',
            action: {
              label: '重新保存',
              onClick: () => { void enqueueRef.current(queue.pending || latestSnapshotRef.current) },
            },
            persistent: true,
          })
        }
        return
      }
    }
  }, [])

  const enqueue = useCallback((requestedSnapshot: SaveSnapshot): Promise<void> => {
    const queue = queueRef.current
    queue.pending = requestedSnapshot

    if (!queue.running) {
      if (queue.lastSavedKey === requestedSnapshot.key) {
        queue.pending = null
        return Promise.resolve()
      }

      // running 始终代表整个 drain，而非单次请求，saveNow 才能复用当前串行队列。
      const running = drain(queue).finally(() => {
        if (queue.running === running) queue.running = null
      })
      queue.running = running
    }
    return queue.running
  }, [drain])
  enqueueRef.current = enqueue

  const saveNow = useCallback(() => {
    const latestSnapshot = latestSnapshotRef.current
    if (debounceRef.current?.key === latestSnapshot.key) {
      window.clearTimeout(debounceRef.current.timer)
      debounceRef.current = null
    }
    return enqueue(latestSnapshot)
  }, [enqueue])

  const retry = useCallback(() => {
    return enqueue(queueRef.current.pending || latestSnapshotRef.current)
  }, [enqueue])

  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      queueRef.current.pending = null
      queueRef.current = createQueue(latestSnapshotRef.current.key)
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current.timer)
        debounceRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const resetQueue = () => {
      // 旧请求仍可自然结束，但替换 queue 后不再具备 UI 回写资格，也不会被新快照复用。
      queueRef.current.pending = null
      queueRef.current = createQueue(currentSnapshot.key)
      setLastSavedSnapshot(null)
      setState('idle')
    }

    if (observedNoteIdRef.current !== noteId) {
      observedNoteIdRef.current = noteId
      wasEnabledRef.current = enabled
      resetQueue()
      return
    }

    if (!enabled) {
      wasEnabledRef.current = false
      resetQueue()
      return
    }

    if (!wasEnabledRef.current) {
      wasEnabledRef.current = true
      resetQueue()
      return
    }

    const queue = queueRef.current
    if (queue.lastSavedKey === currentSnapshot.key) {
      if (queue.pending?.key === currentSnapshot.key) queue.pending = null
      return
    }

    queue.pending = currentSnapshot
    const timer = window.setTimeout(() => {
      if (debounceRef.current?.timer === timer) debounceRef.current = null
      void enqueue(currentSnapshot)
    }, delayMs)
    debounceRef.current = { key: currentSnapshot.key, timer }
    return () => {
      window.clearTimeout(timer)
      if (debounceRef.current?.timer === timer) debounceRef.current = null
    }
  }, [currentSnapshot.key, delayMs, enabled, enqueue, noteId])

  useEffect(() => {
    const retryOnOnline = () => {
      const pending = queueRef.current.pending
      if (!enabledRef.current || onlineRetryRef.current || !pending) return
      onlineRetryRef.current = true
      void enqueue(pending)
    }
    window.addEventListener('online', retryOnOnline)
    return () => { window.removeEventListener('online', retryOnOnline) }
  }, [enqueue])

  return { state, saveNow, retry, lastSavedSnapshot }
}
