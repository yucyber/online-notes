
const WebSocket = require('ws')
const http = require('http')
const setupWSConnection = require('y-websocket/bin/utils').setupWSConnection

const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('okay')
})

const wss = new WebSocket.Server({ noServer: true })

wss.on('connection', (conn, req) => {
    console.log('Connection established from', req.socket.remoteAddress)

    // 简单的存活检测
    conn.isAlive = true
    conn.on('pong', () => { conn.isAlive = true })

    try {
        setupWSConnection(conn, req, { gc: true })
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

// 30秒心跳检测，清除死连接
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate()
        ws.isAlive = false
        ws.ping()
    })
}, 30000)

wss.on('close', () => {
    clearInterval(interval)
})


server.on('upgrade', (request, socket, head) => {
    // You may check auth here if needed
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
    })
})

const port = process.env.PORT || 1234
server.listen(port, () => {
    console.log(`listening on port ${port}`)
})
