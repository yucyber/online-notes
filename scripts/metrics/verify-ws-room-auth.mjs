// 验证「发现 1b 修复」：y-websocket 的 upgrade 鉴权必须把 room-ticket 绑定到房间。
// 覆盖：同房间放行 / 跨房间拒绝 / 登录 token 拒绝 / 无 token 拒绝 / 坏签名拒绝 / auth-disabled 放行。
// 用法：先以 YWS_JWT_SECRET 启动 y-websocket，再 node scripts/metrics/verify-ws-room-auth.mjs
import { writeFileSync } from 'node:fs'
import { jwt, WebSocket } from './_deps.mjs'

const PORT = Number(process.env.YWS_PORT || 1234)
const SECRET = process.env.YWS_JWT_SECRET
if (!SECRET) {
  console.error('需要 YWS_JWT_SECRET（与 y-websocket 服务端一致）')
  process.exit(1)
}

const NOTE_A = '68c1f0aabbccddeeff001122'
const NOTE_B = '68c1f0aabbccddeeff003344'
const roomOf = (noteId, suffix = '') => `note:${noteId.toLowerCase()}${suffix}`
const ticketFor = (noteId, role = 'writer') =>
  jwt.sign({ noteId, userId: 'u-metrics', role, type: 'room-ticket' }, SECRET, { expiresIn: 300 })

// 返回 { outcome: 'accepted'|'rejected', status?, reason? }
function attempt({ path, token }) {
  return new Promise((resolve) => {
    const query = token ? `?access_token=${encodeURIComponent(token)}` : ''
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${path}${query}`)
    let settled = false
    const done = (value) => { if (!settled) { settled = true; try { ws.terminate() } catch {} ; resolve(value) } }
    ws.on('open', () => done({ outcome: 'accepted' }))
    ws.on('unexpected-response', (_req, res) => done({ outcome: 'rejected', status: res.statusCode }))
    ws.on('error', (err) => done({ outcome: 'rejected', status: null, reason: err?.message || String(err) }))
    setTimeout(() => done({ outcome: 'timeout' }), 6000)
  })
}

const cases = []
const run = async (name, expectation, args) => {
  const result = await attempt(args)
  const pass =
    expectation === 'accepted'
      ? result.outcome === 'accepted'
      : result.outcome === 'rejected' && (expectation.status === undefined || result.status === expectation.status)
  cases.push({ name, expectation, ...result, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} -> ${result.outcome}${result.status ? ' ' + result.status : ''}${result.reason ? ' (' + result.reason + ')' : ''}`)
}

await run('同房间 + 自己的合法票据 → 放行', 'accepted', { path: `/${roomOf(NOTE_A)}`, token: ticketFor(NOTE_A) })
await run('同房间 + reader 票据 → 放行（写权限另由 read-only 守卫限制）', 'accepted', { path: `/${roomOf(NOTE_A)}`, token: ticketFor(NOTE_A, 'reader') })
await run('同房间 + versionKey 后缀 → 放行', 'accepted', { path: `/${roomOf(NOTE_A, ':v2')}`, token: ticketFor(NOTE_A) })
await run('★跨笔记：A 的票据连 B 的房间 → 401 拒绝', { status: 401 }, { path: `/${roomOf(NOTE_B)}`, token: ticketFor(NOTE_A) })
await run('★登录 token（type 非 room-ticket）连自己房间 → 401 拒绝', { status: 401 }, {
  path: `/${roomOf(NOTE_A)}`,
  token: jwt.sign({ sub: 'u-metrics', email: 'a@b.c' }, SECRET, { expiresIn: 300 }),
})
await run('无 token → 401 拒绝', { status: 401 }, { path: `/${roomOf(NOTE_A)}` })
await run('坏签名 → 401 拒绝', { status: 401 }, { path: `/${roomOf(NOTE_A)}`, token: ticketFor(NOTE_A) + 'x' })
await run('伪造 type 但 noteId 不匹配 → 401 拒绝', { status: 401 }, {
  path: `/${roomOf(NOTE_B)}`,
  token: jwt.sign({ noteId: NOTE_A, userId: 'u', role: 'writer', type: 'room-ticket' }, SECRET, { expiresIn: 300 }),
})

const summary = {
  metric: '发现1b：y-websocket 票据与房间绑定校验',
  generatedAt: new Date().toISOString(),
  target: `ws://127.0.0.1:${PORT}`,
  total: cases.length,
  passed: cases.filter((c) => c.pass).length,
  failed: cases.filter((c) => !c.pass).length,
  crossRoomRejected: cases.find((c) => c.name.startsWith('★跨笔记'))?.outcome === 'rejected',
  loginTokenRejected: cases.find((c) => c.name.startsWith('★登录'))?.outcome === 'rejected',
  cases,
}
const out = 'docs/metrics/raw/verify-ws-room-auth.json'
writeFileSync(out, JSON.stringify(summary, null, 2))
console.log(`\n${summary.passed}/${summary.total} 通过；跨房间拒绝=${summary.crossRoomRejected}；登录token拒绝=${summary.loginTokenRejected}`)
console.log(`证据已写入 ${out}`)
process.exit(summary.failed === 0 ? 0 : 1)
