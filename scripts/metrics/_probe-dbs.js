const { MongoClient } = require('mongodb')
require('dotenv').config({ path: 'notes-backend/.env' })
const uri = process.env.MONGODB_URI
console.log('db from uri:', uri.split('/').pop().split('?')[0])
;(async () => {
  const c = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 15000 })
  for (const name of ['notes', 'test', 'sample_mflix']) {
    try {
      const cols = await c.db(name).listCollections().toArray()
      const interesting = ['ai_runs', 'notes', 'assistant_messages', 'users', 'note_chunks', 'assistant_memories', 'organizer_executions']
      const out = []
      for (const col of cols.filter((x) => interesting.includes(x.name))) {
        out.push(`${col.name}=${await c.db(name).collection(col.name).countDocuments()}`)
      }
      console.log(`[${name}] collections=${cols.length} :: ${out.join(' ')}`)
    } catch (e) { console.log(`[${name}] ERR ${e.message}`) }
  }
  await c.close()
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
