// C2. WebSocket 限流：连接级 + 消息级
//
// 现状（必须先说清）：后端原生 WS 适配器 JwtWsAdapter 从未挂载（仓库无 @WebSocketGateway），
// 且已作为死代码删除；真实协作 WS 是独立服务 y-websocket（默认 1234）。因此分为两部分：
//
// Part 1（真实链路 y-websocket，实测「有没有限流」）：
//   W1 连接级：同一 IP 快速建 150 条带合法票据的连接 → 统计成功数（无连接级限流则全部成功）
//   W2 消息级：两条连接同一房间，A 连续做 400 次编辑 → 统计 B 收到的字符数 + 服务端实收消息数
//   W3 对照：无票据连接 → 401（真实链路有鉴权，但没有限流）
// Part 2（已删除实现的限流语义，隔离复现）：
//   限流参数取自修复前 main.ts：connLimiter{keyPrefix:'ws:conn:ip',points:100,duration:60}、
//   msgLimiter{keyPrefix:'ws:msg:user',points:300,duration:60}；判定点逐字复刻
//   git HEAD:notes-backend/src/ws/jwt-ws.adapter.ts（该文件已被删除）。
//   V1 连接级：同 IP 第 101 次建连 → 期望被拒（HTTP 429）
//   V2 消息级：单连接连续发消息 → 统计 ack 数、429 与 close(4429)
import { spawn, execFileSync } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  Redis, env, jwt, createReport, sleep, sha1, writeRaw, RAW_DIR,
  loadBackendDep, loadYwsDep, WebSocket, YWS_ROOT, REPO_ROOT,
} from './_lib.mjs'

const YWS_PORT = 1234
const ROOM_NOTE_ID = '000000000000000000000000'
const ROOM = `note:${ROOM_NOTE_ID}`
const CONN_POINTS = 100
const CONN_DURATION = 60
const MSG_POINTS = 300
const MSG_DURATION = 60

const report = createReport('C2 · WebSocket 限流（连接级 / 消息级）', {
  realPath: { service: 'y-websocket', port: YWS_PORT, note: '独立协作服务，后端 /ws 不存在' },
  removedImplementation: { file: 'notes-backend/src/ws/jwt-ws.adapter.ts', state: '已从工作区删除（git HEAD 仍可查）' },
  limiterConfig: { conn: { keyPrefix: 'ws:conn:ip', points: CONN_POINTS, duration: CONN_DURATION }, msg: { keyPrefix: 'ws:msg:user', points: MSG_POINTS, duration: MSG_DURATION } },
})

// 已删除适配器的出处证据
const adapterSrc = execFileSync('git', ['show', 'HEAD:notes-backend/src/ws/jwt-ws.adapter.ts'], { cwd: REPO_ROOT, encoding: 'utf8' })
report.removedImplementation.sourceSha1 = sha1(adapterSrc)
report.removedImplementation.connGateLine = adapterSrc.split('\n').find((l) => l.includes('connLimiter.consume'))?.trim()
report.removedImplementation.msgGateLine = adapterSrc.split('\n').find((l) => l.includes('msgLimiter.consume'))?.trim()

function mintRoomTicket({ noteId = ROOM_NOTE_ID, userId = 'zz-resilience-user', role = 'owner' } = {}) {
  return jwt.sign({ noteId, userId, role, type: 'room-ticket' }, env('JWT_SECRET'), { expiresIn: '300s' })
}

function killTree(pid) {
  try { execFileSync('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], { stdio: 'ignore' }) } catch {}
}
async function portFree(port, timeoutMs = 12000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(600) }) } catch { return true }
    await sleep(400)
  }
  return false
}

// ---------- Part 1：启动真实 y-websocket ----------
const ywsInst = spawn(process.execPath, ['start.js'], {
  cwd: YWS_ROOT,
  env: { ...process.env, PORT: String(YWS_PORT), JWT_SECRET: env('JWT_SECRET'), NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const ywsLogs = []
ywsInst.stdout.on('data', (d) => ywsLogs.push(String(d)))
ywsInst.stderr.on('data', (d) => ywsLogs.push(String(d)))
const ywsReady = await (async () => {
  const started = Date.now()
  while (Date.now() - started < 30000) {
    if (ywsLogs.join('').includes('listening on port')) return true
    if (ywsInst.exitCode !== null) return false
    await sleep(400)
  }
  return false
})()
report.part1 = { serverReady: ywsReady, serverCommand: 'node start.js (cwd=y-websocket, PORT=1234)' }
const countLines = (needle) => ywsLogs.join('').split(String.fromCharCode(10)).filter((l) => l.includes(needle)).length
const countReceived = () => countLines('[Msg] Received')
const countSending = () => countLines('[Msg] Sending')

// W1：连接级 —— 同一 IP 快速建 150 条带合法票据的连接
function safeClose(socket) {
  if (!socket) return
  try {
    socket.on('error', () => {})
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CLOSING) socket.close()
    else socket.terminate()
  } catch {}
}

async function tryConnect({ ticket, timeoutMs = 8000 }) {
  return new Promise((resolve) => {
    const url = `ws://127.0.0.1:${YWS_PORT}/${encodeURIComponent(ROOM)}${ticket ? `?access_token=${ticket}` : ''}`
    const socket = new WebSocket(url)
    // 始终保留一个 error 兜底监听：ws 在握手失败/被 429 拒绝后会异步 emit error，
    // 若此时没有监听器会直接让进程崩溃。
    socket.on('error', () => {})
    const done = (outcome) => { resolve({ ...outcome, socket }) }
    const timer = setTimeout(() => done({ opened: false, reason: 'timeout' }), timeoutMs)
    socket.on('open', () => { clearTimeout(timer); done({ opened: true, reason: 'open' }) })
    socket.on('unexpected-response', (_req, res) => { clearTimeout(timer); done({ opened: false, reason: `http-${res.statusCode}` }) })
    socket.on('error', (err) => { clearTimeout(timer); done({ opened: false, reason: `error:${String(err.message).slice(0, 60)}` }) })
  })
}

const ticket = mintRoomTicket()
const w1Results = []
const w1Started = Date.now()
for (let i = 0; i < 150; i += 1) {
  const r = await tryConnect({ ticket })
  w1Results.push({ i, opened: r.opened, reason: r.reason })
  if (!r.opened) safeClose(r.socket)
}
const w1Open = w1Results.filter((r) => r.opened).length
// 同时验证无票据被拒（真实链路的连接级保护是鉴权，不是限流）
const w3NoTicket = await tryConnect({ ticket: null })
const w3BadTicket = await tryConnect({ ticket: 'not-a-jwt' })
report.part1.W1_connection_level = {
  description: `同一 IP 连续建立 150 条带合法票据的连接（阈值若存在应为 ${CONN_POINTS}/${CONN_DURATION}s）`,
  attempts: 150, opened: w1Open, rejected: 150 - w1Open,
  rejectedReasons: [...new Set(w1Results.filter((r) => !r.opened).map((r) => r.reason))],
  durationMs: Date.now() - w1Started,
}
report.part1.W3_auth_control = {
  description: '对照：无票据 / 伪造票据建连（真实链路的连接级保护）',
  noTicket: { opened: w3NoTicket.opened, reason: w3NoTicket.reason },
  badTicket: { opened: w3BadTicket.opened, reason: w3BadTicket.reason },
}
safeClose(w3NoTicket.socket)
safeClose(w3BadTicket.socket)

// 关闭 W1 留下的连接，避免干扰消息级测试
for (const r of w1Results) { if (r.opened && r.socket) safeClose(r.socket) }
await sleep(1000)

// W2：消息级 —— 两个真实 Yjs 客户端同房间，A 连续 400 次编辑，B 侧校验最终内容
const Y = loadYwsDep('yjs')
const { WebsocketProvider } = loadYwsDep('y-websocket')

function makeProvider(doc, closeLog) {
  const provider = new WebsocketProvider(`ws://127.0.0.1:${YWS_PORT}`, ROOM, doc, {
    WebSocketPolyfill: WebSocket,
    params: { access_token: ticket },
  })
  provider.on('connection-close', (event, p) => closeLog.push({ code: event?.code, reason: String(event?.reason || ''), provider: p === provider ? 'self' : 'other' }))
  return provider
}

const docA = new Y.Doc()
const docB = new Y.Doc()
const closeEvents = []
const providerA = makeProvider(docA, closeEvents)
const providerB = makeProvider(docB, closeEvents)

const waitSync = async (provider, timeoutMs = 15000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (provider.synced) return true
    await sleep(200)
  }
  return false
}
const syncedA = await waitSync(providerA)
const syncedB = await waitSync(providerB)
await sleep(500)

const textA = docA.getText('t')
const textB = docB.getText('t')
const msgsBefore = countReceived()
const sendBefore = countSending()
const w2Started = Date.now()
for (let i = 0; i < 400; i += 1) textA.insert(textA.length, 'x')
let propagated = 0
const waitPropagation = Date.now()
while (Date.now() - waitPropagation < 20000) {
  propagated = textB.length
  if (propagated >= 400) break
  await sleep(300)
}
// 子进程 stdout 是异步管道：W2 只需几十毫秒就能同步完，必须等日志刷出再计数，
// 否则会把「还没收到日志」误读成「服务端没收到消息」。
await sleep(1500)
const msgsAfter = countReceived()
const sendAfter = countSending()
report.part1.W2_message_level = {
  description: `同一房间内 A 连续 400 次编辑（消息级阈值若存在应为 ${MSG_POINTS}/${MSG_DURATION}s / 每用户）`,
  syncedA, syncedB,
  editsSent: 400,
  charsReceivedByB: propagated,
  messageLossRatio: Number(((400 - propagated) / 400).toFixed(4)),
  // 服务端 stdout 计数只作旁证：日志行受实现/缓冲影响，不是可靠计数。
  // 主判据是对端实际收到的内容（charsReceivedByB）。
  serverLogReceivedLines: msgsAfter - msgsBefore,
  serverLogSendingLines: sendAfter - sendBefore,
  connectionStillOpen: Boolean(providerA.wsconnected && providerB.wsconnected),
  closeEvents,
  durationMs: Date.now() - w2Started,
}
providerA.destroy()
providerB.destroy()
docA.destroy()
docB.destroy()
await sleep(800)
// 服务端原始日志落盘，便于核对与复现
writeFileSync(join(RAW_DIR, 'c2-yws-server.log'), ywsLogs.join(''), { encoding: 'utf8' })
report.part1.serverLogLines = ywsLogs.join('').split('\n').length
report.part1.serverLogSample = ywsLogs.join('').split('\n').filter((l) => l.includes('[Auth]') || l.includes('[Msg]')).slice(0, 8)

// ---------- Part 2：已删除适配器的限流语义（真实 Redis + 真实 RateLimiterRedis） ----------
const redis = new Redis(env('REDIS_URL'))
const { RateLimiterRedis } = loadBackendDep('rate-limiter-flexible')
const wsServerLib = loadYwsDep('ws')

// 参数与修复前 main.ts 完全一致（git show 498c65f^:notes-backend/src/main.ts 第 79-80 行）
const connLimiter = new RateLimiterRedis({ storeClient: redis, keyPrefix: 'ws:conn:ip', points: CONN_POINTS, duration: CONN_DURATION })
const msgLimiter = new RateLimiterRedis({ storeClient: redis, keyPrefix: 'ws:msg:user', points: MSG_POINTS, duration: MSG_DURATION })

const P2_PORT = 3998
const P2_IP = '203.0.113.77'
const P2_USER = 'zz-resilience-ws-user'
const keysBefore = (await redis.keys('ws:*')).length

// 复刻适配器判定点：upgrade 阶段先是 connLimiter.consume(ip)，失败则 429 拒绝
// 消息阶段先做 requestId 幂等 setnx，再 msgLimiter.consume(userId)，失败则回 429 并 close(4429)
// 必须用 noServer + 自己处理 upgrade：WebSocketServer({port}) 会自行完成握手，
// 我的连接级判定会晚于握手执行，无法真正拒绝（真实 y-websocket 也是 noServer 模式）。
const p2HttpServer = createHttpServer()
const p2Server = new wsServerLib.WebSocketServer({ noServer: true })
const p2Stats = { upgrades: 0, rejected: 0, rejectCodes: [], acks: 0, rateLimited: 0, closes: [] }

p2Server.on('connection', (socket) => {
  socket.on('message', async (raw) => {
    let msg = null
    try { msg = JSON.parse(raw.toString()) } catch { return }
    const idemKey = `ws:req:${P2_USER}:${msg.requestId}`
    const nx = await redis.set(idemKey, '1', 'EX', 300, 'NX')
    if (nx === null && msg.requestId) {
      socket.send(JSON.stringify({ code: 0, message: 'duplicate', requestId: msg.requestId }))
      return
    }
    try {
      await msgLimiter.consume(P2_USER)
    } catch {
      p2Stats.rateLimited += 1
      socket.send(JSON.stringify({ code: 429, message: 'rate_limit', data: { retryAfter: 30 }, requestId: msg.requestId }))
      socket.close(4429, 'Rate limit exceeded')
      return
    }
    p2Stats.acks += 1
    socket.send(JSON.stringify({ code: 0, message: 'ack', requestId: msg.requestId }))
  })
  socket.on('close', (code) => p2Stats.closes.push(code))
})
p2HttpServer.on('upgrade', async (request, socket, head) => {
  p2Stats.upgrades += 1
  try {
    await connLimiter.consume(P2_IP)
  } catch {
    p2Stats.rejected += 1
    p2Stats.rejectCodes.push(429)
    const crlf = String.fromCharCode(13, 10)
    socket.write(`HTTP/1.1 429 Too Many Requests${crlf}${crlf}`)
    socket.destroy()
    return
  }
  p2Server.handleUpgrade(request, socket, head, (ws) => p2Server.emit('connection', ws, request))
})
await new Promise((resolve) => p2HttpServer.listen(P2_PORT, resolve))

// V1：连接级 —— 顺序建 101 条连接（阈值 100/60s/IP）
const v1 = []
for (let i = 0; i < CONN_POINTS + 1; i += 1) {
  const opened = await new Promise((resolve) => {
    const socket = new wsServerLib(`ws://127.0.0.1:${P2_PORT}`)
    const timer = setTimeout(() => resolve({ opened: false, reason: 'timeout', socket }), 6000)
    socket.on('open', () => { clearTimeout(timer); resolve({ opened: true, socket }) })
    socket.on('unexpected-response', (_r, res) => { clearTimeout(timer); resolve({ opened: false, reason: `http-${res.statusCode}`, socket }) })
    socket.on('error', (err) => { clearTimeout(timer); resolve({ opened: false, reason: `error:${String(err.message).slice(0, 50)}`, socket }) })
  })
  v1.push({ i: i + 1, opened: opened.opened, reason: opened.reason })
  safeClose(opened.socket)
}
report.part2 = {
  description: '隔离复现已删除适配器的限流语义（真实 Redis + 真实 RateLimiterRedis；判定点逐字复刻 git HEAD 的 jwt-ws.adapter.ts）',
  confidence: 'component-level（隔离 replay，非端到端：该适配器从未挂载且现已删除）',
  serverPort: P2_PORT,
  upgradeRequestsObserved: p2Stats.upgrades,
  V1_connection_level: {
    description: `同 IP 顺序建连 ${CONN_POINTS + 1} 次（阈值 ${CONN_POINTS}/${CONN_DURATION}s）`,
    attempts: v1.length,
    opened: v1.filter((x) => x.opened).length,
    rejected: v1.filter((x) => !x.opened).length,
    rejectedAtAttempt: v1.find((x) => !x.opened)?.i ?? null,
    rejectedReasons: [...new Set(v1.filter((x) => !x.opened).map((x) => x.reason))],
  },
  V2_message_level: {},
}

// V1 已把同 IP 的连接级额度用满（100/60s），V2 要先建立连接，
// 因此这里显式重置连接级计数；这不改变任何限流语义，只是隔离两个实验。
const connKeysBeforeReset = await redis.keys('ws:conn:ip:*')
if (connKeysBeforeReset.length) await redis.del(...connKeysBeforeReset)
report.part2.connKeysResetBeforeV2 = connKeysBeforeReset.length

// V2：消息级 —— 单连接连续发消息直到被限流（阈值 300/60s/用户）
const v2 = { sent: 0, ack: 0, rateLimited: 0, duplicate: 0, closed: null, closeCode: null, firstLimitedAt: null }
await new Promise((resolve) => {
  const socket = new wsServerLib(`ws://127.0.0.1:${P2_PORT}`)
  let settled = false
  const finish = () => { if (!settled) { settled = true; try { socket.close() } catch {} ; resolve() } }
  socket.on('open', async () => {
    for (let i = 0; i < MSG_POINTS + 20; i += 1) {
      if (socket.readyState !== socket.OPEN) break
      v2.sent += 1
      await new Promise((r) => socket.send(JSON.stringify({ requestId: `zz-res-${i}` }), () => r()))
      await new Promise((r) => setTimeout(r, 2))
      if (v2.rateLimited > 0) break
    }
    setTimeout(finish, 600)
  })
  socket.on('message', (raw) => {
    let msg = null
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (msg.code === 429) { v2.rateLimited += 1; if (v2.firstLimitedAt === null) v2.firstLimitedAt = v2.sent }
    else if (msg.message === 'duplicate') v2.duplicate += 1
    else if (msg.message === 'ack') v2.ack += 1
  })
  socket.on('close', (code) => { v2.closed = true; v2.closeCode = code; finish() })
  socket.on('error', () => finish())
  setTimeout(finish, 60000)
})
report.part2.V2_message_level = {
  description: `单连接连续发消息直至被限流（阈值 ${MSG_POINTS}/${MSG_DURATION}s/用户）`,
  messagesSent: v2.sent,
  acks: v2.ack,
  rateLimitResponses429: v2.rateLimited,
  first429AfterMessages: v2.firstLimitedAt,
  duplicates: v2.duplicate,
  connectionClosed: v2.closed,
  closeCode: v2.closeCode,
}

// ---------- 清理 ----------
try { p2Server.close() } catch {}
for (const s of p2Server.clients) { try { s.terminate() } catch {} }
try { p2HttpServer.close() } catch {}
const cleanupPatterns = ['ws:conn:ip:*', 'ws:msg:user:*', 'ws:req:zz-resilience-ws-user:*']
const deletedKeys = {}
for (const pattern of cleanupPatterns) {
  const keys = await redis.keys(pattern)
  if (keys.length) await redis.del(...keys)
  deletedKeys[pattern] = keys.length
}
const residue = (await redis.keys('ws:*')).length
report.cleanup = { deletedKeys, wsKeysBefore: keysBefore, wsKeysResidueAfter: residue }
await redis.quit()

// 关闭真实 y-websocket 服务并确认端口释放
try { ywsInst.kill('SIGTERM') } catch {}
await sleep(800)
killTree(ywsInst.pid)
const ywsPortFree = await portFree(YWS_PORT)
report.cleanup.ywsPortFree = ywsPortFree

// ---------- 断言 ----------
report.check('Part1 真实 y-websocket 服务启动成功', ywsReady === true, { ready: ywsReady })
report.check('W3 真实链路有鉴权：无票据 / 伪造票据连接被拒', w3NoTicket.opened === false && w3BadTicket.opened === false, { noTicket: w3NoTicket.reason, badTicket: w3BadTicket.reason })
report.check('W1 连接级：同一 IP 150 条连接全部成功（真实链路无连接级限流）', w1Open === 150, { opened: w1Open, rejected: 150 - w1Open, reasons: report.part1.W1_connection_level.rejectedReasons })
report.check('W2 消息级：400 次编辑全部送达对端（真实链路无消息级限流）', propagated === 400, { charsReceivedByB: propagated, lossRatio: report.part1.W2_message_level.messageLossRatio })
report.check('W2 连接未被限流关闭（无 4429）', report.part1.W2_message_level.connectionStillOpen && !closeEvents.some((e) => e.code === 4429), { stillOpen: report.part1.W2_message_level.connectionStillOpen, closeEvents })
report.check('V1 已删除实现的连接级限流：第 101 次建连被拒（429）', report.part2.V1_connection_level.opened === CONN_POINTS && report.part2.V1_connection_level.rejectedAtAttempt === CONN_POINTS + 1, { opened: report.part2.V1_connection_level.opened, rejectedAtAttempt: report.part2.V1_connection_level.rejectedAtAttempt, reasons: report.part2.V1_connection_level.rejectedReasons })
report.check('V2 已删除实现的消息级限流：出现 429 + close(4429)', report.part2.V2_message_level.rateLimitResponses429 > 0 && report.part2.V2_message_level.closeCode === 4429, { acks: report.part2.V2_message_level.acks, rateLimited: report.part2.V2_message_level.rateLimitResponses429, closeCode: report.part2.V2_message_level.closeCode })
report.check('V2 ack 数与阈值一致（约 300 条后限流）', report.part2.V2_message_level.acks >= MSG_POINTS - 2 && report.part2.V2_message_level.acks <= MSG_POINTS, { acks: report.part2.V2_message_level.acks, points: MSG_POINTS })
report.check('清理：ws:* 键无残留且 y-websocket 端口已释放', residue === 0 && ywsPortFree === true, { residue, deletedKeys, ywsPortFree })

report.finish('c2-ws-ratelimit.json')
