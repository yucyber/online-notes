'use client'

import { useCallback, useState } from 'react'

export type EditorLayoutPreferences = {
  leftCollapsed: boolean
  rightCollapsed: boolean
  leftWidth: number
}

const STORAGE_KEY = 'notes:editor-layout:v1'
const MIN_LEFT_WIDTH = 220
const MAX_LEFT_WIDTH = 360
const DEFAULT_LEFT_WIDTH = 280

function clampLeftWidth(width: unknown) {
  const value = typeof width === 'number' && Number.isFinite(width) ? width : DEFAULT_LEFT_WIDTH
  return Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, value))
}

function getDefaultPreferences(): EditorLayoutPreferences {
  const viewportWidth = typeof window === 'undefined' ? Infinity : window.innerWidth
  // 仅在没有用户保存选择时按断点给默认值，后续始终以持久化偏好为准。
  return {
    leftCollapsed: viewportWidth < 768,
    rightCollapsed: viewportWidth < 1024,
    leftWidth: DEFAULT_LEFT_WIDTH,
  }
}

function getStoredPreferences(): EditorLayoutPreferences {
  const defaults = getDefaultPreferences()
  if (typeof window === 'undefined') return defaults

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const stored = JSON.parse(raw) as Partial<EditorLayoutPreferences>
    if (typeof stored.leftCollapsed !== 'boolean' || typeof stored.rightCollapsed !== 'boolean') return defaults

    return {
      leftCollapsed: stored.leftCollapsed,
      rightCollapsed: stored.rightCollapsed,
      leftWidth: clampLeftWidth(stored.leftWidth),
    }
  } catch {
    return defaults
  }
}

export function useEditorLayoutPreferences() {
  const [preferences, setPreferences] = useState<EditorLayoutPreferences>(getStoredPreferences)

  const save = useCallback((next: EditorLayoutPreferences) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 本地存储不可用时保留当前会话布局，避免编辑页交互被浏览器策略阻断。
    }
  }, [])

  const update = useCallback((updater: (current: EditorLayoutPreferences) => EditorLayoutPreferences, persist = true) => {
    setPreferences((current) => {
      const next = updater(current)
      if (persist) save(next)
      return next
    })
  }, [save])

  const toggleLeft = useCallback(() => {
    update((current) => ({ ...current, leftCollapsed: !current.leftCollapsed }))
  }, [update])

  const toggleRight = useCallback(() => {
    update((current) => ({ ...current, rightCollapsed: !current.rightCollapsed }))
  }, [update])

  const setLeftWidth = useCallback((width: number, persist = true) => {
    update((current) => ({ ...current, leftWidth: clampLeftWidth(width) }), persist)
  }, [update])

  return { preferences, toggleLeft, toggleRight, setLeftWidth }
}
