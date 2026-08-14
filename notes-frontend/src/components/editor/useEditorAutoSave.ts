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
  noteId: string
  generation: number
  running: Promise<void> | null
  pending: SaveSnapshot | null
  lastSavedKey: string
}

type WriteResult = 'saved' | 'failed' | 'offline' | 'stale'

// writer tail 必须跨 hook 实例存活，避免同 note 卸载重挂后绕过尚未完成的物理写。
const writerTails = new Map<string, Promise<void>>()

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

function createQueue(noteId: string, generation: number, lastSavedKey: string): SaveQueue {
  return { noteId, generation, running: null, pending: null, lastSavedKey }
}

export function useEditorAutoSave({ noteId, snapshot, enabled, save, delayMs }: UseEditorAutoSaveOptions) {
  const currentSnapshot = toSaveSnapshot(noteId, snapshot)
  const [state, setState] = useState<SaveState>('idle')
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<EditorSnapshot | null>(null)
  const latestSnapshotRef = useRef(currentSnapshot)
  const generationRef = useRef(0)
  const queueRef = useRef<SaveQueue>(createQueue(noteId, generationRef.current, currentSnapshot.key))
  const debounceRef = useRef<{ key: string; timer: number } | null>(null)
  const disposedRef = useRef(false)
  const observedNoteIdRef = useRef(noteId)
  const wasEnabledRef = useRef(enabled)
  const onlineRetryRef = useRef(false)
  const enabledRef = useRef(enabled)
  const saveRef = useRef(save)
  const enqueueRef = useRef<(queue: SaveQueue, snapshot: SaveSnapshot) => Promise<void>>(() => Promise.resolve())

  latestSnapshotRef.current = currentSnapshot
  enabledRef.current = enabled
  saveRef.current = save

  const canUseQueue = useCallback((queue: SaveQueue, requestedNoteId: string) => (
    queueRef.current === queue &&
    queue.generation === generationRef.current &&
    queue.noteId === requestedNoteId &&
    !disposedRef.current &&
    enabledRef.current &&
    latestSnapshotRef.current.noteId === requestedNoteId
  ), [])

  const drain = useCallback(async (queue: SaveQueue) => {
    while (queue.pending) {
      let requestedSnapshot = queue.pending
      queue.pending = null

      if (!canUseQueue(queue, requestedSnapshot.noteId)) return

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        queue.pending = requestedSnapshot
        onlineRetryRef.current = false
        setState('local')
        return
      }

      setState('saving')

      const previousWriter = writerTails.get(requestedSnapshot.noteId) || Promise.resolve()
      // generation 可以替换 UI queue，但同 note 的物理 writer 必须接在旧 tail 后，不能另开并发写。
      const writeResult = previousWriter.catch(() => undefined).then(async (): Promise<WriteResult> => {
        // 等待旧 writer 时继续合并输入，真正取得写资格后只消费最后一个 pending。
        const latestPending = queue.pending as SaveSnapshot | null
        if (latestPending) {
          requestedSnapshot = latestPending
          queue.pending = null
        }
        if (!canUseQueue(queue, requestedSnapshot.noteId)) return 'stale'
        if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline'
        try {
          await saveRef.current(copySnapshot(requestedSnapshot.payload))
          return 'saved'
        } catch {
          return 'failed'
        }
      })
      const writerTail = writeResult.then(() => undefined)
      writerTails.set(requestedSnapshot.noteId, writerTail)
      const result = await writeResult
      if (writerTails.get(requestedSnapshot.noteId) === writerTail) {
        writerTails.delete(requestedSnapshot.noteId)
      }

      if (result === 'stale' || !canUseQueue(queue, requestedSnapshot.noteId)) return

      if (result === 'offline') {
        // online 事件可能在等待旧 writer 时再次断网，必须重新开放下一次自动重试。
        if (!queue.pending) queue.pending = requestedSnapshot
        onlineRetryRef.current = false
        setState('local')
        return
      } else if (result === 'saved') {
        queue.lastSavedKey = requestedSnapshot.key

        // 运行中再次提交同一快照无需重复写；失败分支不能做此去重，否则 A → B → A 会丢失最后 A。
        const latestPending = queue.pending as SaveSnapshot | null
        if (latestPending?.key === requestedSnapshot.key) queue.pending = null
        setLastSavedSnapshot(copySnapshot(requestedSnapshot.payload))
        if (!queue.pending) {
          setState('saved')
          appToast.dismiss(`save:${requestedSnapshot.noteId}`)
        }
      } else {
        // 失败时优先保留运行期间到达的最新快照；没有更新输入时才把本轮快照放回队列。
        if (!queue.pending) queue.pending = requestedSnapshot
        setState('error')
        const toastId = `save:${requestedSnapshot.noteId}`
        appToast.error({
          id: toastId,
          title: '保存失败',
          message: '内容已保留在本地，可重新保存。',
          action: {
            label: '重新保存',
            onClick: () => {
              if (!canUseQueue(queue, requestedSnapshot.noteId)) {
                appToast.dismiss(toastId)
                return
              }
              void enqueueRef.current(queue, queue.pending || latestSnapshotRef.current)
            },
          },
          persistent: true,
        })
        return
      }
    }
  }, [canUseQueue])

  const enqueue = useCallback((queue: SaveQueue, requestedSnapshot: SaveSnapshot): Promise<void> => {
    if (!canUseQueue(queue, requestedSnapshot.noteId)) return Promise.resolve()
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
  }, [canUseQueue, drain])
  enqueueRef.current = enqueue

  const saveNow = useCallback(() => {
    const latestSnapshot = latestSnapshotRef.current
    if (debounceRef.current?.key === latestSnapshot.key) {
      window.clearTimeout(debounceRef.current.timer)
      debounceRef.current = null
    }
    return enqueue(queueRef.current, latestSnapshot)
  }, [enqueue])

  const retry = useCallback(() => {
    const queue = queueRef.current
    return enqueue(queue, queue.pending || latestSnapshotRef.current)
  }, [enqueue])

  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      queueRef.current.pending = null
      generationRef.current += 1
      queueRef.current = createQueue(
        latestSnapshotRef.current.noteId,
        generationRef.current,
        latestSnapshotRef.current.key,
      )
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current.timer)
        debounceRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const resetQueue = () => {
      // 替换 generation 只撤销 UI/重试资格；writer tail 继续保留同 note 的物理串行边界。
      queueRef.current.pending = null
      generationRef.current += 1
      queueRef.current = createQueue(noteId, generationRef.current, currentSnapshot.key)
      onlineRetryRef.current = false
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
      void enqueue(queue, currentSnapshot)
    }, delayMs)
    debounceRef.current = { key: currentSnapshot.key, timer }
    return () => {
      window.clearTimeout(timer)
      if (debounceRef.current?.timer === timer) debounceRef.current = null
    }
  }, [currentSnapshot.key, delayMs, enabled, enqueue, noteId])

  useEffect(() => {
    const retryOnOnline = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        onlineRetryRef.current = false
        return
      }
      const pending = queueRef.current.pending
      if (!enabledRef.current || onlineRetryRef.current || !pending) return
      onlineRetryRef.current = true
      void enqueue(queueRef.current, pending)
    }
    window.addEventListener('online', retryOnOnline)
    return () => { window.removeEventListener('online', retryOnOnline) }
  }, [enqueue])

  // 标题等单字段保存成功后，复用同一「已自动保存」轻量状态，不弹独立 Toast。
  const markSaved = useCallback(() => {
    setState('saved')
    appToast.dismiss(`save:${noteId}`)
  }, [noteId])

  return { state, saveNow, retry, lastSavedSnapshot, markSaved }
}
