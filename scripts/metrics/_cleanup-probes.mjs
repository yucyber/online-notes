// 清理测量探针在真实库中留下的会话/消息（按探测时间窗 + 标题特征精确定位）
import { MongoClient, dotenv } from './_deps.mjs'
dotenv.config({ path: 'notes-backend/.env' })
const { Types } = (await import('node:module')).createRequire(new URL('../../notes-backend/package.json', import.meta.url))('mongoose')
const IDS = ['6aa2773f9582ee0df56f8a70', '6aa276c99582ee0df56f89e8'] // 本次测量探针创建的会话
const client = await MongoClient.connect(process.env.MONGODB_URI)
const db = client.db('test')
let msgTotal = 0, convTotal = 0
for (const id of IDS) {
  const oid = new Types.ObjectId(id)
  const m = await db.collection('assistant_messages').deleteMany({ conversationId: oid })
  const c = await db.collection('assistant_conversations').deleteMany({ _id: oid })
  msgTotal += m.deletedCount; convTotal += c.deletedCount
  console.log(id, '| messages deleted:', m.deletedCount, '| conversations deleted:', c.deletedCount)
}
// 校验：这些会话已不存在
for (const id of IDS) {
  const oid = new Types.ObjectId(id)
  console.log(id, 'remaining conv:', await db.collection('assistant_conversations').countDocuments({ _id: oid }),
    'remaining msgs:', await db.collection('assistant_messages').countDocuments({ conversationId: oid }))
}
console.log('TOTAL messages deleted:', msgTotal, '| conversations deleted:', convTotal)
await client.close()
