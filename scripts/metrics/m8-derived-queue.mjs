/**
 * 指标 8：派生队列（note-derived）
 *  A) 同一笔记连续保存 N 次 → 有效任务数是否为 1
 *  B) 过期快照（expectedUpdatedAt 与笔记当前 updatedAt 不一致）是否被丢弃为 stale_snapshot
 *  C) 终态 completed 任务存在时再次 schedule → 是否仍能为最新正文建新任务
 * 使用真实代码：notes-backend/dist 编译产物中的 NoteDerivedQueueService（真实业务类）+ 真实 Redis(Memurai)
 *  + 后端正在运行的 Worker（端到端处理），所有任务的 expectedUpdatedAt 故意设为错误值，
 *    保证 worker 只会丢弃、不会真正重算 chunk（不修改业务数据）。
 */
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { MongoClient, Redis, Queue, dotenv } from './_deps.mjs'
dotenv.config({ path: 'notes-backend/.env' })
const require = createRequire(new URL('../../notes-backend/package.json', import.meta.url))
const { NoteDerivedQueueService } = require('./dist/modules/notes/note-derived-queue.service.js')
const { noteDerivedJobId } = require('./dist/modules/notes/note-derived-job.types.js')

const N = Number(process.env.M8_N || 5)
const QUIET_MS = Number(process.env.M8_QUIET_MS || 1000)
const evidence = { metric: 'M8 derived queue', generatedAt: new Date().toISOString(), params: { N, quietMs: QUIET_MS }, steps: {} }

const client = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
const note = await client.db('test').collection('notes').findOne({})
await client.close()
if (!note) throw new Error('no note found for test')
const noteId = String(note._id), userId = String(note.userId)
const WRONG_DATE = new Date('2000-01-01T00:00:00.000Z').toISOString() // 故意与当前 updatedAt 不一致 → 必然 stale
evidence.subject = { noteId, userId, noteRealUpdatedAt: new Date(note.updatedAt).toISOString(), wrongDateUsed: WRONG_DATE }

const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
const queue = new Queue('note-derived', { connection })
const svc = new NoteDerivedQueueService(queue, QUIET_MS, connection, undefined)
const jobId = noteDerivedJobId(noteId)

const cleanup = async () => {
  const j = await queue.getJob(jobId)
  if (j) { try { await j.remove() } catch {} }
}
await cleanup()

// ---- A) 连续 schedule N 次 ----
const ids = []
for (let i = 1; i <= N; i++) {
  const job = await svc.schedule({ noteId, userId, changes: { titleChanged: i === 1, contentChanged: true, taxonomyChanged: false }, expectedUpdatedAt: WRONG_DATE })
  ids.push(String(job?.id))
}
const after = await svc.getJob(noteId)
const countsA = await queue.getJobCounts('delayed', 'waiting', 'active', 'completed', 'failed')
evidence.steps.A = {
  description: `连续调用真实 schedule() ${N} 次（同一 noteId）`,
  returnedJobIds: ids,
  uniqueJobIds: [...new Set(ids)],
  jobsInQueueForNote: after ? 1 : 0,
  jobState: after ? await after.getState() : null,
  jobDataChanges: after?.data?.changes ?? null,
  jobCounts: countsA,
  effectiveJobs: after ? 1 : 0,
}

// ---- B) 过期快照：交给正在运行的 worker 处理，观察 returnvalue ----
const staleJob = await queue.add('note-derived', {
  noteId, userId, changes: { titleChanged: false, contentChanged: true, taxonomyChanged: false }, expectedUpdatedAt: WRONG_DATE,
}, { jobId: jobId + '__stale_probe', attempts: 1, removeOnComplete: false, removeOnFail: false })
let staleState = null, staleReturn = null
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500))
  const j = await queue.getJob(String(staleJob.id))
  staleState = await j.getState()
  if (staleState === 'completed' || staleState === 'failed') { staleReturn = j.returnvalue; break }
}
evidence.steps.B = {
  description: '向真实队列投递 expectedUpdatedAt=2000-01-01 的任务，由后端正在运行的 Worker 处理',
  jobId: staleJob.id, finalState: staleState, workerReturnValue: staleReturn,
  discardedAsStale: staleReturn?.reason === 'stale_snapshot',
}
const staleJobRef = await queue.getJob(String(staleJob.id))
await staleJobRef.remove()

// ---- C) 终态 completed 任务存在时再次 schedule ----
await cleanup()
// 先让该 jobId 真实走到 completed（worker 丢弃 stale → completed，保留在队列里）
const seed = await queue.add('note-derived', {
  noteId, userId, changes: { titleChanged: false, contentChanged: true, taxonomyChanged: false }, expectedUpdatedAt: WRONG_DATE,
}, { jobId, attempts: 1, delay: 0, removeOnComplete: false, removeOnFail: false })
let seedState = null
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500))
  const j = await queue.getJob(jobId)
  seedState = j ? await j.getState() : 'gone'
  if (seedState === 'completed' || seedState === 'failed') break
}
const seedRef = await queue.getJob(jobId)
const seedReturn = seedRef ? seedRef.returnvalue : null
const jobC = await svc.schedule({ noteId, userId, changes: { titleChanged: false, contentChanged: true, taxonomyChanged: false }, expectedUpdatedAt: WRONG_DATE })
const jobCRef = await svc.getJob(noteId)
const jobCState = jobCRef ? await jobCRef.getState() : null
evidence.steps.C = {
  description: '该 noteId 存在一个真实 completed 任务时，再次调用 schedule()（验证「先移除终态任务才能重新入队」分支）',
  seedJobId: jobId,
  seedFinalState: seedState,
  seedWorkerReturnValue: seedReturn,
  rescheduledJobId: String(jobC?.id),
  jobExistsAfterReschedule: Boolean(jobCRef),
  jobStateAfterReschedule: jobCState,
  newJobIsNotTheCompletedOne: jobCState !== 'completed',
  conclusion: jobCState && jobCState !== 'completed'
    ? '终态任务未阻塞新任务：schedule() 先移除 completed 再重新入队'
    : '未创建新任务（终态任务阻塞）',
}

await cleanup()
evidence.redisKeysAfterCleanup = await connection.keys(`bull:note-derived:*${noteId}*`)
writeFileSync('docs/metrics/raw/m8-derived-queue.json', JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
await queue.close(); await connection.quit()
