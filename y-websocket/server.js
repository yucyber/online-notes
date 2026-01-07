
const WebSocket = require('ws')
const http = require('http')
const jwt = require('jsonwebtoken')
const utils = require('y-websocket/bin/utils')
const setupWSConnection = utils.setupWSConnection
const docs = utils.docs

const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('okay')
})

const wss = new WebSocket.Server({ noServer: true })

wss.on('connection', (conn, req) => {
    console.log('Connection established from', req.socket.remoteAddress)
    console.log('Request URL:', req.url)

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
        setupWSConnection(conn, req, { gc: true })

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

    conn.on('close', (code, reason) => {
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


server.on('upgrade', (request, socket, head) => {
    // Auth: validate JWT in query param before upgrading to WebSocket
    // Frontend passes it via WebsocketProvider({ params: { access_token } })
    try {
        const url = new URL(request.url, 'http://localhost')
        const token = url.searchParams.get('access_token') || url.searchParams.get('token')
        const authDisabled = String(process.env.YWS_AUTH_DISABLED || '').toLowerCase() === '1'
        const secret = process.env.YWS_JWT_SECRET || process.env.JWT_SECRET

        if (!authDisabled) {
            if (!token) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
                socket.destroy()
                return
            }
            if (!secret) {
                console.error('[Auth] Missing JWT secret. Set YWS_JWT_SECRET or JWT_SECRET.')
                socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
                socket.destroy()
                return
            }
            const payload = jwt.verify(token, secret)
            request.user = payload
        }
    } catch (e) {
        try {
            console.warn('[Auth] JWT verify failed:', e && e.message ? e.message : e)
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
            socket.destroy()
        } catch { }
        return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
    })
})

const port = process.env.PORT || 1234
server.listen(port, () => {
    console.log(`listening on port ${port}`)
})
