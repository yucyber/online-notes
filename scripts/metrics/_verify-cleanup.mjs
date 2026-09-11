import { MongoClient, Redis, dotenv } from './_deps.mjs'
dotenv.config({ path: 'notes-backend/.env' })
const c = await MongoClient.connect(process.env.MONGODB_URI)
const db = c.db('test')
const res = {
  notesWithProbeTitle: await db.collection('notes').countDocuments({ title: /__metrics_probe_/ }),
  assistantMessagesWithProbeReq: await db.collection('assistant_messages').countDocuments({ requestId: /^probe-/ }),
  conversationsWithProbeTitle: await db.collection('assistant_conversations').countDocuments({ title: /__metrics_probe_|用一句话/ }),
  aiRunsTotal: await db.collection('ai_runs').countDocuments(),
  usersTotal: await db.collection('users').countDocuments(),
}
const r = new Redis(process.env.REDIS_URL)
const keys = await r.keys('*')
const interesting = keys.filter((k) => /idempotency|ws:|note-derived:lock|diag/.test(k))
console.log('DB residue:', JSON.stringify(res))
console.log('Redis total keys:', keys.length, '| interesting leftovers:', JSON.stringify(interesting))
console.log('bull:note-derived counts:', JSON.stringify(await r.hgetall('bull:note-derived:meta')))
const counts = {}
for (const st of ['wait', 'active', 'delayed', 'completed', 'failed']) counts[st] = await r.zcard(`bull:note-derived:${st}`)
console.log('bull queue zcards:', JSON.stringify(counts))
await r.quit(); await c.close()
