/**
 * 指标 4：SSE 续接成功率
 *  S1：生成中刷新 N 次 —— 收到首个 delta 后立刻 abort（模拟 F5），随即用同一 requestId 重连，
 *      判定成功 = 收到 resume 事件（含非空快照）且最终收到终态事件（complete/cancelled/error）
 *  S2：生成已完成后重连 —— 是否补发终态（terminalEvents / 重放路径）
 * 真实 AI 生成（pet 路由）+ 真实 HTTP + 真实 DB
 */
import { writeFileSync } from 'node:fs'
import { MongoClient, dotenv } from './_deps.mjs'
import { pickUser, mintToken, API, DB } from './_auth.mjs'
dotenv.config({ path: 'notes-backend/.env' })
const { Types } = (await import('node:module')).createRequire(new URL('../../notes-backend/package.json', import.meta.url))('mongoose')

const N = Number(process.env.M4_N || 6)
const PACE_MS = Number(process.env.M4_PACE_MS || 12000)
const MAX_ATTEMPTS = Number(process.env.M4_MAX_ATTEMPTS || 4)
const { user, close } = await pickUser()
const token = mintToken(user)
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
const stamp = Date.now()
const out = { metric: 'M4 SSE resume success rate', generatedAt: new Date().toISOString(), params: { iterations: N, route: 'pet', paceMs: PACE_MS, maxAttemptsPerIteration: MAX_ATTEMPTS }, iterations: [], environmentFailures: [] }

const QUESTION = '请分三点说明如何整理个人知识笔记，每点写 80 字左右。'

/** 读取 SSE 流；onEvent 返回 'abort' 时中断连接 */
async function readStream(rid, question, { abortAfterFirstDelta = false, timeoutMs = 60000 } = {}) {
  const ac = new AbortController()
  const t0 = Date.now()
  const events = []
  let aborted = false
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${API}/assistant/chat`, { method: 'POST', headers: H, body: JSON.stringify({ requestId: rid, question, forceRoute: 'pet' }), signal: ac.signal })
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n\n'); buf = parts.pop() ?? ''
      for (const p of parts) {
        const ev = /event: ([a-z]+)/.exec(p)?.[1]
        const dataRaw = /data: (.+)/.exec(p)?.[1]
        if (!ev) continue
        let data = null; try { data = JSON.parse(dataRaw) } catch {}
        events.push({ ev, tMs: Date.now() - t0, data })
        if (abortAfterFirstDelta && ev === 'delta') { aborted = true; ac.abort(); throw Object.assign(new Error('client-abort'), { __abort: true, events }) }
      }
    }
    clearTimeout(timer)
    return { events, aborted: false, ms: Date.now() - t0 }
  } catch (e) {
    clearTimeout(timer)
    if (e.__abort) return { events: e.events, aborted: true, ms: Date.now() - t0 }
    return { events, aborted, ms: Date.now() - t0, error: String(e.message || e) }
  }
}

// ---------- S1 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 1; i <= N; i++) {
  if (i > 1) await sleep(PACE_MS) // 提供商限流（SILICONFLOW_AI_RPM=30 / TPM）：迭代间留出容量窗口
  let rec = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const rid = `probe-resume-${stamp}-${i}-${attempt}`
    const first = await readStream(rid, QUESTION, { abortAfterFirstDelta: true })
    rec = { i, attempt, requestId: rid }
    rec.phase1 = { abortedAfterFirstDelta: first.aborted, deltasReceived: first.events.filter((e) => e.ev === 'delta').length, ms: first.ms, error: first.error, eventSequence: first.events.map((e) => e.ev).join('>') }
    if (rec.phase1.deltasReceived === 0) {
      // 未拿到任何 delta：生成在首个 token 前就结束了 —— 环境性失败（容量/限流），本次不计入指标
      const reconnect = await readStream(rid, QUESTION)
      out.environmentFailures.push({ iteration: i, attempt, requestId: rid, phase1Events: rec.phase1.eventSequence, reconnectEvents: reconnect.events.map((e) => e.ev).join('>'), reason: 'no_delta_before_terminal (provider capacity/rate limit)' })
      await sleep(30000)
      continue
    }
    const reconnectStart = Date.now()
    const second = await readStream(rid, QUESTION)
    rec.phase2 = { ms: Date.now() - reconnectStart, eventSequence: second.events.map((e) => e.ev).join('>'), error: second.error }
    const resume = second.events.find((e) => e.ev === 'resume')
    rec.resumeReceived = Boolean(resume)
    rec.resumeContentLength = resume?.data?.content?.length ?? 0
    rec.resumeHasNonEmptySnapshot = rec.resumeContentLength > 0
    rec.terminalReceived = second.events.some((e) => ['complete', 'cancelled', 'error'].includes(e.ev))
    rec.terminalEvent = second.events.filter((e) => ['complete', 'cancelled', 'error'].includes(e.ev)).map((e) => e.ev)[0] ?? null
    rec.deltasAfterResume = second.events.slice(second.events.findIndex((e) => e.ev === 'resume') + 1).filter((e) => e.ev === 'delta').length
    rec.success = rec.resumeReceived && rec.resumeHasNonEmptySnapshot && rec.terminalReceived
    break
  }
  out.iterations.push(rec)
  console.log(`iter ${i} (attempt ${rec.attempt}): resume=${rec.resumeReceived} snapLen=${rec.resumeContentLength} deltasAfter=${rec.deltasAfterResume} terminal=${rec.terminalEvent} success=${rec.success}`)
}
const succ = out.iterations.filter((r) => r.success).length
out.summary_S1 = {
  iterations: N, success: succ, failed: N - succ, successRate: succ / N,
  resumeReceivedAll: out.iterations.every((r) => r.resumeReceived),
  terminalReceivedAll: out.iterations.every((r) => r.terminalReceived),
  avgReconnectMs: Math.round(out.iterations.reduce((a, r) => a + r.phase2.ms, 0) / N),
}

// ---------- S2：完成后重连 ----------
const rid2 = `probe-resume-after-${stamp}`
const full = await readStream(rid2, '用一句话回答：1+1=?')
const reconnected = await readStream(rid2, '用一句话回答：1+1=?')
out.scenario_S2_reconnect_after_complete = {
  description: '生成已完成后用同一 requestId 重连',
  firstRunEvents: full.events.map((e) => e.ev).join('>'),
  reconnectEvents: reconnected.events.map((e) => e.ev).join('>'),
  terminalReemittedOnReconnect: reconnected.events.some((e) => ['complete', 'cancelled', 'error'].includes(e.ev)),
  resumeEmitted: reconnected.events.some((e) => e.ev === 'resume'),
}

// ---------- 清理 ----------
const client = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
const rids = out.iterations.map((r) => r.requestId).concat([rid2])
const msgs = await client.db(DB).collection('assistant_messages').find({ requestId: { $in: rids } }).project({ conversationId: 1 }).toArray()
const convIds = [...new Set(msgs.map((m) => String(m.conversationId)))]
const dm = await client.db(DB).collection('assistant_messages').deleteMany({ requestId: { $in: rids } })
const dc = await client.db(DB).collection('assistant_conversations').deleteMany({ _id: { $in: convIds.map((c) => new Types.ObjectId(c)) } })
out.cleanup = { requestIds: rids.length, conversationsFound: convIds.length, messagesDeleted: dm.deletedCount, conversationsDeleted: dc.deletedCount }
writeFileSync('docs/metrics/raw/m4-sse-resume.json', JSON.stringify(out, null, 2))
console.log('SUMMARY S1:', JSON.stringify(out.summary_S1))
console.log('S2:', JSON.stringify(out.scenario_S2_reconnect_after_complete))
console.log('cleanup:', JSON.stringify(out.cleanup))
await client.close(); await close()
