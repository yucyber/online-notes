import { Redis, dotenv } from './_deps.mjs'
dotenv.config({ path: 'notes-backend/.env' })
const r = new Redis(process.env.REDIS_URL)
const keys = await r.keys('*')
const cap = keys.filter((k) => /cap|capacity|ai:/.test(k))
console.log('capacity-ish keys:', cap.length)
for (const k of cap) {
  const type = await r.type(k)
  let val
  if (type === 'zset') val = JSON.stringify(await r.zrange(k, 0, -1, 'WITHSCORES'))
  else if (type === 'string') val = await r.get(k)
  else val = type
  console.log(' ', k, '|', type, '| ttl:', await r.ttl(k), '|', String(val).slice(0, 200))
}
await r.quit()
