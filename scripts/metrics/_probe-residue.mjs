import { MongoClient, dotenv } from './_deps.mjs'
dotenv.config({ path: 'notes-backend/.env' })
const c = await MongoClient.connect(process.env.MONGODB_URI)
const db = c.db('test')
const msgs = await db.collection('assistant_messages').find({ requestId: /^probe-/ }).project({ requestId: 1, role: 1, conversationId: 1, createdAt: 1 }).toArray()
console.log('probe messages:', msgs.length)
const byReq = {}
for (const m of msgs) { byReq[m.requestId] = (byReq[m.requestId] || []).concat(m.role) }
for (const [k, v] of Object.entries(byReq)) console.log(' ', k, '|', v.join(','), '| conv:', String(msgs.find((m) => m.requestId === k).conversationId), '|', msgs.find((m) => m.requestId === k).createdAt?.toISOString())
const convs = await db.collection('assistant_conversations').find({ title: /^用一句话|__metrics/ }).project({ title: 1, status: 1, createdAt: 1, messageCount: 1 }).toArray()
console.log('candidate conversations:', convs.length)
for (const c2 of convs) console.log(' ', String(c2._id), '|', String(c2.title).slice(0, 20), '| status:', c2.status, '| msgs:', c2.messageCount, '|', c2.createdAt?.toISOString())
await c.close()
