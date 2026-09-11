import { WebSocket, dotenv } from './_deps.mjs'
import { pickUser, mintToken } from './_auth.mjs'
dotenv.config({ path: 'notes-backend/.env' })
const { user, close } = await pickUser()
const token = mintToken(user)
for (const path of [`/ws?access_token=${token}`, '/ws', `/ws?access_token=bad`]) {
  await new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:3001${path}`)
    const t = setTimeout(() => { console.log(path.slice(0, 30), '→ TIMEOUT readyState', ws.readyState); try { ws.terminate() } catch {}; res() }, 6000)
    ws.on('open', () => console.log(path.slice(0, 30), '→ OPEN'))
    ws.on('message', (d) => { console.log('   msg:', d.toString().slice(0, 120)); clearTimeout(t); ws.close(); res() })
    ws.on('unexpected-response', (_q, r) => { console.log(path.slice(0, 30), '→ HTTP', r.statusCode); clearTimeout(t); res() })
    ws.on('error', (e) => { console.log(path.slice(0, 30), '→ ERR', e.message); clearTimeout(t); res() })
  })
}
await close()
