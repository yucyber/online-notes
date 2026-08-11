import { act, renderHook } from '@testing-library/react'
import { useEditorLayoutPreferences } from '@/components/editor/useEditorLayoutPreferences'

describe('useEditorLayoutPreferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('restores independent panel state and clamps width', () => {
    localStorage.setItem('notes:editor-layout:v1', JSON.stringify({
      leftCollapsed: true,
      rightCollapsed: false,
      leftWidth: 999,
    }))

    const { result } = renderHook(() => useEditorLayoutPreferences())

    expect(result.current.preferences).toEqual({
      leftCollapsed: true,
      rightCollapsed: false,
      leftWidth: 360,
    })
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
})
