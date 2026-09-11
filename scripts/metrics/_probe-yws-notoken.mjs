// 探针：不带 token 连一个房间，打印 accepted/rejected（用于验证 YWS_AUTH_DISABLED 语义）
import { WebSocket } from './_deps.mjs'
const port = Number(process.argv[2] || 1234)
const room = process.argv[3] || 'note:68c1f0aabbccddeeff001122'
const ws = new WebSocket(`ws://127.0.0.1:${port}/${room}`)
const done = (v) => { console.log(v); try { ws.terminate() } catch {} ; process.exit(0) }
ws.on('open', () => done('accepted'))
ws.on('unexpected-response', (_q, res) => done(`rejected ${res.statusCode}`))
ws.on('error', (e) => done(`rejected error:${e?.message}`))
setTimeout(() => done('timeout'), 5000)
