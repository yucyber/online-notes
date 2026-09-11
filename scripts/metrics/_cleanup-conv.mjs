import { MongoClient, dotenv } from './_deps.mjs'
dotenv.config({ path: 'notes-backend/.env' })
const { Types } = (await import('node:module')).createRequire(new URL('../../notes-backend/package.json', import.meta.url))('mongoose')
const client = await MongoClient.connect(process.env.MONGODB_URI)
const col = client.db('test').collection('assistant_conversations')
const docs = await col.find({ 'title': { $exists: true } }).sort({ createdAt: -1 }).limit(3).toArray()
for (const d of docs) console.log(String(d._id), '| status:', d.status, '| title:', String(d.title).slice(0, 30), '| createdAt:', d.createdAt?.toISOString(), '| msgCount:', d.messageCount)
await client.close()
