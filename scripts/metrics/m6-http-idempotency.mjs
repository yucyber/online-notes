/**
 * 指标 6：HTTP 幂等（全局 IdempotencyInterceptor + 真实 Redis + 真实 Mongo）
 *  S1 并发重放：同一 Idempotency-Key + 同一 payload，10 并发 → 落库次数是否为 1
 *  S2 顺序重放：首请求完成后再重放同 key/payload → 是否命中缓存（X-Idempotency-Applied）
 *  S3 同 key 不同 payload → 是否 409
 * 副作用：会创建 1 条 marker 笔记，脚本结束时删除；并清理 idempotency:* Redis 键。
 */
import { writeFileSync } from 'node:fs'
import { MongoClient, Redis, dotenv } from './_deps.mjs'
import { pickUser, mintToken, API, DB } from './_auth.mjs'
dotenv.config({ path: 'notes-backend/.env' })

const { user, close } = await pickUser()
const token = mintToken(user)
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
const stamp = Date.now()
const marker = `__metrics_probe_${stamp}__`
const out = { metric: 'M6 HTTP idempotency', generatedAt: new Date().toISOString(), user: { id: String(user._id), email: user.email }, marker, scenarios: {} }

const client = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
const notesCol = client.db(DB).collection('notes')
const redis = new Redis(process.env.REDIS_URL)

const countRows = () => notesCol.countDocuments({ title: marker })
const post = async (key, payload) => {
  const r = await fetch(`${API}/notes`, { method: 'POST', headers: { ...H, 'Idempotency-Key': key }, body: JSON.stringify(payload) })
  let body = null; try { body = await r.json() } catch {}
  return { status: r.status, applied: r.headers.get('x-idempotency-applied'), message: body?.message, code: body?.code, id: body?.data?.id ?? body?.data?._id }
}

// ---------- S1: 10 并发同 key 同 payload ----------
const key1 = `probe-idem-${stamp}-a`
const payload1 = { title: marker, content: 'metrics probe idempotency', tags: [] }
const before1 = await countRows()
const results1 = await Promise.all(Array.from({ length: 10 }, () => post(key1, payload1)))
const after1 = await countRows()
out.scenarios.S1_concurrent_same_key_same_payload = {
  description: '同一 Idempotency-Key + 同一 payload，10 个并发 POST /api/notes',
  key: key1, requestsSent: 10, rowsBefore: before1, rowsAfter: after1,
  rowsCreated: after1 - before1,
  statusDistribution: results1.reduce((a, r) => { const k = `HTTP ${r.status}${r.message ? `/${r.message}` : ''}`; a[k] = (a[k] || 0) + 1; return a }, {}),
  idempotencyAppliedHeader: results1.map((r) => r.applied),
  distinctCreatedIds: [...new Set(results1.map((r) => r.id).filter(Boolean))],
}

// ---------- S2: 顺序重放 ----------
const before2 = await countRows()
const replay = await post(key1, payload1)
const after2 = await countRows()
out.scenarios.S2_sequential_replay = {
  description: '首请求完成后再以同 key/同 payload 重放一次',
  status: replay.status, idempotencyAppliedHeader: replay.applied,
  rowsBefore: before2, rowsAfter: after2, rowsCreated: after2 - before2,
  replayReturnedSameId: Boolean(replay.id) && String(replay.id) === String(results1.map((r) => r.id).find(Boolean)),
}
const redisKey1 = await redis.keys(`idempotency:*:${key1}*`)
out.scenarios.S2_sequential_replay.redisKeys = redisKey1
out.scenarios.S2_sequential_replay.redisValue = redisKey1.length ? await redis.get(redisKey1.find((k) => k.endsWith(':result'))) : null

// ---------- S3: 同 key 不同 payload ----------
const key3 = `probe-idem-${stamp}-b`
const first3 = await post(key3, { title: marker, content: 'first payload', tags: [] })
const conflict = await post(key3, { title: marker, content: 'DIFFERENT payload', tags: [] })
const rowsAfter3 = await countRows()
out.scenarios.S3_same_key_different_payload = {
  description: '同一 key 先成功后换 payload 重放',
  firstStatus: first3.status, conflictStatus: conflict.status, conflictMessage: conflict.message,
  rowsAfter: rowsAfter3,
  expected409: conflict.status === 409,
}

// ---------- 清理 ----------
const created = await notesCol.find({ title: marker }).project({ _id: 1 }).toArray()
const deleted = []
for (const n of created) {
  const r = await fetch(`${API}/notes/${n._id}`, { method: 'DELETE', headers: H })
  deleted.push({ id: String(n._id), status: r.status })
}
const keysToClean = (await redis.keys('idempotency:*')).filter((k) => k.includes(stamp) || k.includes('probe-idem'))
for (const k of keysToClean) await redis.del(k)
out.cleanup = { createdRowsFound: created.length, deleted, remainingRows: await countRows(), redisKeysDeleted: keysToClean.length }
writeFileSync('docs/metrics/raw/m6-http-idempotency.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
await redis.quit(); await client.close(); await close()
