/**
 * 指标 4 的边界探针：重放（reconnect/replay）时补发的终态事件是否与消息真实状态一致
 *  1) 突发并发触发提供商容量失败（environment failure）
 *  2) 记录首次流的事件序列 + DB 中该 assistant 消息的 status
 *  3) 重放同一 requestId，记录补发的终态事件
 * 结论用于核对「以 complete/cancelled 正常收尾」的口径。
 */
import { writeFileSync } from 'node:fs'
import { MongoClient, dotenv } from './_deps.mjs'
import { pickUser, mintToken, API, DB } from './_auth.mjs'
dotenv.config({ path: 'notes-backend/.env' })
const { Types } = (await import('node:module')).createRequire(new URL('../../notes-backend/package.json', import.meta.url))('mongoose')

const BURST = Number(process.env.M4B_BURST || 12)
const { user, close } = await pickUser()
const token = mintToken(user)
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
const stamp = Date.now()
const out = { metric: 'M4b terminal event semantics on replay', generatedAt: new Date().toISOString(), burst: BURST, rows: [] }

const client = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
const messages = client.db(DB).collection('assistant_messages')

async function stream(rid, question) {
  const r = await fetch(`${API}/assistant/chat`, { method: 'POST', headers: H, body: JSON.stringify({ requestId: rid, question, forceRoute: 'pet' }) })
  const text = await r.text()
  const events = [...text.matchAll(/event: ([a-z]+)/g)].map((m) => m[1])
  const err = /event: error\ndata: (.+)/.exec(text)
  const complete = /event: complete\ndata: (.+)/.exec(text)
  return { status: r.status, events, error: err ? JSON.parse(err[1]) : null, complete: complete ? JSON.parse(complete[1]) : null }
}

const rids = Array.from({ length: BURST }, (_, i) => `probe-terminal-${stamp}-${i}`)
const firsts = await Promise.all(rids.map((rid) => stream(rid, '用一句话说明什么是笔记').catch((e) => ({ error: String(e.message) }))))

for (let i = 0; i < rids.length; i++) {
  const rid = rids[i]
  const first = firsts[i]
  const doc = await messages.findOne({ requestId: rid, role: 'assistant' }, { sort: { seq: -1 } })
  const userDoc = await messages.findOne({ requestId: rid, role: 'user' })
  const replay = await stream(rid, '用一句话说明什么是笔记')
  out.rows.push({
    requestId: rid,
    firstRunEvents: (first.events || []).join('>'),
    firstRunTerminal: (first.events || []).filter((e) => ['complete', 'cancelled', 'error'].includes(e)).pop() ?? null,
    firstRunErrorPayload: first.error ?? null,
    dbAssistantStatus: doc?.status ?? null,
    dbAssistantContentLength: (doc?.content ?? '').length,
    dbHasUserMessage: Boolean(userDoc),
    replayEvents: replay.events.join('>'),
    replayTerminal: replay.events.filter((e) => ['complete', 'cancelled', 'error'].includes(e)).pop() ?? null,
  })
}
const mismatches = out.rows.filter((r) => r.dbAssistantStatus === 'failed' && r.replayTerminal === 'complete')
out.summary = {
  total: out.rows.length,
  firstRunFailed: out.rows.filter((r) => r.dbAssistantStatus === 'failed').length,
  firstRunCompleted: out.rows.filter((r) => r.dbAssistantStatus === 'completed').length,
  failedButReplayEmitsComplete: mismatches.length,
  finding: mismatches.length
    ? 'DB 中 status=failed 的 assistant 消息，重放时 SSE 补发的是 complete（而非 error）——重放终态与真实消息状态不一致'
    : '未观察到不一致',
  note: 'firstRunTerminal 为 error 时 DB status 应为 failed；重放是否如实体现在 replayTerminal',
}

// 清理
const allMsgs = await messages.find({ requestId: { $in: rids } }).project({ conversationId: 1 }).toArray()
const convIds = [...new Set(allMsgs.map((m) => String(m.conversationId)))]
const dm = await messages.deleteMany({ requestId: { $in: rids } })
const dc = await client.db(DB).collection('assistant_conversations').deleteMany({ _id: { $in: convIds.map((c) => new Types.ObjectId(c)) } })
out.cleanup = { messagesDeleted: dm.deletedCount, conversationsDeleted: dc.deletedCount }

writeFileSync('docs/metrics/raw/m4b-terminal-semantics.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out.summary, null, 2))
for (const r of out.rows) console.log(`${r.requestId.slice(-6)} | first=${r.firstRunTerminal} | db=${r.dbAssistantStatus} | replay=${r.replayTerminal} | dbContentLen=${r.dbAssistantContentLength}`)
await client.close(); await close()
