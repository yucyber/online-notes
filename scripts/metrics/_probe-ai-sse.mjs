// 探测：真实 AI SSE 是否可用（决定指标 3/4 能否实测）
import { pickUser, mintToken, API } from './_auth.mjs'
const { user, close } = await pickUser()
const token = mintToken(user)
const requestId = `probe-ai-${Date.now()}`
const t0 = Date.now()
const res = await fetch(`${API}/assistant/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ requestId, question: '用一句话说明什么是笔记', forceRoute: 'pet' }),
})
console.log('HTTP', res.status, 'content-type:', res.headers.get('content-type'))
const events = []
const reader = res.body.getReader()
const dec = new TextDecoder()
let buf = ''
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  const parts = buf.split('\n\n')
  buf = parts.pop()
  for (const p of parts) {
    const ev = /event: (.+)/.exec(p)?.[1]
    if (ev) events.push({ ev, t: Date.now() - t0, len: p.length })
  }
}
console.log('total ms:', Date.now() - t0)
console.log('event types:', events.map((e) => e.ev).join('>'))
console.log('event count:', events.length)
console.log('first delta t:', events.find((e) => e.ev === 'delta')?.t, 'ms')
await close()
