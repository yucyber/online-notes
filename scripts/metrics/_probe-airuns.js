const { MongoClient } = require('mongodb')
require('dotenv').config({ path: 'notes-backend/.env' })
;(async () => {
  const c = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
  const col = c.db('notes').collection('ai_runs')
  console.log('total ai_runs:', await col.countDocuments())
  const agg = await col.aggregate([
    { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, status: '$status' }, n: { $sum: 1 } } },
    { $sort: { '_id.d': 1 } },
  ]).toArray()
  console.log('by day/status:')
  for (const r of agg) console.log('  ', r._id.d, r._id.status, r.n)
  const tasks = await col.aggregate([{ $group: { _id: '$task', n: { $sum: 1 }, fb: { $sum: { $cond: ['$fallbackUsed', 1, 0] } } } }, { $sort: { n: -1 } }]).toArray()
  console.log('by task:', tasks.map((t) => `${t._id}:${t.n}(fb${t.fb})`).join(' '))
  const withDur = await col.countDocuments({ durationMs: { $type: 'number' } })
  console.log('with numeric durationMs:', withDur)
  const g = await col.aggregate([{ $group: { _id: '$graphName', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray()
  console.log('by graphName:', g.map((x) => `${x._id}:${x.n}`).join(' '))
  await c.close()
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
