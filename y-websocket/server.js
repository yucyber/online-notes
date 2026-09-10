
const WebSocket = require('ws')
const http = require('http')
const jwt = require('jsonwebtoken')
const utils = require('y-websocket/bin/utils')
const { redactRequestUrl } = require('./url-utils')
const { installReadOnlyGuard } = require('./read-only')
const { authorizeUpgrade, isAuthDisabled, resolveJwtSecret } = require('./room-auth')
const setupWSConnection = utils.setupWSConnection
const docs = utils.docs

const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('okay')
})

const wss = new WebSocket.Server({ noServer: true })

wss.on('connection', (conn, req) => {
    console.log('Connection established from', req.socket.remoteAddress)
    console.log('Request URL:', redactRequestUrl(req.url))

    // 简单的存活检测
    conn.isAlive = true
    conn.on('pong', () => { conn.isAlive = true })

    // 拦截发送方法以添加日志
    const originalSend = conn.send
    conn.send = function (data, options, callback) {
        try {
            // data 可能是 Buffer, ArrayBuffer 或 string
            let len = 0
            let type = '?'
            if (Buffer.isBuffer(data)) {
                len = data.length
                type = data[0]
            } else if (data instanceof Uint8Array) {
                len = data.byteLength
                type = data[0]
            }
            // 过滤掉太频繁的心跳或小包日志，避免刷屏，但保留关键的 Sync(0) 和 Awareness(1)
            if (type !== '?' && (type === 0 || type === 1)) {
                console.log(`[Msg] Sending type=${type} len=${len} to ${req.socket.remoteAddress}`)
            }
        } catch (e) { }
        return originalSend.call(this, data, options, callback)
    }

    try {
        const restoreConnectionHandler = installReadOnlyGuard(conn, req.user?.role)
        setupWSConnection(conn, req, { gc: true })
        restoreConnectionHandler()

        // 监听消息接收，确认数据流
        conn.on('message', (message) => {
            conn.isAlive = true
            try {
                // 简单的二进制消息解析日志
                const arr = new Uint8Array(message)
                const msgType = arr[0] // 0: Sync, 1: Awareness, 2: Auth
                const length = arr.length
                console.log(`[Msg] Received type=${msgType} len=${length} from ${req.socket.remoteAddress}`)
            } catch (e) { }
        })

        // 延迟检查房间状态，确认是否正确加入
        setTimeout(() => {
            try {
                // y-websocket 通常将 URL 路径作为文档名（去掉开头的 /）
                const docName = req.url.slice(1).split('?')[0]
                if (docs.has(docName)) {
                    const doc = docs.get(docName)
                    console.log(`[Room Check] Doc '${docName}' has ${doc.conns.size} clients. Conns:`, [...doc.conns.keys()].length)
                } else {
                    console.warn(`[Room Check] Doc '${docName}' NOT found in memory! Available docs:`, [...docs.keys()])
                }
            } catch (err) {
                console.error('[Room Check] Error inspecting docs:', err)
            }
        }, 500)

    } catch (e) {
        console.error('Error setting up WS connection:', e)
    }

    // y-websocket 浏览器端每 30 秒检查“是否收到过任何业务消息”，
    // 只发 ping/pong 控制帧不会刷新它，会导致单人或少量协作者时连接被客户端主动断开（1005）。
    // 这里每 20 秒向客户端发一条 awareness query（type=3），客户端会回 awareness，
    // 从而让 wsLastMessageReceived 持续刷新，连接不再被误判为假死。
    const collabKeepAlive = setInterval(() => {
        if (conn.readyState === WebSocket.OPEN) {
            try {
                conn.send(new Uint8Array([3]))
            } catch (e) {
                // 连接可能刚关闭，忽略
            }
        }
    }, 20000)

    conn.on('close', (code, reason) => {
        clearInterval(collabKeepAlive)
        console.log('Connection closed', code, reason ? reason.toString() : '')
    })
    conn.on('error', (err) => {
        console.error('Connection error', err)
    })
})

// 30秒心跳检测，保持连接活跃 (Keep-Alive)
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        // 即使 isAlive 为 false，也不再主动 terminate，避免因网络波动误杀
        // if (ws.isAlive === false) return ws.terminate()

        ws.isAlive = false
        try {
            ws.ping()
        } catch (e) {
            // 只有在 ping 失败（连接已物理断开）时才移除
            // ws.terminate() 
        }
    })
}, 20000) // 延长到 20s，减少网络开销

wss.on('close', () => {
    clearInterval(interval)
})


// 启动自检：鉴权开启却没有可用 secret 时直接失败，避免每个连接都退化成 500。
if (!isAuthDisabled() && !resolveJwtSecret()) {
    console.error('[Auth] Missing JWT secret (YWS_JWT_SECRET or JWT_SECRET). Refusing to start.')
    process.exit(1)
}

let authDisabledWarned = false

server.on('upgrade', (request, socket, head) => {
    // Auth: 校验 query 参数里的 room-ticket JWT，并把票据绑定到房间后再放行升级。
    // 判定逻辑集中在 room-auth.js（纯函数，有单测覆盖）。
    const decision = authorizeUpgrade({
        rawUrl: request.url,
        secret: resolveJwtSecret(),
        authDisabled: isAuthDisabled(),
    })

    if (!decision.ok) {
        console.warn(
            `[Auth] rejected (${decision.reason}) room=${decision.room || '-'} url=${redactRequestUrl(request.url)}`,
        )
        const statusText = decision.status === 500 ? 'Internal Server Error' : 'Unauthorized'
        try {
            const crlf = String.fromCharCode(13, 10)
            socket.write(`HTTP/1.1 ${decision.status} ${statusText}${crlf}${crlf}`)
            socket.destroy()
        } catch { }
        return
    }

    if (decision.reason === 'auth-disabled' && !authDisabledWarned) {
        authDisabledWarned = true
        console.warn('[Auth] YWS_AUTH_DISABLED=1 — 已跳过全部鉴权（仅非生产环境可用，请勿用于线上）')
    }

    // read-only 守卫按 req.user.role 判定，因此必须把票据 payload 挂到 request 上
    if (decision.user) request.user = decision.user

    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
    })
})

const port = process.env.PORT || 1234
server.listen(port, () => {
    console.log(`listening on port ${port}`)
})
