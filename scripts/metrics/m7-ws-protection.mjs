/**
 * 【历史脚本 · 2026-09-10 起不可复现】
 * 本脚本测量的是 notes-backend 的 JwtWsAdapter —— 该适配器因"从未挂载"已被删除，
 * 同时 rate-limiter-flexible 也从 package.json 移除、clean build 不再生成 dist/ws/。
 * 因此直接运行会失败（缺 dist/ws/jwt-ws.adapter.js 与 rate-limiter-flexible）。
 * 如需复现当时的数值，请先切到删除前的提交（HEAD=ccc778c）并 npm install。
 * 保留本脚本仅为留痕，结论见 docs/metrics/measurement-report.md「指标 7」（已标注为历史测量）。
 *
 * 指标 7：WS 防护
 *  关键前提（S0）：真实后端 ws://127.0.0.1:3001/ws 不可达 —— 仓库中不存在 @WebSocketGateway，
 *  NestJS 只在存在 gateway 时才会调用 WsAdapter.create()，故该 adapter 从未挂载（HTTP 404，无任何单测）。
 *  因此端到端不可实测。本脚本改用「真实类 + 真实 Redis」的独立集成验证：
 *  直接实例化 notes-backend/dist 中的 JwtWsAdapter（真实实现），在空闲端口 3999 上 create()，
 *  用真实 ws 客户端驱动 verifyClient / message 处理器，得到可复现的数值。
 *  S1 重复 requestId → duplicate；S2 消息频率 → 429 + close(4429)；S3 连接频率 → 握手 429
 * 副作用：占用/清理 ws:msg:user:*、ws:conn:ip:*、ws:req:* Redis 键；不写业务数据。
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { Redis, WebSocket, dotenv } from './_deps.mjs'
import { pickUser, mintToken } from './_auth.mjs'
dotenv.config({ path: 'notes-backend/.env' })
const require = createRequire(new URL('../../notes-backend/package.json', import.meta.url))
const { JwtWsAdapter } = require('./dist/ws/jwt-ws.adapter.js')
const { JwtService } = require('@nestjs/jwt')
const { RateLimiterRedis } = require('rate-limiter-flexible')

const PORT = Number(process.env.M7_PORT || 3999)
const { user, close } = await pickUser()
const token = mintToken(user)
const stamp = Date.now()
const out = { metric: 'M7 WS protection', generatedAt: new Date().toISOString(), target: `ws://127.0.0.1:${PORT}/ws`, user: { id: String(user._id) }, scenarios: {} }

// ---------- S0：真实后端端点不可达证据 ----------
async function httpProbe(path) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:3001${path}`)
    const t = setTimeout(() => { try { ws.terminate() } catch {}; resolve('timeout') }, 5000)
    ws.on('open', () => { clearTimeout(t); ws.close(); resolve('open') })
    ws.on('unexpected-response', (_q, r) => { clearTimeout(t); resolve(`HTTP ${r.statusCode}`) })
    ws.on('error', (e) => { clearTimeout(t); resolve(`error: ${e.message}`) })
  })
}
out.scenarios.S0_live_backend_endpoint = {
  description: '真实后端 3001 上 /ws 是否可用（判定端到端可否实测）',
  withValidToken: await httpProbe(`/ws?access_token=${token}`),
  withoutToken: await httpProbe('/ws'),
  withBadToken: await httpProbe('/ws?access_token=bad'),
  gatewayInSource: 'grep -rn "@WebSocketGateway" notes-backend/src → 0 hits（无 gateway，适配器不会被实例化）',
}

// ---------- 用真实类在独立端口起 WS 服务 ----------
const redis = new Redis(process.env.REDIS_URL)
const msgLimiter = new RateLimiterRedis({ storeClient: redis, keyPrefix: 'ws:msg:user', points: 300, duration: 60 })
const connLimiter = new RateLimiterRedis({ storeClient: redis, keyPrefix: 'ws:conn:ip', points: 100, duration: 60 })
const jwt = new JwtService({ secret: process.env.JWT_SECRET })
const adapter = new JwtWsAdapter({}, jwt, msgLimiter, connLimiter, redis)
const server = adapter.create(PORT, {})
await new Promise((r) => setTimeout(r, 500))
out.scenarios.S1_S3_setup = { adapterClass: 'notes-backend/dist/ws/jwt-ws.adapter.js (real implementation)', port: PORT, msgLimiter: '300 points / 60s per userId', connLimiter: '100 points / 60s per IP' }

const URL_OK = `ws://127.0.0.1:${PORT}/ws?access_token=${encodeURIComponent(token)}`
function open(url = URL_OK) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url)
    const messages = []
    let handshake = null
    ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())) } catch { messages.push({ raw: d.toString() }) } })
    ws.on('unexpected-response', (_q, r) => { handshake = `HTTP ${r.statusCode}`; resolve({ ws, messages, handshake, opened: false }) })
    ws.on('error', (e) => { if (!handshake) handshake = `error: ${e.message}`; resolve({ ws, messages, handshake, opened: ws.readyState === 1 }) })
    ws.on('open', () => resolve({ ws, messages, handshake: null, opened: true }))
    setTimeout(() => resolve({ ws, messages, handshake: handshake || 'timeout', opened: ws.readyState === 1 }), 8000)
  })
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- S1：重复 requestId ----------
{
  const { ws, messages, opened, handshake } = await open()
  await wait(300)
  const rid = `probe-ws-dup-${stamp}`
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ requestId: rid })); await wait(400)
    const first = messages.filter((m) => m.requestId === rid)
    ws.send(JSON.stringify({ requestId: rid })); await wait(500)
    const both = messages.filter((m) => m.requestId === rid)
    out.scenarios.S1_duplicate_requestId = {
      description: '同一 requestId 连发两次（同一连接）',
      opened, handshake, authOk: messages.find((m) => m.message === 'WS_AUTH_OK') ?? null,
      responsesAfterFirst: first.map((m) => m.message), responsesTotal: both.map((m) => m.message),
      ackCount: both.filter((m) => m.message === 'ack').length,
      duplicateCount: both.filter((m) => m.message === 'duplicate').length,
      duplicateReturned: both.some((m) => m.message === 'duplicate'),
    }
  } else out.scenarios.S1_duplicate_requestId = { opened, handshake, error: 'handshake failed' }
  try { ws.close() } catch {}
  await wait(200)
}

// ---------- S2：消息频率（300 点/60s） ----------
{
  const { ws, messages, opened, handshake } = await open()
  const closed = []
  ws.on('close', (code, reason) => closed.push({ code, reason: reason?.toString() }))
  await wait(300)
  let sent = 0
  const CAP = 360
  if (ws.readyState === 1) {
    for (let i = 0; i < CAP; i++) {
      if (ws.readyState !== 1) break
      ws.send(JSON.stringify({ requestId: `probe-ws-rate-${stamp}-${i}` }))
      sent++
      if (i % 40 === 39) await wait(50)
      if (messages.some((m) => m.code === 429)) { await wait(500); break }
    }
  }
  await wait(1500)
  out.scenarios.S2_message_rate_limit = {
    description: '单连接连续发送唯一 requestId 直至触发 msgLimiter（300 点/60s/用户）',
    opened, handshake, messagesSent: sent,
    ackCount: messages.filter((m) => m.message === 'ack').length,
    duplicateCount: messages.filter((m) => m.message === 'duplicate').length,
    rateLimitResponse: messages.find((m) => m.code === 429) ?? null,
    closeEvents: closed,
    got429: messages.some((m) => m.code === 429),
    closedWith4429: closed.some((c) => c.code === 4429),
    thresholdObserved: messages.some((m) => m.code === 429) ? messages.filter((m) => m.message === 'ack').length : null,
  }
  try { ws.close() } catch {}
  // 清理 S2 消耗的限流额度与幂等键，避免影响后续与真实环境
  const msgKeys = await redis.keys('ws:msg:user:*'); for (const k of msgKeys) await redis.del(k)
  const idem = await redis.keys('ws:req:*'); let del = 0
  for (const k of idem) if (k.includes(stamp)) { await redis.del(k); del++ }
  out.scenarios.S2_message_rate_limit.cleanup = { msgLimiterKeysDeleted: msgKeys.length, idemKeysDeleted: del }
  await wait(500)
}

// ---------- S3：连接频率（100 点/60s/IP） ----------
{
  const connKeys0 = await redis.keys('ws:conn:ip:*')
  for (const k of connKeys0) await redis.del(k) // 从干净计数开始
  const results = []
  const total = 105
  for (let i = 0; i < total; i++) {
    const r = await open()
    results.push({ i: i + 1, opened: r.opened, handshake: r.handshake })
    if (r.opened) { try { r.ws.close() } catch {} }
    if (r.handshake === 'HTTP 429') break
  }
  const first429 = results.find((r) => r.handshake === 'HTTP 429')
  out.scenarios.S3_connection_rate_limit = {
    description: '顺序发起连接直至握手被拒（connLimiter 100 点/60s/IP；verifyClient 返回 done(false,429)）',
    connectionsAttempted: results.length,
    succeeded: results.filter((r) => r.opened).length,
    rejected429: results.filter((r) => r.handshake === 'HTTP 429').length,
    firstRejectedAtAttempt: first429 ? first429.i : null,
    tailResults: results.slice(-4),
    got429: Boolean(first429),
  }
  const connKeys = await redis.keys('ws:conn:ip:*'); for (const k of connKeys) await redis.del(k)
  out.scenarios.S3_connection_rate_limit.cleanup = { connLimiterKeysDeleted: connKeys.length }
}

out.summary = {
  endToEndOnRealBackend: '未实测（无 gateway，端点未挂载；见 S0）',
  integrationWithRealAdapterClass: {
    duplicateRequestId: out.scenarios.S1_duplicate_requestId?.duplicateReturned ?? null,
    messageRateLimit429: out.scenarios.S2_message_rate_limit?.got429 ?? null,
    closed4429: out.scenarios.S2_message_rate_limit?.closedWith4429 ?? null,
    connectionLimit429: out.scenarios.S3_connection_rate_limit?.got429 ?? null,
    connectionLimitThreshold: out.scenarios.S3_connection_rate_limit?.firstRejectedAtAttempt ?? null,
  },
}
writeFileSync('docs/metrics/raw/m7-ws-protection.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
server.close(); await redis.quit(); await close()