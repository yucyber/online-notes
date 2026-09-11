const { MongoClient } = require('mongodb')
require('dotenv').config({ path: 'notes-backend/.env' })
;(async () => {
  const c = await MongoClient.connect(process.env.MONGODB_URI)
  const col = c.db('test').collection('ai_runs')
  const since = new Date('2026-09-10T09:22:00.000Z') // 本会话测量探针开始时间
  const probeRuns = await col.countDocuments({ createdAt: { $gte: since } })
  const total = await col.countDocuments()
  console.log('total ai_runs:', total, '| created during measurement session:', probeRuns)
  const byGraph = await col.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$graphName', n: { $sum: 1 } } }]).toArray()
  console.log('probe runs by graphName:', byGraph.map((g) => `${g._id}:${g.n}`).join(' '))
  await c.close()
})()
