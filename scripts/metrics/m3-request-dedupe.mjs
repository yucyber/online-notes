/**
 * 指标 3：不重复生成 —— 同一 (userId, requestId) 并发请求 / 网络重放时，最终 assistant 消息条数是否恒为 1
 *  A) DB 层并发：20 个并发 insert 同一 (userId, requestId, role=user)，验证真实唯一部分索引 idx_assistant_msg_user_request
 *  B) HTTP 层并发：5 个并发 POST /api/assistant/chat 同一 requestId → user/assistant 消息条数
 *  C) 完成后重放：同 requestId 再请求 → 是否 0 新增行 + 收到终态
 */
import { writeFileSync } from 'node:fs'
import { MongoClient, dotenv } from './_deps.mjs'
import { pickUser, mintToken, API, DB } from './_auth.mjs'
dotenv.config({ path: 'notes-backend/.env' })
const { Types } = (await import('node:module')).createRequire(new URL('../../notes-backend/package.json', import.meta.url))('mongoose')

const { user, close } = await pickUser()
const token = mintToken(user)
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
const stamp = Date.now()
const out = { metric: 'M3 request dedupe', generatedAt: new Date().toISOString(), user: { id: String(user._id), email: user.email }, scenarios: {} }

const client = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
const messages = client.db(DB).collection('assistant_messages')
const conversations = client.db(DB).collection('assistant_conversations')
const countByReq = (rid) => messages.countDocuments({ requestId: rid })

// ---------- A) DB 层并发插入同一 (userId, requestId, role=user) ----------
const ridA = `probe-dedupe-db-${stamp}`
const attempts = 20
const results = await Promise.all(Array.from({ length: attempts }, async (_, i) => {
  try {
    await messages.insertOne({
      conversationId: new Types.ObjectId(), userId: user._id, seq: 1, role: 'user', route: 'pet',
      content: `probe ${i}`, status: 'completed', requestId: ridA, citations: [], warnings: [],
      createdAt: new Date(), updatedAt: new Date(),
    })
    return { ok: true }
  } catch (e) { return { ok: false, code: e.code, msg: String(e.message).slice(0, 60) } }
}))
const rowsA = await countByReq(ridA)
out.scenarios.A_db_concurrent_insert = {
  description: '20 个并发 insert 同一 (userId, requestId, role=user)，各自独立 conversationId（隔离 conv+seq 唯一索引）',
  attempts, inserted: results.filter((r) => r.ok).length,
  duplicateKeyErrors: results.filter((r) => !r.ok && r.code === 11000).length,
  otherErrors: results.filter((r) => !r.ok && r.code !== 11000).map((r) => r.msg),
  rowsInDbAfter: rowsA,
  uniqueIndex: 'idx_assistant_msg_user_request (partial: requestId is string AND role=user)',
}
await messages.deleteMany({ requestId: ridA })

// ---------- B) HTTP 层：5 并发同一 requestId ----------
const ridB = `probe-dedupe-http-${stamp}`
const t0 = Date.now()
const chat = async (rid, question) => {
  const r = await fetch(`${API}/assistant/chat`, { method: 'POST', headers: H, body: JSON.stringify({ requestId: rid, question, forceRoute: 'pet' }) })
  const text = await r.text()
  const events = [...text.matchAll(/event: ([a-z]+)/g)].map((m) => m[1])
  const started = /event: started\ndata: (.+)/.exec(text)
  const complete = /event: complete\ndata: (.+)/.exec(text)
  return { status: r.status, events, started: started ? JSON.parse(started[1]) : null, complete: complete ? JSON.parse(complete[1]) : null }
}
const [warm, ...concurrent] = await Promise.all([
  chat(ridB, '用一句话说明什么是笔记'), chat(ridB, '用一句话说明什么是笔记'), chat(ridB, '用一句话说明什么是笔记'),
  chat(ridB, '用一句话说明什么是笔记'), chat(ridB, '用一句话说明什么是笔记'),
])
const all = [warm, ...concurrent]
const rowsB = await countByReq(ridB)
const userRows = await messages.countDocuments({ requestId: ridB, role: 'user' })
const assistantRows = await messages.countDocuments({ requestId: ridB, role: 'assistant' })
const convIds = [...new Set(all.map((r) => r.started?.conversationId).filter(Boolean))]
out.scenarios.B_http_concurrent_same_requestId = {
  description: '5 个并发 POST /api/assistant/chat（同一 requestId，pet 路由）',
  elapsedMs: Date.now() - t0,
  httpStatuses: all.map((r) => r.status),
  eventSequences: all.map((r) => r.events.join('>')),
  distinctConversationIds: convIds, distinctConversations: convIds.length,
  distinctAssistantMessageIds: [...new Set(all.map((r) => r.started?.assistantMessageId).filter(Boolean))],
  rowsTotal: rowsB, userRows, assistantRows,
  expected: { userRows: 1, assistantRows: 1 },
}

// ---------- C) 完成后重放 ----------
const beforeC = { total: await countByReq(ridB), user: userRows, assistant: assistantRows }
const replay = await chat(ridB, '用一句话说明什么是笔记')
const afterC = { total: await countByReq(ridB) }
const convIdB = convIds[0]
out.scenarios.C_replay_after_complete = {
  description: '生成已完成后，用同一 requestId 重放',
  httpStatus: replay.status, eventSequence: replay.events.join('>'),
  terminalReemitted: replay.events.includes('complete'),
  rowsBefore: beforeC, rowsAfter: afterC, rowsAdded: afterC.total - beforeC.total,
}

// ---------- 清理：删除探针消息与会话 ----------
const delMsgs = await messages.deleteMany({ requestId: { $in: [ridA, ridB] } })
let convDeleted = null
if (convIdB) { const r = await fetch(`${API}/assistant/conversations/${convIdB}/delete`, { method: 'POST', headers: H }); convDeleted = r.status }
const remaining = await countByReq(ridB)
const convStill = convIdB ? await conversations.countDocuments({ _id: new Types.ObjectId(convIdB) }) : null
out.cleanup = { messagesDeleted: delMsgs.deletedCount, conversationDeleteHttpStatus: convDeleted, remainingRowsForRidB: remaining, conversationDocRemaining: convStill }
writeFileSync('docs/metrics/raw/m3-request-dedupe.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
await client.close(); await close()
