import { act, render } from '@testing-library/react'
import { useEditorAutoSave } from '@/components/editor/useEditorAutoSave'
import type { EditorSnapshot } from '@/components/editor/editor-save-types'

type HarnessProps = {
  title: string
  content: string
  save: (snapshot: EditorSnapshot) => Promise<void>
  expose?: (result: ReturnType<typeof useEditorAutoSave>) => void
}

function Harness({ title, content, save, expose }: HarnessProps) {
  const snapshot = { title, content, tags: [] }
  const result = useEditorAutoSave({
    noteId: 'n1',
    snapshot,
    enabled: true,
    save,
    delayMs: 400,
  })
  expose?.(result)
  return null
}

describe('useEditorAutoSave save queue', () => {
  const originalOnline = Object.getOwnPropertyDescriptor(window.navigator, 'onLine')

  beforeEach(() => {
    jest.useFakeTimers()
    setOnline(true)
  })

  afterEach(() => {
    jest.useRealTimers()
    if (originalOnline) Object.defineProperty(window.navigator, 'onLine', originalOnline)
  })

  it('串行保存并让服务器最终停留在最新快照', async () => {
    const first = deferred<void>()
    let active = 0
    let maxActive = 0
    const save = jest.fn()
      .mockImplementationOnce(async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await first.promise
        active -= 1
      })
      .mockImplementationOnce(async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        active -= 1
      })
    const { rerender } = render(<Harness title="A" content="0" save={save} />)
    rerender(<Harness title="A" content="1" save={save} />)
    await advanceDebounce()
    expect(save).toHaveBeenNthCalledWith(1, expect.objectContaining({ title: 'A', content: '1' }))

    rerender(<Harness title="A" content="2" save={save} />)
    await advanceDebounce()
    expect(save).toHaveBeenCalledTimes(1)

    first.resolve()
    await flushPromises()
    expect(save).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: 'A', content: '2' }))
    expect(maxActive).toBe(1)
  })

  it('内容 A → B → A 时第一次 A 失败仍能重试最后 A', async () => {
    const first = deferred<void>()
    let activeRequests = 0
    let maxActiveRequests = 0
    const save = jest.fn().mockImplementation(async () => {
      const invocation = save.mock.calls.length
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      try {
        if (invocation === 1) await first.promise
      } finally {
        activeRequests -= 1
      }
    })
    let current!: ReturnType<typeof useEditorAutoSave>
    const expose = (result: ReturnType<typeof useEditorAutoSave>) => { current = result }
    const { rerender } = render(<Harness title="T" content="0" save={save} expose={expose} />)

    rerender(<Harness title="T" content="A" save={save} expose={expose} />)
    await advanceDebounce()
    rerender(<Harness title="T" content="B" save={save} expose={expose} />)
    await advanceDebounce()
    rerender(<Harness title="T" content="A" save={save} expose={expose} />)
    await advanceDebounce()
    expect(save).toHaveBeenCalledTimes(1)

    first.reject(new Error('first A failed'))
    await flushPromises()
    await act(async () => { await current.retry() })

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenNthCalledWith(2, expect.objectContaining({ content: 'A' }))
    expect(maxActiveRequests).toBe(1)
  })

  it('请求进行中 saveNow 不产生并发并返回当前 drain promise', async () => {
    const first = deferred<void>()
    let activeRequests = 0
    let maxActiveRequests = 0
    const save = jest.fn().mockImplementation(async () => {
      const invocation = save.mock.calls.length
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      if (invocation === 1) await first.promise
      activeRequests -= 1
    })
    let current!: ReturnType<typeof useEditorAutoSave>
    const expose = (result: ReturnType<typeof useEditorAutoSave>) => { current = result }
    const { rerender } = render(<Harness title="A" content="0" save={save} expose={expose} />)

    rerender(<Harness title="A" content="1" save={save} expose={expose} />)
    await advanceDebounce()
    rerender(<Harness title="A" content="2" save={save} expose={expose} />)
    let drainPromise!: Promise<void>
    act(() => { drainPromise = current.saveNow() })

    expect(save).toHaveBeenCalledTimes(1)
    expect(current.saveNow()).toBe(drainPromise)

    first.resolve()
    await act(async () => { await drainPromise })
    expect(save).toHaveBeenNthCalledWith(2, expect.objectContaining({ content: '2' }))
    expect(maxActiveRequests).toBe(1)
  })
})

async function advanceDebounce() {
  await act(async () => { jest.advanceTimersByTime(400) })
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

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
