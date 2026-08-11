'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { appToast } from '@/lib/app-toast'

export type SaveState = 'idle' | 'saving' | 'saved' | 'local' | 'error'

type SaveSnapshot = {
  noteId: string
  key: string
  title: string
  content: string
}

type UseEditorAutoSaveOptions = {
  noteId: string
  title: string
  content: string
  enabled: boolean
  save: (title: string, content: string) => Promise<void>
  delayMs: number
}

export function useEditorAutoSave({ noteId, title, content, enabled, save, delayMs }: UseEditorAutoSaveOptions) {
  const [state, setState] = useState<SaveState>('idle')
  const latestSnapshotRef = useRef<SaveSnapshot>({ noteId, key: '', title, content })
  const savedSnapshotRef = useRef('')
  const pendingSnapshotRef = useRef<SaveSnapshot | null>(null)
  const debounceRef = useRef<{ key: string; timer: number } | null>(null)
  const inFlightRef = useRef<{ key: string; promise: Promise<void> } | null>(null)
  const requestTokenRef = useRef(0)
  const disposedRef = useRef(false)
  const observedNoteIdRef = useRef<string | null>(null)
  const wasEnabledRef = useRef(false)
  const onlineRetryRef = useRef(false)
  const enabledRef = useRef(enabled)
  const saveRef = useRef(save)

  const snapshot: SaveSnapshot = {
    noteId,
    key: JSON.stringify([noteId, title, content]),
    title,
    content,
  }
  latestSnapshotRef.current = snapshot
  enabledRef.current = enabled
  saveRef.current = save

  const saveSnapshot = useCallback((requestedSnapshot?: SaveSnapshot): Promise<void> => {
    const currentSnapshot = requestedSnapshot || pendingSnapshotRef.current || latestSnapshotRef.current
    if (disposedRef.current || !enabledRef.current || savedSnapshotRef.current === currentSnapshot.key) return Promise.resolve()

    const inFlight = inFlightRef.current
    if (inFlight?.key === currentSnapshot.key) return inFlight.promise

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      pendingSnapshotRef.current = currentSnapshot
      onlineRetryRef.current = false
      setState('local')
      return Promise.resolve()
    }

    const requestToken = ++requestTokenRef.current
    pendingSnapshotRef.current = currentSnapshot
    setState('saving')

    let promise!: Promise<void>
    try {
      promise = saveRef.current(currentSnapshot.title, currentSnapshot.content)
    } catch (error) {
      promise = Promise.reject(error)
    }
    promise = promise.then(
      () => {
        if (disposedRef.current || requestToken !== requestTokenRef.current) return

        savedSnapshotRef.current = currentSnapshot.key
        pendingSnapshotRef.current = null
        setState('saved')
        appToast.dismiss(`save:${currentSnapshot.noteId}`)
      },
      () => {
        if (disposedRef.current || requestToken !== requestTokenRef.current) return

        // 保存失败时保留最新快照，避免用户只能重新输入已编辑的内容。
        pendingSnapshotRef.current = currentSnapshot
        setState('error')
        appToast.error({
          id: `save:${currentSnapshot.noteId}`,
          title: '保存失败',
          message: '内容已保留在本地，可重新保存。',
          action: { label: '重新保存', onClick: () => { void saveSnapshot() } },
          persistent: true,
        })
      },
    ).finally(() => {
      if (inFlightRef.current?.promise === promise) inFlightRef.current = null
    })
    inFlightRef.current = { key: currentSnapshot.key, promise }
    return promise
  }, [])

  const saveNow = useCallback(() => {
    const currentSnapshot = latestSnapshotRef.current
    if (debounceRef.current?.key === currentSnapshot.key) {
      window.clearTimeout(debounceRef.current.timer)
      debounceRef.current = null
    }
    return saveSnapshot(currentSnapshot)
  }, [saveSnapshot])

  const retry = useCallback(() => {
    return saveSnapshot(pendingSnapshotRef.current || latestSnapshotRef.current)
  }, [saveSnapshot])

  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      requestTokenRef.current += 1
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current.timer)
        debounceRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (observedNoteIdRef.current !== noteId) {
      observedNoteIdRef.current = noteId
      savedSnapshotRef.current = snapshot.key
      pendingSnapshotRef.current = null
      requestTokenRef.current += 1
      wasEnabledRef.current = enabled
      setState('idle')
      return
    }

    if (!enabled) {
      requestTokenRef.current += 1
      wasEnabledRef.current = false
      savedSnapshotRef.current = snapshot.key
      pendingSnapshotRef.current = null
      setState('idle')
      return
    }

    if (!wasEnabledRef.current) {
      wasEnabledRef.current = true
      savedSnapshotRef.current = snapshot.key
      pendingSnapshotRef.current = null
      setState('idle')
      return
    }

    if (savedSnapshotRef.current === snapshot.key) {
      if (pendingSnapshotRef.current?.key === snapshot.key) pendingSnapshotRef.current = null
      return
    }

    // 输入变化立即作废旧请求的回写资格，延迟完成也不能覆盖新内容的状态。
    requestTokenRef.current += 1
    pendingSnapshotRef.current = snapshot
    const timer = window.setTimeout(() => {
      if (debounceRef.current?.timer === timer) debounceRef.current = null
      void saveSnapshot(snapshot)
    }, delayMs)
    debounceRef.current = { key: snapshot.key, timer }
    return () => {
      window.clearTimeout(timer)
      if (debounceRef.current?.timer === timer) debounceRef.current = null
    }
  }, [delayMs, enabled, noteId, saveSnapshot, snapshot.key])

  useEffect(() => {
    const retryOnOnline = () => {
      if (!enabledRef.current || onlineRetryRef.current || !pendingSnapshotRef.current) return
      onlineRetryRef.current = true
      void saveSnapshot(pendingSnapshotRef.current)
    }
    window.addEventListener('online', retryOnOnline)
    return () => { window.removeEventListener('online', retryOnOnline) }
  }, [saveSnapshot])

  return { state, saveNow, retry }
}
