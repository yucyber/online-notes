import { act, renderHook, waitFor } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { useEditorLayoutPreferences } from '@/components/editor/useEditorLayoutPreferences'

const { TextEncoder } = require('util')
;(globalThis as { TextEncoder?: typeof TextEncoder }).TextEncoder ??= TextEncoder
const { renderToString } = require('react-dom/server') as typeof import('react-dom/server')

function LayoutPreferenceSnapshot() {
  const { preferences } = useEditorLayoutPreferences()
  return <output data-testid="layout-preferences">{JSON.stringify(preferences)}</output>
}

describe('useEditorLayoutPreferences', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  })

  it('hydrates stored independent panel state and clamps width after mount', async () => {
    const stored = JSON.stringify({
      leftCollapsed: true,
      rightCollapsed: false,
      leftWidth: 999,
    })
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(stored)

    const { result } = renderHook(() => useEditorLayoutPreferences())

    await waitFor(() => {
      expect(result.current.preferences).toEqual({
        leftCollapsed: true,
        rightCollapsed: false,
        leftWidth: 360,
      })
    })
  })

  it('keeps SSR markup stable before hydration and applies stored preferences in the client effect', () => {
    localStorage.setItem('notes:editor-layout:v1', JSON.stringify({
      leftCollapsed: true,
      rightCollapsed: false,
      leftWidth: 999,
    }))
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 })

    const markup = renderToString(<LayoutPreferenceSnapshot />)
    expect(markup).toContain('{&quot;leftCollapsed&quot;:false,&quot;rightCollapsed&quot;:false,&quot;leftWidth&quot;:280}')

    const container = document.createElement('div')
    container.innerHTML = markup
    document.body.appendChild(container)
    const recoverableError = jest.fn()

    let root: ReturnType<typeof hydrateRoot>
    act(() => {
      root = hydrateRoot(container, <LayoutPreferenceSnapshot />, { onRecoverableError: recoverableError })
    })

    expect(container.textContent).toBe('{"leftCollapsed":true,"rightCollapsed":false,"leftWidth":360}')
    expect(recoverableError).not.toHaveBeenCalled()

    act(() => root.unmount())
    container.remove()
  })

  it('keeps left and right controls independent while persisting valid widths', () => {
    const { result } = renderHook(() => useEditorLayoutPreferences())

    act(() => {
      result.current.toggleLeft()
      result.current.setLeftWidth(180)
    })

    expect(result.current.preferences).toEqual({
      leftCollapsed: true,
      rightCollapsed: false,
      leftWidth: 220,
    })

    act(() => {
      result.current.toggleRight()
    })

    expect(result.current.preferences).toEqual({
      leftCollapsed: true,
      rightCollapsed: true,
      leftWidth: 220,
    })
    expect(JSON.parse(localStorage.getItem('notes:editor-layout:v1') || '{}')).toEqual({
      leftCollapsed: true,
      rightCollapsed: true,
      leftWidth: 220,
    })
  })

  it('falls back to desktop defaults when stored preferences are malformed', () => {
    localStorage.setItem('notes:editor-layout:v1', '{invalid')

    const { result } = renderHook(() => useEditorLayoutPreferences())

    expect(result.current.preferences).toEqual({
      leftCollapsed: false,
      rightCollapsed: false,
      leftWidth: 280,
    })
  })

  it('updates breakpoint defaults until a user explicitly chooses a panel state', () => {
    const { result } = renderHook(() => useEditorLayoutPreferences())

    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current.preferences.rightCollapsed).toBe(true)

    act(() => {
      result.current.toggleRight()
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 })
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current.preferences.rightCollapsed).toBe(false)
  })

  it('removes the resize listener on unmount so a later viewport change cannot update the hook', () => {
    const addEventListener = jest.spyOn(window, 'addEventListener')
    const removeEventListener = jest.spyOn(window, 'removeEventListener')
    const { result, unmount } = renderHook(() => useEditorLayoutPreferences())
    const registeredResizeListener = addEventListener.mock.calls.find(([eventName]) => eventName === 'resize')?.[1]
    const preferencesBeforeUnmount = result.current.preferences

    expect(registeredResizeListener).toBeDefined()
    unmount()
    expect(removeEventListener).toHaveBeenCalledWith('resize', registeredResizeListener)

    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 })
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current.preferences).toEqual(preferencesBeforeUnmount)
  })

  it('updates live width without persisting until the resize is committed', () => {
    const { result } = renderHook(() => useEditorLayoutPreferences())

    act(() => {
      result.current.setLeftWidth(340, false)
    })
    expect(result.current.preferences.leftWidth).toBe(340)
    expect(localStorage.getItem('notes:editor-layout:v1')).toBeNull()

    act(() => {
      result.current.setLeftWidth(280, false)
    })
    expect(result.current.preferences.leftWidth).toBe(280)
    expect(localStorage.getItem('notes:editor-layout:v1')).toBeNull()

    act(() => {
      result.current.setLeftWidth(340, false)
      result.current.setLeftWidth(340)
    })
    expect(JSON.parse(localStorage.getItem('notes:editor-layout:v1') || '{}')).toMatchObject({ leftWidth: 340 })
  })
})
