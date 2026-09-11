// C1. HTTP 限流：突发 429 比例 / 正常速率误伤 / 代理场景 before-after
//
// 后端限流实现：ThrottlerModule（默认 short: 60 次 / 60s）+ CustomThrottlerGuard（APP_GUARD 全局）
//
// Part 1（真实后端 3001）：
//   R1 突发：150 次 GET /api/health（并发 20）→ 统计 429 触发比例
//   R2 突发：150 次 GET /api/notes（鉴权业务路由）→ 同一行为是否作用于真实业务接口
//   R3 路由隔离：R2 打满后立刻请求其它路由，验证额度是「按路由」而非全局
//   R4 误伤（混合页面加载）：30 次「页面加载」，每次 4 个不同接口，2s 一次 → 统计误伤 429
//   R5 误伤（单接口稳定 1 req/s，45s）→ 统计误伤 429
// Part 2（代理场景 before/after，真实历史版本对照）：
//   fix 提交 498c65f 只给 main.ts 加了 4 行 set('trust proxy', 1)；498c65f 的 main.ts 与 HEAD 完全相同。
//   因此 before = 用 git 取回 498c65f^ 的 main.ts 逐字转译出的入口（无 trust proxy），
//        after  = 当前 dist/main.js（trust proxy=1）。两者 NODE_ENV=production，模拟 Nginx 反代。
//   场景：同一 socket 上 4 个不同真实用户（不同 X-Forwarded-For），各自 4 次 POST /api/auth/login（限额 10/min）
//        before 预期：4 人共享一个桶 → 第 11 次起 429（误伤）
//        after  预期：各自独立额度 → 0 次 429
import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { httpJson, pickUserAndToken, createReport, sleep, API, BACKEND_ROOT, loadBackendDep } from './_lib.mjs'

const HEALTH = `${API}/health`
const NOTES = `${API}/notes`
const SKIP_PART1 = process.env.C1_SKIP_PART1 === '1'

const report = createReport('C1 · HTTP 限流（突发 / 误伤 / 代理 IP before-after）', {
  implementation: 'ThrottlerModule short: 60req/60s + CustomThrottlerGuard(APP_GUARD)',
  trackerSource: 'notes-backend/src/common/guards/custom-throttler.guard.ts',
  proxyFixCommit: '498c65f',
})

// ---------- 请求工具 ----------
async function burst(url, { total, concurrency, headers = {} }) {
  const results = []
  let next = 0
  const startedAt = Date.now()
  async function worker() {
    while (true) {
      const i = next++
      if (i >= total) return
      const t = Date.now()
      try {
        const r = await httpJson(url, { headers })
        results.push({ status: r.status, message: r.body?.message, code: r.body?.code, latencyMs: Date.now() - t })
      } catch (e) {
        results.push({ status: 0, error: String(e.message).slice(0, 120), latencyMs: Date.now() - t })
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  const distribution = results.reduce((acc, r) => {
    const k = `HTTP ${r.status}`
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})
  const byStatus = (s) => results.filter((r) => r.status === s).length
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b)
  const first429 = results.find((r) => r.status === 429)
  return {
    total, concurrency, durationMs: Date.now() - startedAt,
    distribution,
    ok: byStatus(200),
    throttled429: byStatus(429),
    throttled429Ratio: Number((byStatus(429) / total).toFixed(4)),
    latencyP50: latencies[Math.floor(latencies.length * 0.5)],
    latencyP95: latencies[Math.floor(latencies.length * 0.95)],
    sample429Body: first429 ? { message: first429.message, code: first429.code } : null,
    other: results.filter((r) => r.status !== 200 && r.status !== 429).slice(0, 5),
  }
}

const { token, close } = await pickUserAndToken()
const auth = { Authorization: `Bearer ${token}` }

// ---------- Part 1 ----------
let r1 = null
let r2 = null
let r3 = []
let r4 = null
let r5 = null

if (SKIP_PART1) {
  report.part1 = { skipped: true, reason: 'C1_SKIP_PART1=1（仅快速迭代用，不作为最终证据）' }
} else {
  report.part1 = { backend: API, note: '3001 上运行的是开发配置实例（无代理，XFF 不参与 tracker）' }

  r1 = await burst(HEALTH, { total: 150, concurrency: 20 })
  report.part1.R1_burst_health = { description: '150 次 GET /api/health（并发 20）', ...r1 }

  r2 = await burst(NOTES, { total: 150, concurrency: 20, headers: auth })
  report.part1.R2_burst_notes = { description: '150 次 GET /api/notes（鉴权业务路由，并发 20）', ...r2 }

  // R3：R2 刚把 /notes 打满，此时其它路由是否受影响
  const r3Targets = ['/categories', '/tags', '/saved-filters', '/notifications', '/knowledge-bases', '/health']
  for (const p of r3Targets) {
    const r = await httpJson(`${API}${p}`, { headers: auth })
    r3.push({ path: p, status: r.status })
  }
  const notesStillThrottled = (await httpJson(NOTES, { headers: auth })).status === 429
  report.part1.R3_route_isolation = {
    description: 'R2 打满 /notes 后立刻请求其它路由（验证额度按路由隔离）',
    notesStillThrottled,
    results: r3,
  }

  // R4：误伤 —— 混合页面加载（30 次页面加载 × 4 接口，2s 间隔，共 ~60s）
  const pageEndpoints = ['/categories', '/tags', '/saved-filters', '/knowledge-bases']
  const r4Results = []
  const r4Started = Date.now()
  for (let load = 0; load < 30; load += 1) {
    for (const p of pageEndpoints) {
      const r = await httpJson(`${API}${p}`, { headers: auth })
      r4Results.push({ load, path: p, status: r.status })
    }
    await sleep(2000)
  }
  r4 = {
    description: '30 次页面加载 × 4 接口（每次加载命中 4 个接口），每 2s 一次；单接口 30 次/60s',
    totalRequests: r4Results.length,
    durationMs: Date.now() - r4Started,
    perEndpointCount: pageEndpoints.map((p) => ({ path: p, requests: r4Results.filter((x) => x.path === p).length })),
    ok: r4Results.filter((x) => x.status === 200).length,
    throttled429: r4Results.filter((x) => x.status === 429).length,
    falsePositiveRatio: Number((r4Results.filter((x) => x.status === 429).length / r4Results.length).toFixed(4)),
  }
  report.part1.R4_false_positive_page_loads = r4

  // R5：误伤 —— 单接口稳定 1 req/s（45s），额度内
  const r5Statuses = []
  const r5Started = Date.now()
  for (let i = 0; i < 45; i += 1) {
    const r = await httpJson(`${API}/notifications`, { headers: auth })
    r5Statuses.push(r.status)
    await sleep(1000)
  }
  r5 = {
    description: '单接口 /api/notifications 稳定 1 req/s，共 45 次（< 60/min 额度）',
    totalRequests: r5Statuses.length,
    durationMs: Date.now() - r5Started,
    ok: r5Statuses.filter((s) => s === 200).length,
    throttled429: r5Statuses.filter((s) => s === 429).length,
    falsePositiveRatio: Number((r5Statuses.filter((s) => s === 429).length / r5Statuses.length).toFixed(4)),
  }
  report.part1.R5_single_endpoint_steady = r5
}

// ---------- Part 2：代理 IP before/after ----------
// before 入口 = 修复前提交 498c65f^ 的 src/main.ts（逐字取回并转译）；它与 HEAD 的唯一差异就是
// 缺少 set('trust proxy', ...)。但该历史版本 import 了 './ws/jwt-ws.adapter' —— 这个模块后来被
// 当死代码删除，所以必须补一个惰性 stub 才能启动。仓库里没有任何 @WebSocketGateway，
// NestJS 不会实例化 WS adapter（见 notes-backend/test/architecture-ws-adapter.test.ts），
// 因此 stub 对 HTTP 限流路径没有任何影响，HTTP 层面的唯一变量仍是 trust proxy。
const PREFIX_ENTRY = join(BACKEND_ROOT, 'dist', 'main.prefix.js')
const STUB_DIR = join(BACKEND_ROOT, 'dist', 'ws')
const STUB_ENTRY = join(STUB_DIR, 'jwt-ws.adapter.js')
const ts = loadBackendDep('typescript')
const prefixSrc = execFileSync('git', ['show', '498c65f^:notes-backend/src/main.ts'], {
  cwd: join(BACKEND_ROOT, '..'), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
})
// 必须与 notes-backend/tsconfig.json 保持一致：该项目用 allowSyntheticDefaultImports 而非 esModuleInterop，
// 否则会产出 `cookieParser.default`，导致 `cookieParser is not a function` 启动失败。
const prefixJs = ts.transpileModule(prefixSrc, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    allowSyntheticDefaultImports: true,
    emitDecoratorMetadata: true,
    experimentalDecorators: true,
    strictNullChecks: false,
    noImplicitAny: false,
  },
}).outputText
mkdirSync(STUB_DIR, { recursive: true })
writeFileSync(PREFIX_ENTRY, prefixJs)
writeFileSync(STUB_ENTRY, [
  '"use strict";',
  'Object.defineProperty(exports, "__esModule", { value: true });',
  'exports.JwtWsAdapter = void 0;',
  '// 实验用惰性 stub：顶替已删除的 src/ws/jwt-ws.adapter.ts，只为让修复前的 main.ts 能启动。',
  '// 无 gateway ⇒ NestJS 不会实例化它，故不参与 HTTP 请求路径。',
  'class JwtWsAdapter {}',
  'exports.JwtWsAdapter = JwtWsAdapter;',
  '',
].join('\n'))

const beforeHasTrustProxy = prefixJs.includes('trust proxy')
const currentMainHasTrustProxy = execFileSync(process.execPath, ['-e', "process.stdout.write(require('fs').readFileSync('dist/main.js','utf8').includes('trust proxy')?'yes':'no')"], { cwd: BACKEND_ROOT, encoding: 'utf8' })

function spawnBackend({ port, nodeEnv, entry }) {
  const child = spawn(process.execPath, [entry], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: nodeEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  child.stdout.on('data', (d) => logs.push(String(d)))
  child.stderr.on('data', (d) => logs.push(String(d)))
  return { child, logs, port, entry, nodeEnv }
}
async function waitReady(inst, timeoutMs = 90000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (inst.logs.join('').includes('Application is running')) return true
    if (inst.child.exitCode !== null) return false
    await sleep(500)
  }
  return false
}
// SIGTERM 对带 BullMQ worker 的 Nest 进程常常无效，统一用 Stop-Process 杀进程树并确认端口释放
function killTree(pid) {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], { stdio: 'ignore' })
  } catch {}
}
async function portFree(port, timeoutMs = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) })
    } catch {
      return true
    }
    await sleep(500)
  }
  return false
}

async function proxyScenario(port) {
  const users = ['zz-res-a@example.com', 'zz-res-b@example.com', 'zz-res-c@example.com', 'zz-res-d@example.com']
  const results = []
  for (let round = 0; round < 4; round += 1) {
    for (let u = 0; u < users.length; u += 1) {
      const r = await httpJson(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${10 + u}` },
        body: JSON.stringify({ email: users[u], password: 'WrongPass123!' }),
      })
      results.push({ round, user: u, xff: `203.0.113.${10 + u}`, status: r.status, message: r.body?.message })
    }
  }
  const distribution = results.reduce((acc, r) => { const k = `HTTP ${r.status}`; acc[k] = (acc[k] || 0) + 1; return acc }, {})
  return {
    totalRequests: results.length,
    distinctForwardedIps: users.length,
    requestsPerUser: 4,
    distribution,
    unauthorized401: results.filter((r) => r.status === 401).length,
    throttled429: results.filter((r) => r.status === 429).length,
    falsePositiveRatio: Number((results.filter((r) => r.status === 429).length / results.length).toFixed(4)),
    firstThrottledAt: results.find((r) => r.status === 429) || null,
    perUser429: users.map((_, u) => results.filter((r) => r.user === u && r.status === 429).length),
  }
}

report.part2 = {
  description: '同一代理后 4 个不同真实用户访问 POST /api/auth/login（限额 10/min），before=无 trust proxy / after=trust proxy=1',
  scenario: '4 用户 × 4 次 = 16 次请求，携带不同 X-Forwarded-For（203.0.113.10-13）',
  beforeEntry: 'dist/main.prefix.js（由 498c65f^ 的 src/main.ts 逐字转译，缺 trust proxy 行）',
  beforeEntryStub: 'dist/ws/jwt-ws.adapter.js（惰性 stub，顶替已删除模块；无 gateway ⇒ 不参与 HTTP 路径）',
  crossCheckEntry: 'dist/main.js + NODE_ENV=development（trust proxy=false，等价于未设置时的 Express 默认值）',
  afterEntry: 'dist/main.js + NODE_ENV=production（trust proxy=1）',
  beforeContainsTrustProxy: beforeHasTrustProxy,
  afterContainsTrustProxy: currentMainHasTrustProxy === 'yes',
}

const instances = []
let before = null
let beforeCrossCheck = null
let after = null
try {
  const beforeInst = spawnBackend({ port: 3002, nodeEnv: 'production', entry: PREFIX_ENTRY })
  const crossInst = spawnBackend({ port: 3004, nodeEnv: 'development', entry: 'dist/main.js' })
  const afterInst = spawnBackend({ port: 3003, nodeEnv: 'production', entry: 'dist/main.js' })
  instances.push(beforeInst, crossInst, afterInst)
  const [okBefore, okCross, okAfter] = await Promise.all([waitReady(beforeInst), waitReady(crossInst), waitReady(afterInst)])
  report.part2.boot = { beforeReady: okBefore, crossCheckReady: okCross, afterReady: okAfter }
  if (!okBefore) report.part2.beforeBootLog = beforeInst.logs.join('').slice(-800)
  if (okBefore) before = await proxyScenario(3002)
  if (okCross) beforeCrossCheck = await proxyScenario(3004)
  if (okAfter) after = await proxyScenario(3003)
} finally {
  for (const inst of instances) {
    try { inst.child.kill('SIGTERM') } catch {}
  }
  await sleep(800)
  for (const inst of instances) {
    try { killTree(inst.child.pid) } catch {}
  }
}
report.part2.portsReleased = {
  p3002: await portFree(3002), p3003: await portFree(3003), p3004: await portFree(3004),
}
report.part2.before = before
report.part2.beforeCrossCheck = beforeCrossCheck
report.part2.after = after
if (existsSync(PREFIX_ENTRY)) unlinkSync(PREFIX_ENTRY)
if (existsSync(STUB_ENTRY)) unlinkSync(STUB_ENTRY)
try { rmdirSync(STUB_DIR) } catch {}
report.part2.generatedEntryCleanedUp = !existsSync(PREFIX_ENTRY) && !existsSync(STUB_ENTRY)

// ---------- 断言 ----------
if (!SKIP_PART1) {
  report.check('R1 突发 150 次 /api/health：60 通过 / 90 被限（429 比例 60%）', r1.throttled429 === 90 && r1.ok === 60, { ok: r1.ok, throttled429: r1.throttled429, ratio: r1.throttled429Ratio })
  report.check('R2 突发 150 次 /api/notes：同一限流行为作用于真实业务路由', r2.throttled429 === 90 && r2.ok === 60, { ok: r2.ok, throttled429: r2.throttled429, ratio: r2.throttled429Ratio })
  report.check('R2 429 响应体可识别（code/message）', Boolean(r2.sample429Body && r2.sample429Body.message), r2.sample429Body)
  report.check('R3 额度按路由隔离：/notes 被限流时其它 5 个路由仍 200', report.part1.R3_route_isolation.notesStillThrottled && r3.filter((x) => x.path !== '/health').every((x) => x.status === 200), { notesStillThrottled: report.part1.R3_route_isolation.notesStillThrottled, others: r3.map((x) => `${x.path}:${x.status}`) })
  report.check('R4 正常速率混合页面加载：误伤 429 = 0', r4.throttled429 === 0 && r4.ok === 120, { ok: r4.ok, throttled429: r4.throttled429 })
  report.check('R5 单接口稳定 1 req/s（45s，额度内）：误伤 429 = 0', r5.throttled429 === 0 && r5.ok === 45, { ok: r5.ok, throttled429: r5.throttled429 })
} else {
  report.check('Part1 已跳过（快速迭代模式，不作为最终证据）', false, { reason: 'C1_SKIP_PART1=1' })
}

report.check('before 入口确实不含 trust proxy（修复前语义）', beforeHasTrustProxy === false, { containsTrustProxy: beforeHasTrustProxy })
report.check('after 入口确实含 trust proxy（修复后语义）', currentMainHasTrustProxy === 'yes', { containsTrustProxy: currentMainHasTrustProxy })
report.check('Part2 三个实例都启动成功（历史 before / 等价 before / after）', Boolean(report.part2.boot && report.part2.boot.beforeReady && report.part2.boot.crossCheckReady && report.part2.boot.afterReady), report.part2.boot)
report.check('before（无 trust proxy）：4 个不同用户共享额度 → 出现误伤 429', Boolean(before) && before.throttled429 > 0, before ? { throttled429: before.throttled429, distribution: before.distribution, firstThrottledAt: before.firstThrottledAt, perUser429: before.perUser429 } : null)
report.check('before 交叉验证（trust proxy=false 等价配置）结果一致', Boolean(before && beforeCrossCheck) && before.throttled429 === beforeCrossCheck.throttled429, before && beforeCrossCheck ? { historicalBefore429: before.throttled429, devBefore429: beforeCrossCheck.throttled429 } : null)
report.check('after（trust proxy=1）：4 个用户各自独立额度 → 误伤 429 = 0', Boolean(after) && after.throttled429 === 0 && after.unauthorized401 === 16, after ? { throttled429: after.throttled429, unauthorized401: after.unauthorized401 } : null)
report.check('before-after 误伤率对比可量化', Boolean(before && after) && before.falsePositiveRatio > after.falsePositiveRatio, before && after ? { before: before.falsePositiveRatio, after: after.falsePositiveRatio, beforeThrottled: before.throttled429, afterThrottled: after.throttled429 } : null)
report.check('Part2 临时进程/端口/文件已清理', report.part2.generatedEntryCleanedUp && report.part2.portsReleased.p3002 && report.part2.portsReleased.p3003 && report.part2.portsReleased.p3004, { ...report.part2.portsReleased, entryCleaned: report.part2.generatedEntryCleanedUp })

await close()
report.finish('c1-http-ratelimit.json')
