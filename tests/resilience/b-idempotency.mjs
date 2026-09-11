// B. 接口幂等：并发重放 / 同 key 异 payload / 有-无拦截器对比
//
// Part 1（受控 A/B，进程内）：直接加载真实 IdempotencyInterceptor（dist 产物）+ 真实 Redis + 真实 Mongo，
//   对照组用「空拦截器（next.handle() 直通）」模拟"无幂等保护"，其余完全相同 → 唯一变量是拦截器。
// Part 2（端到端）：对真实后端 3001 发并发/重放请求，验证线上链路行为一致。
//
// 关键观测：实际落库条数（Mongo countDocuments）、X-Idempotency-Applied 响应头分布、HTTP 状态码分布。
import {
  mongoose, Redis, env, createReport, sleep, httpJson, pickUserAndToken, API, DB,
  loadBackendDist, loadBackendDep,
} from './_lib.mjs'

const PROBE_COLL = 'zz_resilience_idem_probe'
const PROBE_ENDPOINT = '/api/zz-resilience-idempotency-probe'
const PROBE_USER = 'zz-resilience-user' // 合成 userId，保证 Redis 键可精确清理
const STAMP = Date.now()

const report = createReport('B · 接口幂等（并发重放 / 异 payload / 有-无拦截器）', {
  interceptor: 'dist/common/interceptors/idempotency.interceptor.js',
  probeEndpoint: PROBE_ENDPOINT,
  probeCollection: PROBE_COLL,
  redis: env('REDIS_URL'),
})

// ---------- Part 1 基础设施 ----------
await mongoose.connect(env('MONGODB_URI'), { serverSelectionTimeoutMS: 20000 })
const redis = new Redis(env('REDIS_URL'))

const probeSchema = new mongoose.Schema({
  marker: { type: String, required: true, index: true },
  payload: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}, { collection: PROBE_COLL })
const ProbeModel = mongoose.model('ZZResilienceIdemProbe', probeSchema)

const { IdempotencyInterceptor } = loadBackendDist('common/interceptors/idempotency.interceptor.js')
const { defer, firstValueFrom } = loadBackendDep('rxjs')

const interceptor = new IdempotencyInterceptor(redis)
// "无拦截器"对照组：与真实拦截器同签名，但直接透传
const noInterceptor = { intercept: (_ctx, next) => next.handle() }

function makeFakeHttp({ key, body, method = 'POST', userId = PROBE_USER }) {
  const headers = {}
  if (key) headers['idempotency-key'] = key
  const req = {
    method,
    headers,
    body,
    params: {},
    query: {},
    route: { path: PROBE_ENDPOINT },
    originalUrl: PROBE_ENDPOINT,
    url: PROBE_ENDPOINT,
    user: { id: userId },
  }
  const resHeaders = {}
  let statusCode = 200
  const res = {
    setHeader: (k, v) => { resHeaders[k.toLowerCase()] = v },
    getHeader: (k) => resHeaders[k.toLowerCase()],
    removeHeader: () => {},
    status(code) { statusCode = code; return res },
    get statusCode() { return statusCode },
    set statusCode(code) { statusCode = code },
  }
  const ctx = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) }
  return { ctx, res, resHeaders }
}

let markerSeq = 0
function makeHandler({ delayMs = 0, marker }) {
  return {
    handle: () => defer(() => {
      const promise = (async () => {
        if (delayMs) await sleep(delayMs)
        const doc = await ProbeModel.create({ marker, payload: 'p' })
        return { id: String(doc._id) }
      })()
      pendingWrites.push(promise)
      return promise
    }),
  }
}

let pendingWrites = []

async function countRows(marker) {
  return ProbeModel.countDocuments({ marker }).exec()
}

// 一次请求 = 走拦截器 + 消费 Observable；返回响应头/状态/结果
async function runRequest({ impl, key, payload, delayMs, marker }) {
  const { ctx, res, resHeaders } = makeFakeHttp({ key, body: payload })
  const handler = makeHandler({ delayMs, marker })
  let status = 200
  let result = null
  let error = null
  try {
    const observable = await impl.intercept(ctx, handler)
    result = await firstValueFrom(observable)
    status = res.statusCode
  } catch (e) {
    error = { name: e?.name, status: e?.status ?? e?.getStatus?.(), message: String(e?.message || e).slice(0, 200) }
    status = error.status || 500
  }
  return {
    status,
    applied: resHeaders['x-idempotency-applied'] ?? null,
    // 首次写入返回业务体；重放命中缓存时返回的是响应信封，id 位于 data 中
    id: (result && (result.id ?? result.data?.id)) || undefined,
    error,
  }
}

async function clearRedisProbe() {
  const keys = await redis.keys(`idempotency:${PROBE_USER}:*`)
  if (keys.length) await redis.del(...keys)
  return keys.length
}

report.part1 = { scenarios: [] }

function summarize(results) {
  const distribution = results.reduce((acc, r) => {
    const k = `HTTP ${r.status}${r.error?.message ? `/${r.error.message}` : ''}`
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})
  return {
    statusDistribution: distribution,
    idempotencyAppliedHeaders: results.map((r) => r.applied),
    distinctReturnedIds: [...new Set(results.map((r) => r.id).filter(Boolean))],
  }
}

async function part1Scenario({ id, label, impl, implName, key, payload, delayMs, rowsBefore, expect }) {
  const marker = `zzidem-${STAMP}-${id}-${++markerSeq}`
  const results = await Promise.all(Array.from({ length: 10 }, () => runRequest({ impl, key, payload, delayMs, marker })))
  await Promise.allSettled(pendingWrites)
  pendingWrites = []
  await sleep(120)
  const rowsAfter = await countRows(marker)
  const entry = {
    id, label, impl: implName, key, concurrency: 10, handlerDelayMs: delayMs || 0,
    rowsBefore, rowsAfter, rowsCreated: rowsAfter - rowsBefore,
    ...summarize(results),
    ...(expect ? { expect } : {}),
  }
  report.part1.scenarios.push(entry)
  return entry
}

const keyA = `zzres${STAMP}a`.slice(0, 64)
const keyB = `zzres${STAMP}b`.slice(0, 64)
const payloadSame = { title: `zz-resilience-${STAMP}`, content: 'idempotency probe', tags: [] }

await ProbeModel.deleteMany({ marker: /^zzidem-/ }).exec()
await clearRedisProbe()

// B0：无拦截器（直通）→ 10 并发同 key 同 payload
const b0 = await part1Scenario({
  id: 'B0', label: '无拦截器（直通对照组）+ 10 并发同 key 同 payload', impl: noInterceptor, implName: 'none(passthrough)',
  key: keyA, payload: payloadSame, delayMs: 0, rowsBefore: 0,
})
// B1：真实拦截器 → 10 并发同 key 同 payload（快handler）
await clearRedisProbe()
const b1 = await part1Scenario({
  id: 'B1', label: '真实拦截器 + 10 并发同 key 同 payload（快写 ~20ms）', impl: interceptor, implName: 'IdempotencyInterceptor',
  key: keyA, payload: payloadSame, delayMs: 0, rowsBefore: 0,
})
// B2：真实拦截器 → 10 并发同 key，首次写入慢（600ms）→ 触发 300ms in-flight 窗口
await clearRedisProbe()
const b2 = await part1Scenario({
  id: 'B2', label: '真实拦截器 + 10 并发同 key（首次写入 600ms，越过 300ms 轮询窗口）', impl: interceptor, implName: 'IdempotencyInterceptor',
  key: keyA, payload: payloadSame, delayMs: 600, rowsBefore: 0,
})
// B3：同 key 异 payload → 409
await clearRedisProbe()
const b3Marker = `zzidem-${STAMP}-B3`
const b3First = await runRequest({ impl: interceptor, key: keyB, payload: { ...payloadSame, content: 'first' }, marker: b3Marker })
await Promise.allSettled(pendingWrites); pendingWrites = []
await sleep(200)
const b3Conflict = await runRequest({ impl: interceptor, key: keyB, payload: { ...payloadSame, content: 'DIFFERENT' }, marker: b3Marker })
await Promise.allSettled(pendingWrites); pendingWrites = []
const b3Rows = await countRows(b3Marker)
report.part1.scenarios.push({
  id: 'B3', label: '真实拦截器 + 同 key 异 payload → 期望 409',
  impl: 'IdempotencyInterceptor', firstStatus: b3First.status, firstApplied: b3First.applied,
  conflictStatus: b3Conflict.status, conflictError: b3Conflict.error, rowsCreated: b3Rows,
})
// B4：顺序重放 → 命中缓存
const b4Marker = `zzidem-${STAMP}-B4`
const b4First = await runRequest({ impl: interceptor, key: `${keyB}replay`.slice(0, 64), payload: payloadSame, marker: b4Marker })
await Promise.allSettled(pendingWrites); pendingWrites = []
await sleep(200)
const rowsAfterFirst = await countRows(b4Marker)
const b4Replay = await runRequest({ impl: interceptor, key: `${keyB}replay`.slice(0, 64), payload: payloadSame, marker: b4Marker })
await Promise.allSettled(pendingWrites); pendingWrites = []
const rowsAfterReplay = await countRows(b4Marker)
const b4RedisKeys = await redis.keys(`idempotency:${PROBE_USER}:*`)
const b4Entry = {
  id: 'B4', label: '真实拦截器 + 顺序重放同 key/同 payload',
  firstStatus: b4First.status, firstApplied: b4First.applied,
  replayStatus: b4Replay.status, replayApplied: b4Replay.applied,
  replayReturnedSameId: Boolean(b4Replay.id) && b4Replay.id === b4First.id,
  rowsCreatedByReplay: rowsAfterReplay - rowsAfterFirst,
  redisKeyCount: b4RedisKeys.length,
  redisKeySample: b4RedisKeys.slice(0, 3),
}
report.part1.scenarios.push(b4Entry)

// ---------- Part 1 断言 ----------
const appliedCount = (entry, value) => entry.idempotencyAppliedHeaders.filter((v) => String(v) === String(value)).length
report.check('B0 无拦截器：10 并发产生 10 条记录（证明对照组确实没有幂等保护）', b0.rowsCreated === 10, { rowsCreated: b0.rowsCreated })
report.check('B0 无拦截器：完全没有 X-Idempotency-Applied 头', b0.idempotencyAppliedHeaders.every((v) => v === null), { headers: b0.idempotencyAppliedHeaders })
report.check('B1 有拦截器：10 并发实际落库恰好 1 条', b1.rowsCreated === 1, { rowsCreated: b1.rowsCreated })
report.check('B1 有拦截器：10 个请求返回同一个 id', b1.distinctReturnedIds.length === 1, { distinctIds: b1.distinctReturnedIds.length })
report.check('B1 有拦截器：X-Idempotency-Applied 恰好 1 个 false + 9 个 true', appliedCount(b1, false) === 1 && appliedCount(b1, true) === 9, { false: appliedCount(b1, false), true: appliedCount(b1, true) })
report.check('B1 有拦截器：全部 10 个请求都成功（慢请求未误报冲突）', b1.statusDistribution['HTTP 201'] === 10 || b1.statusDistribution['HTTP 200'] === 10, b1.statusDistribution)
report.check('B2 慢写（600ms）越过 300ms 窗口：落库仍恰好 1 条', b2.rowsCreated === 1, { rowsCreated: b2.rowsCreated, status: b2.statusDistribution })
report.check('B2 慢写：并发方拿到 409 idempotency in-flight 或缓存命中（落库不放大）', b2.rowsCreated === 1 && b2.distinctReturnedIds.length <= 1, { status: b2.statusDistribution, distinctIds: b2.distinctReturnedIds.length })
report.check('B3 同 key 异 payload：409 冲突', b3Conflict.status === 409, { status: b3Conflict.status, error: b3Conflict.error })
report.check('B3 同 key 异 payload：不新增记录', b3Rows === 1, { rowsCreated: b3Rows })
report.check('B4 顺序重放：命中缓存、X-Idempotency-Applied=true', b4Entry.replayStatus === 200 && b4Entry.replayApplied === 'true', { status: b4Entry.replayStatus, applied: b4Entry.replayApplied })
report.check('B4 顺序重放：不新增记录且返回同一 id', b4Entry.rowsCreatedByReplay === 0 && b4Entry.replayReturnedSameId, { rowsCreatedByReplay: b4Entry.rowsCreatedByReplay, sameId: b4Entry.replayReturnedSameId })

// ---------- Part 2：端到端（真实后端 3001 + 真实 Redis + 真实 Mongo notes 集合） ----------
const { user, token, client, close } = await pickUserAndToken()
const notes = client.db(DB).collection('notes')
const e2eMarker = `__resilience_idem_${STAMP}__`
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
const e2e = { user: { id: String(user._id) }, marker: e2eMarker, scenarios: {} }

const countNotes = () => notes.countDocuments({ title: e2eMarker })
const postNote = async (key, body) => {
  const h = key ? { ...headers, 'Idempotency-Key': key } : headers
  const r = await httpJson(`${API}/notes`, { method: 'POST', headers: h, body: JSON.stringify(body) })
  return {
    status: r.status,
    applied: r.headers.get('x-idempotency-applied'),
    message: r.body?.message,
    id: r.body?.data?.id ?? r.body?.data?._id,
  }
}

// E0：不带幂等键的 10 并发（等价于"客户端没走幂等协议"）
const e0Key = null
const e0Before = await countNotes()
const e0 = await Promise.all(Array.from({ length: 10 }, () => postNote(e0Key, { title: e2eMarker, content: 'e2e no-key', tags: [] })))
const e0After = await countNotes()
e2e.scenarios.E0_no_key_10_concurrent = {
  description: '不带 Idempotency-Key 的 10 并发 POST /api/notes（拦截器不介入）',
  rowsBefore: e0Before, rowsAfter: e0After, rowsCreated: e0After - e0Before,
  statusDistribution: e0.reduce((a, r) => { const k = `HTTP ${r.status}`; a[k] = (a[k] || 0) + 1; return a }, {}),
  distinctIds: [...new Set(e0.map((r) => r.id).filter(Boolean))].length,
}

// E1：带幂等键的 10 并发（同 key 同 payload）
const e1Key = `e2e-res-${STAMP}-a`
const e1Before = await countNotes()
const e1 = await Promise.all(Array.from({ length: 10 }, () => postNote(e1Key, { title: e2eMarker, content: 'e2e same key', tags: [] })))
const e1After = await countNotes()
e2e.scenarios.E1_same_key_10_concurrent = {
  description: '同一 Idempotency-Key + 同一 payload 的 10 并发 POST /api/notes',
  rowsBefore: e1Before, rowsAfter: e1After, rowsCreated: e1After - e1Before,
  statusDistribution: e1.reduce((a, r) => { const k = `HTTP ${r.status}${r.message ? `/${r.message}` : ''}`; a[k] = (a[k] || 0) + 1; return a }, {}),
  idempotencyAppliedHeaders: e1.map((r) => r.applied),
  appliedTrue: e1.filter((r) => r.applied === 'true').length,
  appliedFalse: e1.filter((r) => r.applied === 'false').length,
  distinctReturnedIds: [...new Set(e1.map((r) => r.id).filter(Boolean))],
}

// E2：顺序重放
const e2Before = await countNotes()
const e2Replay = await postNote(e1Key, { title: e2eMarker, content: 'e2e same key', tags: [] })
const e2After = await countNotes()
e2e.scenarios.E2_sequential_replay = {
  status: e2Replay.status, applied: e2Replay.applied,
  rowsCreated: e2After - e2Before,
  returnedSameId: Boolean(e2Replay.id) && e2Replay.id === e1.find((r) => r.id)?.id,
}

// E3：同 key 异 payload
const e3Key = `e2e-res-${STAMP}-b`
const e3First = await postNote(e3Key, { title: e2eMarker, content: 'e2e first', tags: [] })
const e3Conflict = await postNote(e3Key, { title: e2eMarker, content: 'e2e DIFFERENT', tags: [] })
e2e.scenarios.E3_same_key_different_payload = {
  firstStatus: e3First.status, conflictStatus: e3Conflict.status, conflictMessage: e3Conflict.message,
  expect409: e3Conflict.status === 409,
}
e2e.throttleNote = e1.some((r) => r.status === 429) ? '出现 429：本次运行触发了全局限流，数值不可直接采信' : '无 429'

report.part2 = e2e
report.check('E0 端到端：不带幂等键 10 并发 → 落库 10 条', e2e.scenarios.E0_no_key_10_concurrent.rowsCreated === 10, { rowsCreated: e2e.scenarios.E0_no_key_10_concurrent.rowsCreated })
report.check('E1 端到端：同 key 10 并发 → 实际落库 1 条', e2e.scenarios.E1_same_key_10_concurrent.rowsCreated === 1, { rowsCreated: e2e.scenarios.E1_same_key_10_concurrent.rowsCreated })
report.check('E1 端到端：10 个请求只返回 1 个 note id', e2e.scenarios.E1_same_key_10_concurrent.distinctReturnedIds.length === 1, { ids: e2e.scenarios.E1_same_key_10_concurrent.distinctReturnedIds.length })
report.check('E1 端到端：X-Idempotency-Applied = 1×false + 9×true', e2e.scenarios.E1_same_key_10_concurrent.appliedFalse === 1 && e2e.scenarios.E1_same_key_10_concurrent.appliedTrue === 9, { false: e2e.scenarios.E1_same_key_10_concurrent.appliedFalse, true: e2e.scenarios.E1_same_key_10_concurrent.appliedTrue })
report.check('E2 端到端：顺序重放不新增且带 applied=true', e2e.scenarios.E2_sequential_replay.rowsCreated === 0 && e2e.scenarios.E2_sequential_replay.applied === 'true', e2e.scenarios.E2_sequential_replay)
report.check('E3 端到端：同 key 异 payload → 409', e2e.scenarios.E3_same_key_different_payload.conflictStatus === 409, e2e.scenarios.E3_same_key_different_payload)
report.check('端到端未触发限流（数值可采信）', e2e.throttleNote.startsWith('无 429'), { note: e2e.throttleNote })

// ---------- 清理 ----------
const createdNotes = await notes.find({ title: e2eMarker }).project({ _id: 1 }).toArray()
const deleted = []
for (const n of createdNotes) {
  const r = await fetch(`${API}/notes/${n._id}`, { method: 'DELETE', headers })
  deleted.push({ id: String(n._id), status: r.status })
}
const remainingNotes = await countNotes()
await ProbeModel.deleteMany({ marker: /^zzidem-/ }).exec()
await ProbeModel.collection.drop().catch(() => {})
const probeResidue = await mongoose.connection.db.collection(PROBE_COLL).countDocuments().catch(() => 0)
const cleanedKeys = await clearRedisProbe()
const redisResidueAfterCleanup = (await redis.keys(`idempotency:${PROBE_USER}:*`)).length
report.cleanup = {
  e2eNotesCreated: createdNotes.length, e2eNotesDeleted: deleted.filter((d) => d.status === 200 || d.status === 204).length,
  e2eNotesRemaining: remainingNotes, probeCollectionResidue: probeResidue,
  redisProbeKeysDeleted: cleanedKeys, redisResidueAfterCleanup,
}
report.check('清理：端到端探针笔记已删除、无残留', remainingNotes === 0, { remaining: remainingNotes, deleted: deleted.length })
report.check('清理：一次性集合与 Redis 幂等键已清空', probeResidue === 0 && redisResidueAfterCleanup === 0, { probeResidue, redisResidueAfterCleanup, deletedKeys: cleanedKeys })

await redis.quit()
await mongoose.disconnect()
await close()
report.finish('b-idempotency.json')
