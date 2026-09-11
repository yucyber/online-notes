/**
 * 指标 2：协同编辑不丢字 —— 两客户端并发编辑（含同时删除/修改）最终内容是否一致
 *  真实 y-websocket 服务（y-websocket/server.js，端口 1234）+ 两个真实 Yjs 客户端（WebsocketProvider）
 *  场景：S1 双方并发插入 / S2 一方删除区间、另一方在区间内修改 / S3 双方同时删除同一区间 /
 *        S4 高频交叉编辑 / S5 断线重连后是否收敛
 *  判定：收敛（双方最终文本逐字符相等）+ 是否保留了双方各自的操作意图（CRDT 语义下应保留的字符仍在）
 * 说明：y-websocket 为内存态（无 bindState 持久化），本指标只判定「最终内容一致性」，不判定落盘持久性。
 */
import { writeFileSync } from 'node:fs'
import { WebSocket, Y, WebsocketProvider } from './_deps.mjs'

const URL = process.env.YWS_URL || 'ws://127.0.0.1:1234'
const REP = Number(process.env.M2_REP || 3)
const stamp = Date.now()
const out = { metric: 'M2 collaboration consistency', generatedAt: new Date().toISOString(), server: URL, repsPerScenario: REP, trials: [] }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function makeClient(room) {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(URL, room, doc, { WebSocketPolyfill: WebSocket, connect: true })
  return { doc, provider, text: doc.getText('content') }
}
async function synced(c) {
  for (let i = 0; i < 100; i++) { if (c.provider.wsconnected && c.provider.synced) return true; await wait(50) }
  return false
}
/** 等待两客户端文本收敛 */
async function converged(a, b, timeoutMs = 12000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (a.text.toString() === b.text.toString()) return { converged: true, ms: Date.now() - t0 }
    await wait(80)
  }
  return { converged: false, ms: Date.now() - t0 }
}

const scenarios = [
  {
    name: 'S1_both_insert_different_positions',
    desc: '两客户端在不同位置插入不同文本',
    setup: (c) => c.text.insert(0, 'BASE'),
    edit: async (a, b) => { a.text.insert(4, '-A-marker'); b.text.insert(4, '-B-marker') },
    markersA: ['-A-marker'], markersB: ['-B-marker'],
  },
  {
    name: 'S2_one_deletes_range_other_edits_inside',
    desc: 'A 删除 [0,4)，B 在区间内插入',
    setup: (c) => c.text.insert(0, 'HELLO_WORLD'),
    edit: async (a, b) => { a.text.delete(0, 4); b.text.insert(2, 'XX') },
    markersA: [], markersB: ['XX'],
  },
  {
    name: 'S3_both_delete_same_range',
    desc: '两客户端删除同一区间 [0,5)（并发模式下应恰好删除一次，剩 5 个 A）',
    setup: (c) => c.text.insert(0, 'AAAAAAAAAA'),
    edit: async (a, b) => { a.text.delete(0, 5); b.text.delete(0, 5) },
    markersA: [], markersB: [],
  },
  {
    name: 'S4_interleaved_rapid_edits',
    desc: '两客户端各 25 次插入（offline 模式下为真并发）',
    setup: (c) => c.text.insert(0, ''),
    edit: async (a, b) => { for (let i = 0; i < 25; i++) { a.text.insert(a.text.length, `a${i}|`); b.text.insert(0, `b${i}|`) } },
    markersA: ['a0|', 'a24|'], markersB: ['b0|', 'b24|'],
  },
  {
    name: 'S5_reconnect_converges',
    desc: 'A 断线期间本地编辑，B 在线编辑，A 重连后是否收敛',
    setup: (c) => c.text.insert(0, 'START'),
    edit: async (a, b) => { a.provider.disconnect(); await wait(200); b.text.insert(5, '-B-edit'); a.text.insert(0, 'A-edit-'); await wait(200); a.provider.connect(); await wait(600) },
    markersA: ['A-edit-'], markersB: ['-B-edit'],
  },
]

const MODES = ['online', 'concurrent']
for (const mode of MODES) {
  for (const sc of scenarios) {
    for (let rep = 1; rep <= REP; rep++) {
      const room = `metrics-probe-${stamp}-${mode}-${sc.name}-${rep}`
      const A = makeClient(room), B = makeClient(room)
      const rec = { scenario: sc.name, mode, desc: sc.desc, rep, room }
      const okA = await synced(A), okB = await synced(B)
      rec.bothSynced = okA && okB
      sc.setup(A)
      await wait(500)
      rec.textAfterSetup = A.text.toString()
      if (mode === 'concurrent' && sc.name !== 'S5_reconnect_converges') {
        // 真并发：两边先离线，各自本地编辑，再同时上线合并
        A.provider.disconnect(); B.provider.disconnect()
        await wait(200)
      }
      await sc.edit(A, B)
      if (mode === 'concurrent' && sc.name !== 'S5_reconnect_converges') {
        A.provider.connect(); B.provider.connect()
      }
      const cv = await converged(A, B)
      rec.converged = cv.converged
      rec.convergenceMs = cv.ms
      rec.finalTextA = A.text.toString()
      rec.finalTextB = B.text.toString()
      rec.finalEqual = rec.finalTextA === rec.finalTextB
      rec.markerAKept = sc.markersA.map((m) => ({ m, kept: rec.finalTextA.includes(m) }))
      rec.markerBKept = sc.markersB.map((m) => ({ m, kept: rec.finalTextA.includes(m) }))
      rec.aCount = (rec.finalTextA.match(/a\d+\|/g) || []).length
      rec.bCount = (rec.finalTextA.match(/b\d+\|/g) || []).length
      rec.remainingAs = (rec.finalTextA.match(/A/g) || []).length
      rec.thirdClientMatches = null
      const C = makeClient(room); const okC = await synced(C); await wait(600)
      rec.thirdClientSynced = okC
      rec.thirdClientText = C.text.toString()
      rec.thirdClientMatches = rec.thirdClientText === rec.finalTextA
      A.provider.destroy(); B.provider.destroy(); C.provider.destroy()
      A.doc.destroy(); B.doc.destroy(); C.doc.destroy()
      out.trials.push(rec)
      console.log(`[${mode}] ${sc.name} rep${rep}: equal=${rec.finalEqual} ms=${rec.convergenceMs} third=${rec.thirdClientMatches} text="${rec.finalTextA.slice(0, 48)}"`)
      await wait(250)
    }
  }
}

const total = out.trials.length
const eq = out.trials.filter((t) => t.finalEqual).length
const sumBy = (mode) => {
  const ts = out.trials.filter((t) => t.mode === mode)
  return {
    trials: ts.length,
    finalContentEqual: ts.filter((t) => t.finalEqual).length,
    consistencyRate: ts.length ? ts.filter((t) => t.finalEqual).length / ts.length : 0,
    convergedRate: ts.length ? ts.filter((t) => t.converged).length / ts.length : 0,
    thirdClientMatchRate: ts.length ? ts.filter((t) => t.thirdClientMatches).length / ts.length : 0,
    markersAllKept: ts.every((t) => t.markerAKept.every((x) => x.kept) && t.markerBKept.every((x) => x.kept)),
  }
}
out.summary = {
  trials: total,
  finalContentEqual: eq,
  consistencyRate: total ? eq / total : 0,
  byMode: { online: sumBy('online'), concurrent: sumBy('concurrent') },
  byScenario: Object.fromEntries(scenarios.map((sc) => {
    const trials = out.trials.filter((t) => t.scenario === sc.name)
    return [sc.name, {
      trials: trials.length,
      equal: trials.filter((t) => t.finalEqual).length,
      finalText_online: trials.find((t) => t.mode === 'online')?.finalTextA ?? null,
      finalText_concurrent: trials.find((t) => t.mode === 'concurrent')?.finalTextA ?? null,
      aCount_concurrent: trials.find((t) => t.mode === 'concurrent')?.aCount ?? null,
      bCount_concurrent: trials.find((t) => t.mode === 'concurrent')?.bCount ?? null,
      remainingAs_concurrent: trials.find((t) => t.mode === 'concurrent')?.remainingAs ?? null,
    }]
  })),
}
writeFileSync('docs/metrics/raw/m2-collab-consistency.json', JSON.stringify(out, null, 2))
console.log('SUMMARY:', JSON.stringify(out.summary, null, 2))
