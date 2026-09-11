const { MongoClient } = require('mongodb')
require('dotenv').config({ path: 'notes-backend/.env' })
;(async () => {
  const c = await MongoClient.connect(process.env.MONGODB_URI)
  for (const [db, col] of [['test', 'assistant_messages'], ['test', 'organizer_executions']]) {
    const idx = await c.db(db).collection(col).indexes()
    console.log(`\n[${db}.${col}]`)
    for (const i of idx) console.log(' ', i.name, '| unique:', !!i.unique, '| partial:', JSON.stringify(i.partialFilterExpression || null), '| key:', JSON.stringify(i.key))
  }
  await c.close()
})()
