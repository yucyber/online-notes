'use client'

import { useSyncExternalStore } from 'react'

export type EditorLayoutPreferences = {
  leftCollapsed: boolean
  rightCollapsed: boolean
  leftWidth: number
}

const STORAGE_KEY = 'notes:editor-layout:v1'
const AUTO_SAVE_STORAGE_KEY = 'notes:editor-layout:auto-save:v1'
const MIN_LEFT_WIDTH = 220
const MAX_LEFT_WIDTH = 360
const DEFAULT_LEFT_WIDTH = 236
const SSR_DEFAULT_PREFERENCES: EditorLayoutPreferences = {
  leftCollapsed: false,
  rightCollapsed: false,
  leftWidth: DEFAULT_LEFT_WIDTH,
}

let preferences = SSR_DEFAULT_PREFERENCES
let autoSaveLayout = true
let initialized = false
let hasExplicitPreference = false
const listeners = new Set<() => void>()

function clampLeftWidth(width: unknown) {
  const value = typeof width === 'number' && Number.isFinite(width) ? width : DEFAULT_LEFT_WIDTH
  return Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, value))
}

function getViewportDefaults(): EditorLayoutPreferences {
  return {
    leftCollapsed: window.innerWidth < 768,
    rightCollapsed: window.innerWidth < 1024,
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

function getStoredAutoSaveLayout() {
  try {
    return window.localStorage.getItem(AUTO_SAVE_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

function emitChange() {
  listeners.forEach((listener) => listener())
}

function handleResize() {
  if (hasExplicitPreference) return
  preferences = getViewportDefaults()
  emitChange()
}

function initialize() {
  if (initialized) return
  autoSaveLayout = getStoredAutoSaveLayout()
  const stored = autoSaveLayout ? getStoredPreferences() : null
  if (!autoSaveLayout) {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // 浏览器禁用 localStorage 时仍可在当前会话关闭自动保存。
    }
  }
  hasExplicitPreference = stored !== null
  preferences = stored ?? getViewportDefaults()
  initialized = true
  window.addEventListener('resize', handleResize)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  initialize()
  listener()

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && initialized) {
      window.removeEventListener('resize', handleResize)
      initialized = false
      preferences = SSR_DEFAULT_PREFERENCES
      autoSaveLayout = true
      hasExplicitPreference = false
    }
  }
}

function getSnapshot() {
  return preferences
}

function getServerSnapshot() {
  return SSR_DEFAULT_PREFERENCES
}

function save(next: EditorLayoutPreferences) {
  if (!autoSaveLayout) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // localStorage 被浏览器策略禁用时仍保留当前会话状态，避免布局操作失效。
  }
}

export function setAutoSaveLayout(enabled: boolean) {
  autoSaveLayout = enabled
  try {
    window.localStorage.setItem(AUTO_SAVE_STORAGE_KEY, String(enabled))
    if (!enabled) window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 开关仍在当前会话生效，存储策略不可用不应阻断编辑器布局。
  }

  if (!enabled) {
    hasExplicitPreference = false
    preferences = getViewportDefaults()
  } else {
    preferences = { ...preferences }
  }
  emitChange()
}

function update(
  updater: (current: EditorLayoutPreferences) => EditorLayoutPreferences,
  persist = true,
  marksExplicitPreference = true,
) {
  if (marksExplicitPreference) hasExplicitPreference = true
  preferences = updater(preferences)
  if (persist) save(preferences)
  emitChange()
}

export function toggleLeft() {
  update((current) => ({ ...current, leftCollapsed: !current.leftCollapsed }))
}

export function toggleRight() {
  update((current) => ({ ...current, rightCollapsed: !current.rightCollapsed }))
}

export function setLeftWidth(width: number, persist = true, marksExplicitPreference = true) {
  update(
    (current) => ({ ...current, leftWidth: clampLeftWidth(width) }),
    persist,
    marksExplicitPreference,
  )
}

export function useEditorLayoutPreferences() {
  const currentPreferences = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return {
    preferences: currentPreferences,
    autoSaveLayout,
    toggleLeft,
    toggleRight,
    setLeftWidth,
    setAutoSaveLayout,
  }
}
