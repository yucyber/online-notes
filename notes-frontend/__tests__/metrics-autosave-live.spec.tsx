/**
 * 指标 1（实测路径）：在线编辑器真实自动保存链路不丢稿
 * 被测单元：src/components/editor/useEditorAutoSave.ts（NoteEditorShell 实际使用的 hook，delayMs=400）
 * 场景：刷新/重挂、断网、卸载重挂（含慢写）、连续快速编辑、去重
 * 证据：docs/metrics/raw/m1b-autosave-live-jest.json
 */
import { renderHook, act } from '@testing-library/react'
import { writeFileSync, mkdirSync } from 'node:fs'
import { useEditorAutoSave } from '@/components/editor/useEditorAutoSave'
import type { EditorSnapshot } from '@/components/editor/editor-save-types'

jest.mock('@/lib/app-toast', () => ({
  appToast: { error: jest.fn(), dismiss: jest.fn(), success: jest.fn() },
}))

const setOnline = (v: boolean) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: v })
const snap = (content: string, title = '标题'): EditorSnapshot => ({ title, content, tags: [] })
const records: any[] = []
const rec = (r: any) => { records.push(r); return r }

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }
const advance = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve() }) }

/** 可手动控制完成时机的 save */
function deferredSave() {
  const calls: EditorSnapshot[] = []
  const resolvers: Array<() => void> = []
  let inFlight = 0
  let maxConcurrent = 0
  const save = jest.fn((s: EditorSnapshot) => {
    calls.push(s)
    inFlight += 1
    maxConcurrent = Math.max(maxConcurrent, inFlight)
    return new Promise<void>((resolve) => {
      resolvers.push(() => { inFlight -= 1; resolve() })
    })
  })
  return { save, calls, resolvers, stats: () => ({ inFlight, maxConcurrent }) }
}

function mount(noteId: string, snapshot: EditorSnapshot, save: any, delayMs = 400, enabled = true) {
  return renderHook(
    (p: { snapshot: EditorSnapshot; enabled: boolean }) => useEditorAutoSave({ noteId, snapshot: p.snapshot, enabled: p.enabled, save, delayMs }),
    { initialProps: { snapshot, enabled } },
  )
}

beforeEach(() => { setOnline(true); jest.useFakeTimers() })
afterEach(() => { jest.useRealTimers() })

afterAll(() => {
  mkdirSync('../docs/metrics/raw', { recursive: true })
  const loss = records.filter((r) => r.lost)
  writeFileSync('../docs/metrics/raw/m1b-autosave-live-jest.json', JSON.stringify({
    metric: 'M1b autosave durability on the LIVE editor path (useEditorAutoSave)',
    generatedAt: new Date().toISOString(),
    unit: 'notes-frontend/src/components/editor/useEditorAutoSave.ts',
    wiredIn: 'NoteEditorShell.tsx:527 (delayMs=400)',
    scenarios: records.length, lossEvents: loss.length, lossRate: records.length ? loss.length / records.length : 0,
    records,
  }, null, 2))
})

// 说明：hook 在挂载时把「初始快照」视为已落库基线（lastSavedKey），因此每次测试都先以服务端内容挂载，再 rerender 成编辑后内容来触发自动保存。
describe('指标1（实测路径）：useEditorAutoSave 不丢稿', () => {
  it('L1 刷新/重挂：编辑后 400ms 防抖落库，服务端拿到最终内容', async () => {
    const { save, calls, resolvers } = deferredSave()
    const v = mount('note-l1', snap('服务端原有内容'), save)
    await flush()
    await act(async () => { v.rerender({ snapshot: snap('第一版编辑内容'), enabled: true }) })
    await advance(400)
    expect(calls.length).toBe(1)
    await act(async () => { resolvers.forEach((r) => r()) })
    await flush()
    const saved = calls[calls.length - 1]
    v.unmount()
    // 模拟刷新：以「服务端已保存的内容」重挂
    const v2 = mount('note-l1', saved, save)
    await flush()
    await advance(400)
    rec({ scenario: 'L1_reload', saveCalls: calls.length, lastSavedContent: saved.content, remountAdditionalWrite: calls.length > 1, lost: saved.content !== '第一版编辑内容', lossChars: saved.content === '第一版编辑内容' ? 0 : 4 })
    expect(saved.content).toBe('第一版编辑内容')
    v2.unmount()
  })

  it('L2 断网：离线不写入、状态 local 且保留待写快照；恢复网络后自动补写', async () => {
    const { save, calls, resolvers } = deferredSave()
    setOnline(false)
    const v = mount('note-l2', snap('s0'), save)
    await flush()
    await act(async () => { v.rerender({ snapshot: snap('离线时写的内容'), enabled: true }) })
    await advance(400)
    const offState = v.result.current.state
    const callsWhileOffline = calls.length
    setOnline(true)
    await act(async () => { window.dispatchEvent(new Event('online')); await Promise.resolve() })
    await flush()
    await act(async () => { resolvers.forEach((r) => r()) })
    await flush()
    const wrote = calls.find((c) => c.content === '离线时写的内容')
    rec({
      scenario: 'L2_offline', stateWhileOffline: offState, callsWhileOffline,
      retriedOnOnline: Boolean(wrote), totalCalls: calls.length, finalSavedContent: wrote?.content ?? null,
      lost: !wrote, lossChars: wrote ? 0 : '离线时写的内容'.length,
    })
    expect(offState).toBe('local')
    expect(wrote).toBeTruthy()
    v.unmount()
  })

  it('L3 卸载重挂（慢写）：写未完成时卸载重挂，物理写仍串行且不丢最后一次编辑', async () => {
    const { save, calls, resolvers, stats } = deferredSave()
    const v = mount('note-l3', snap('s0'), save)
    await flush()
    await act(async () => { v.rerender({ snapshot: snap('v1'), enabled: true }) })
    await advance(400)
    expect(calls.length).toBe(1)      // 第一次写在途（未 resolve）
    v.unmount()                       // 写在途时卸载
    const v2 = mount('note-l3', snap('v1'), save)
    await flush()
    await act(async () => { v2.rerender({ snapshot: snap('v2-最后编辑'), enabled: true }) })
    await advance(400)
    await act(async () => { resolvers.forEach((r) => r()) })
    await flush()
    await act(async () => { resolvers.forEach((r) => r()) })
    await flush()
    const last = calls[calls.length - 1]
    rec({
      scenario: 'L3_unmount_remount_slow_write', totalSaveCalls: calls.length,
      savedOrder: calls.map((c) => c.content), maxConcurrentWrites: stats().maxConcurrent,
      lastSavedContent: last?.content ?? null,
      lost: last?.content !== 'v2-最后编辑', lossChars: last?.content === 'v2-最后编辑' ? 0 : 6,
    })
    expect(stats().maxConcurrent).toBe(1)
    expect(last.content).toBe('v2-最后编辑')
    v2.unmount()
  })

  it('L4 连续快速编辑：20 次连改只写最后一次，中间内容不覆盖最终内容', async () => {
    const { save, calls, resolvers } = deferredSave()
    const v = mount('note-l4', snap('c0'), save)
    await flush()
    let final = 'c0'
    for (let i = 1; i <= 20; i++) {
      final = `c${i}`
      await act(async () => { v.rerender({ snapshot: snap(final), enabled: true }) })
      await advance(100)              // 100ms < 400ms 防抖
    }
    await advance(400)
    await act(async () => { resolvers.forEach((r) => r()) })
    await flush()
    const last = calls[calls.length - 1]
    rec({
      scenario: 'L4_rapid_edits', edits: 20, saveCalls: calls.length,
      lastSavedContent: last?.content ?? null, expectedFinal: final,
      lost: last?.content !== final, lossChars: last?.content === final ? 0 : final.length,
    })
    expect(last.content).toBe(final)
    v.unmount()
  })

  it('L5 去重：同一快照不重复写；A→B→A 的末次 A 不会被吞', async () => {
    const { save, calls, resolvers } = deferredSave()
    const v = mount('note-l5', snap('A0'), save)
    await flush()
    await act(async () => { v.rerender({ snapshot: snap('A'), enabled: true }) })
    await advance(400)
    await act(async () => { resolvers.forEach((r) => r()) })
    await flush()
    const afterA = calls.length
    await act(async () => { v.rerender({ snapshot: snap('A'), enabled: true }) })
    await advance(400)
    const afterDuplicate = calls.length
    await act(async () => { v.rerender({ snapshot: snap('B'), enabled: true }) })
    await advance(100)
    await act(async () => { v.rerender({ snapshot: snap('A'), enabled: true }) })
    await advance(400)
    await act(async () => { resolvers.forEach((r) => r()) })
    await flush()
    await act(async () => { resolvers.forEach((r) => r()) })
    await flush()
    const last = calls[calls.length - 1]
    rec({
      scenario: 'L5_dedupe_ABA', callsAfterFirstA: afterA, callsAfterDuplicateSameSnapshot: afterDuplicate,
      duplicateWrite: afterDuplicate > afterA, totalCalls: calls.length,
      savedOrder: calls.map((c) => c.content), lastSavedContent: last?.content ?? null,
      abaLastSavedIsA: last?.content === 'A', lost: last?.content !== 'A', lossChars: last?.content === 'A' ? 0 : 1,
    })
    expect(afterDuplicate).toBe(afterA)
    expect(last.content).toBe('A')
    v.unmount()
  })
})
