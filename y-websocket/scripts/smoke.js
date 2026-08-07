// y-websocket/scripts/smoke.js
// Smoke test: 验证 y-websocket 启动后基本鉴权行为
// 运行：先启动 server（node start.js），再执行 node scripts/smoke.js
const WebSocket = require('ws')
const http = require('http')

const PORT = process.env.PORT || 1234

function httpGet(path) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${PORT}${path}`, (res) => {
            let data = ''
            res.on('data', (c) => (data += c))
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }))
        })
        req.on('error', reject)
        req.setTimeout(5000, () => reject(new Error('timeout')))
    })
}

function tryWsConnect(path, timeoutMs = 5000) {
    return new Promise((resolve) => {
        let resolved = false
        const done = (result) => {
            if (!resolved) {
                resolved = true
                try { ws.close() } catch {}
                resolve(result)
            }
        }
        let ws
        try { ws = new WebSocket(`ws://localhost:${PORT}${path}`) }
        catch (e) { resolve({ opened: false, error: e.message }); return }
        const timer = setTimeout(() => done({ opened: false, error: 'timeout' }), timeoutMs)
        ws.on('open', () => { clearTimeout(timer); done({ opened: true }) })
        ws.on('unexpected-response', (_req, res) => { clearTimeout(timer); done({ opened: false, httpStatus: res.statusCode }) })
        ws.on('error', (err) => { clearTimeout(timer); done({ opened: false, error: err.message }) })
    })
}

async function main() {
    let passed = 0, failed = 0
    const assert = (name, cond, detail) => {
        if (cond) { passed++; console.log(`[PASS] ${name}`) }
        else { failed++; console.log(`[FAIL] ${name} — ${detail}`) }
    }

    // 1. HTTP 存活
    const res = await httpGet('/')
    assert('HTTP 存活', res.statusCode === 200, `status=${res.statusCode}`)

    // 2. 无 token 拒绝
    const noToken = await tryWsConnect('/note:507f1f77bcf86cd799439011')
    assert('无 token 拒绝', !noToken.opened, JSON.stringify(noToken))

    // 3. 无效 token 拒绝
    const badToken = await tryWsConnect('/note:507f1f77bcf86cd799439011?access_token=invalid')
    assert('无效 token 拒绝', !badToken.opened, JSON.stringify(badToken))

    // 4. 无效房间名格式拒绝（需要 JWT_SECRET 才能构造有效 token 测试后续场景）
    const secret = process.env.JWT_SECRET || process.env.YWS_JWT_SECRET
    if (secret) {
        const jwtLib = require('jsonwebtoken')
        const NOTE_ID = '507f1f77bcf86cd799439011'
        const token = jwtLib.sign({ noteId: NOTE_ID, userId: 'user-a', role: 'writer', type: 'room-ticket' }, secret, { expiresIn: 300 })

        const badRoom = await tryWsConnect(`/arbitrary-room?access_token=${token}`)
        assert('无效房间名拒绝', !badRoom.opened, JSON.stringify(badRoom))

        // 5. ticket noteId 与房间名不匹配拒绝
        const mismatchToken = jwtLib.sign({ noteId: '507f1f77bcf86cd799439012', userId: 'user-a', role: 'writer', type: 'room-ticket' }, secret, { expiresIn: 300 })
        const mismatch = await tryWsConnect(`/note:${NOTE_ID}?access_token=${mismatchToken}`)
        assert('noteId 不匹配拒绝', !mismatch.opened, JSON.stringify(mismatch))

        // 6. 普通用户 JWT（非 room-ticket 类型）拒绝
        const userToken = jwtLib.sign({ sub: 'user-a', email: 'a@example.com' }, secret, { expiresIn: 3600 })
        const userConn = await tryWsConnect(`/note:${NOTE_ID}?access_token=${userToken}`)
        assert('普通 JWT 拒绝（非 room-ticket）', !userConn.opened, JSON.stringify(userConn))

        // 7. 有效 room ticket 连接成功
        const goodConn = await tryWsConnect(`/note:${NOTE_ID}?access_token=${token}`)
        assert('有效 room ticket 连接成功', goodConn.opened, JSON.stringify(goodConn))
    } else {
        console.log('[SKIP] JWT_SECRET not set, skipping token-based tests')
    }

    console.log(`\n结果: ${passed} passed, ${failed} failed`)
    process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
