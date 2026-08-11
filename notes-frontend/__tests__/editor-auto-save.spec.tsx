import { act, render, renderHook, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

const errorToast = jest.fn()
const dismissToast = jest.fn()

jest.mock('@/lib/app-toast', () => ({
  appToast: { error: errorToast, dismiss: dismissToast },
}))

import { EditorSaveStatus } from '@/components/editor/EditorSaveStatus'
import { useEditorAutoSave } from '@/components/editor/useEditorAutoSave'

describe('useEditorAutoSave', () => {
  const originalOnline = Object.getOwnPropertyDescriptor(window.navigator, 'onLine')

  beforeEach(() => {
    jest.useFakeTimers()
    errorToast.mockReset()
    dismissToast.mockReset()
    setOnline(true)
  })

  afterEach(() => {
    jest.useRealTimers()
    if (originalOnline) Object.defineProperty(window.navigator, 'onLine', originalOnline)
  })

  it('debounces a changed snapshot and reports saved', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const { result, rerender } = renderHook((props) => useEditorAutoSave(props), {
      initialProps: { noteId: 'n1', snapshot: makeSnapshot('one'), enabled: true, save, delayMs: 400 },
    })

    rerender({ noteId: 'n1', snapshot: makeSnapshot('two'), enabled: true, save, delayMs: 400 })
    await act(async () => { jest.advanceTimersByTime(400) })

    expect(result.current.state).toBe('saved')
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(makeSnapshot('two'))
  })

  it('does not save when read-only', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const { result, rerender } = renderHook((props) => useEditorAutoSave(props), {
      initialProps: { noteId: 'n1', snapshot: makeSnapshot('one'), enabled: false, save, delayMs: 400 },
    })

    rerender({ noteId: 'n1', snapshot: makeSnapshot('two'), enabled: false, save, delayMs: 400 })
    await act(async () => { jest.advanceTimersByTime(400) })

    expect(result.current.state).toBe('idle')
    expect(save).not.toHaveBeenCalled()
  })

  it('does not send an already saved snapshot again', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const { result, rerender } = renderHook((props) => useEditorAutoSave(props), {
      initialProps: { noteId: 'n1', snapshot: makeSnapshot('one'), enabled: true, save, delayMs: 400 },
    })

    rerender({ noteId: 'n1', snapshot: makeSnapshot('two'), enabled: true, save, delayMs: 400 })
    await act(async () => { jest.advanceTimersByTime(400) })
    await act(async () => { await result.current.saveNow() })

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('reuses the manual save while its debounce timer is pending', async () => {
    const pending = deferred<void>()
    const save = jest.fn().mockReturnValue(pending.promise)
    const { result, rerender } = renderHook((props) => useEditorAutoSave(props), {
      initialProps: { noteId: 'n1', snapshot: makeSnapshot('one'), enabled: true, save, delayMs: 400 },
    })

    rerender({ noteId: 'n1', snapshot: makeSnapshot('two'), enabled: true, save, delayMs: 400 })
    act(() => { void result.current.saveNow() })
    await act(async () => { jest.advanceTimersByTime(400) })

    expect(save).toHaveBeenCalledTimes(1)

    await act(async () => { pending.resolve() })
  })

  it('keeps saving until the latest queued snapshot succeeds', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    const save = jest.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { result, rerender } = renderHook((props) => useEditorAutoSave(props), {
      initialProps: { noteId: 'n1', snapshot: makeSnapshot('one'), enabled: true, save, delayMs: 400 },
    })

    rerender({ noteId: 'n1', snapshot: makeSnapshot('two'), enabled: true, save, delayMs: 400 })
    await act(async () => { jest.advanceTimersByTime(400) })
    rerender({ noteId: 'n1', snapshot: makeSnapshot('three'), enabled: true, save, delayMs: 400 })
    await act(async () => { jest.advanceTimersByTime(400) })

    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current.lastSavedSnapshot).toBeNull()

    await act(async () => { first.resolve() })
    expect(save).toHaveBeenCalledTimes(2)
    expect(result.current.state).toBe('saving')
    expect(result.current.lastSavedSnapshot).toEqual(makeSnapshot('two'))

    await act(async () => { second.resolve() })
    expect(result.current.state).toBe('saved')
    expect(result.current.lastSavedSnapshot).toEqual(makeSnapshot('three'))
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('keeps changes locally offline and retries once when the network returns', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const { result, rerender } = renderHook((props) => useEditorAutoSave(props), {
      initialProps: { noteId: 'n1', snapshot: makeSnapshot('one'), enabled: true, save, delayMs: 400 },
    })

    setOnline(false)
    rerender({ noteId: 'n1', snapshot: makeSnapshot('two'), enabled: true, save, delayMs: 400 })
    await act(async () => { jest.advanceTimersByTime(400) })
    expect(result.current.state).toBe('local')
    expect(save).not.toHaveBeenCalled()

    setOnline(true)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await act(async () => { window.dispatchEvent(new Event('online')) })

    expect(result.current.state).toBe('saved')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('retains a failed snapshot for retry and shows a persistent error toast', async () => {
    const save = jest.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(undefined)
    const { result, rerender } = renderHook((props) => useEditorAutoSave(props), {
      initialProps: { noteId: 'n1', snapshot: makeSnapshot('one'), enabled: true, save, delayMs: 400 },
    })

    rerender({ noteId: 'n1', snapshot: makeSnapshot('two'), enabled: true, save, delayMs: 400 })
    await act(async () => { jest.advanceTimersByTime(400) })

    expect(result.current.state).toBe('error')
    expect(errorToast).toHaveBeenCalledWith(expect.objectContaining({
      id: 'save:n1',
      persistent: true,
      action: expect.objectContaining({ label: '重新保存' }),
    }))

    await act(async () => { await result.current.retry() })
    expect(result.current.state).toBe('saved')
    expect(save).toHaveBeenCalledTimes(2)
    expect(dismissToast).toHaveBeenCalledWith('save:n1')
  })

  it('does not update state or show a toast after an in-flight save unmounts', async () => {
    const pending = deferred<void>()
    const save = jest.fn().mockReturnValue(pending.promise)
    const { result, rerender, unmount } = renderHook((props) => useEditorAutoSave(props), {
      initialProps: { noteId: 'n1', snapshot: makeSnapshot('one'), enabled: true, save, delayMs: 400 },
    })

    rerender({ noteId: 'n1', snapshot: makeSnapshot('two'), enabled: true, save, delayMs: 400 })
    await act(async () => { jest.advanceTimersByTime(400) })
    expect(result.current.state).toBe('saving')

    unmount()
    await act(async () => { pending.reject(new Error('request after unmount')) })

    expect(errorToast).not.toHaveBeenCalled()
    expect(dismissToast).not.toHaveBeenCalled()
  })

  it('does not dismiss a toast after an in-flight save succeeds post-unmount', async () => {
    const pending = deferred<void>()
    const save = jest.fn().mockReturnValue(pending.promise)
    const { rerender, unmount } = renderHook((props) => useEditorAutoSave(props), {
      initialProps: { noteId: 'n1', snapshot: makeSnapshot('one'), enabled: true, save, delayMs: 400 },
    })

    rerender({ noteId: 'n1', snapshot: makeSnapshot('two'), enabled: true, save, delayMs: 400 })
    await act(async () => { jest.advanceTimersByTime(400) })
    unmount()
    await act(async () => { pending.resolve() })

    expect(dismissToast).not.toHaveBeenCalled()
  })
})

describe('EditorSaveStatus', () => {
  it.each([
    ['saving', '正在保存…'],
    ['saved', '已自动保存'],
    ['local', '已保存到本地'],
    ['error', '保存失败'],
  ] as const)('renders %s state', (state, label) => {
    render(<EditorSaveStatus state={state} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value })
}

function makeSnapshot(content: string) {
  return { title: 'A', content, tags: [] }
}
