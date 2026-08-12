'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type EditorLayoutPreferences = {
  leftCollapsed: boolean
  rightCollapsed: boolean
  leftWidth: number
}

const STORAGE_KEY = 'notes:editor-layout:v1'
const MIN_LEFT_WIDTH = 220
const MAX_LEFT_WIDTH = 360
const DEFAULT_LEFT_WIDTH = 236
const SSR_DEFAULT_PREFERENCES: EditorLayoutPreferences = {
  leftCollapsed: false,
  rightCollapsed: false,
  leftWidth: DEFAULT_LEFT_WIDTH,
}

function clampLeftWidth(width: unknown) {
  const value = typeof width === 'number' && Number.isFinite(width) ? width : DEFAULT_LEFT_WIDTH
  return Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, value))
}

function getViewportDefaults(): EditorLayoutPreferences {
  const viewportWidth = window.innerWidth
  return {
    leftCollapsed: viewportWidth < 768,
    rightCollapsed: viewportWidth < 1024,
    leftWidth: DEFAULT_LEFT_WIDTH,
  }
}

function getStoredPreferences(): EditorLayoutPreferences | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as Partial<EditorLayoutPreferences>
    if (typeof stored.leftCollapsed !== 'boolean' || typeof stored.rightCollapsed !== 'boolean') return null

    return {
      leftCollapsed: stored.leftCollapsed,
      rightCollapsed: stored.rightCollapsed,
      leftWidth: clampLeftWidth(stored.leftWidth),
    }
  } catch {
    return null
  }
}

export function useEditorLayoutPreferences() {
  const [preferences, setPreferences] = useState<EditorLayoutPreferences>(SSR_DEFAULT_PREFERENCES)
  const hasExplicitPreferenceRef = useRef(false)

  useEffect(() => {
    const stored = getStoredPreferences()
    hasExplicitPreferenceRef.current = stored !== null
    setPreferences(stored ?? getViewportDefaults())

    const handleResize = () => {
      if (!hasExplicitPreferenceRef.current) setPreferences(getViewportDefaults())
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const save = useCallback((next: EditorLayoutPreferences) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 本地存储不可用时保留当前会话布局，避免编辑页交互被浏览器策略阻断。
    }
  }, [])

  const update = useCallback((updater: (current: EditorLayoutPreferences) => EditorLayoutPreferences, persist = true, marksExplicitPreference = true) => {
    if (marksExplicitPreference) hasExplicitPreferenceRef.current = true
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

  const setLeftWidth = useCallback((width: number, persist = true, marksExplicitPreference = true) => {
    update((current) => ({ ...current, leftWidth: clampLeftWidth(width) }), persist, marksExplicitPreference)
  }, [update])

  return { preferences, toggleLeft, toggleRight, setLeftWidth }
}
