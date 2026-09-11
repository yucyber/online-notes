/**
 * 指标 9：AI 运行指标导出（requestCount / successRate / fallbackRate / p50 / p95）
 * 数据源：Atlas ai_runs 集合（app 实际使用的 db）
 * 百分位定义与后端 AiRunService.percentile 一致：sorted[ceil(p*n)-1]（nearest-rank）；
 * 另附 linear interpolation 定义做对照。
 * 用法：node scripts/metrics/m9-ai-run-metrics.mjs [--days=30] [--from=ISO] [--to=ISO]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { MongoClient, dotenv } from './_deps.mjs'
dotenv.config({ path: 'notes-backend/.env' })

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const DB = args.db || 'test' // MONGODB_URI 无 db 段，驱动默认 test

function nearestRank(values, p) {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.max(0, Math.ceil(p * s.length) - 1)]
}
function linearInterp(values, p) {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const idx = (s.length - 1) * p
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo)
}
const rate = (n, d) => (d === 0 ? 0 : n / d)
const nun = (v) => typeof v === 'number' && Number.isFinite(v)

const summarize = (docs) => {
  const durations = docs.map((d) => d.durationMs).filter(nun)
  return {
    requestCount: docs.length,
    succeeded: docs.filter((d) => d.status === 'succeeded').length,
    failed: docs.filter((d) => d.status === 'failed').length,
    running: docs.filter((d) => d.status === 'running').length,
    successRate: rate(docs.filter((d) => d.status === 'succeeded').length, docs.length),
    fallbackUsed: docs.filter((d) => d.fallbackUsed === true).length,
    fallbackRate: rate(docs.filter((d) => d.fallbackUsed === true).length, docs.length),
    durationSamples: durations.length,
    p50Ms_nearestRank: nearestRank(durations, 0.5),
    p95Ms_nearestRank: nearestRank(durations, 0.95),
    p50Ms_linear: Math.round(linearInterp(durations, 0.5) * 100) / 100,
    p95Ms_linear: Math.round(linearInterp(durations, 0.95) * 100) / 100,
    maxMs: durations.length ? Math.max(...durations) : 0,
    minMs: durations.length ? Math.min(...durations) : 0,
  }
}

const uri = process.env.MONGODB_URI
const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 15000 })
try {
  const col = client.db(DB).collection('ai_runs')
  const to = args.to ? new Date(args.to) : new Date()
  const from = args.from
    ? new Date(args.from)
    : new Date(to.getTime() - Number(args.days || 30) * 24 * 3600 * 1000)

  const filter = { createdAt: { $gte: from, $lte: to } }
  const docs = await col.find(filter).toArray()
  const all = await col.find({}).toArray()

  const byDayMap = new Map()
  for (const d of all) {
    const day = new Date(d.createdAt).toISOString().slice(0, 10)
    byDayMap.set(day, [...(byDayMap.get(day) || []), d])
  }
  const byTaskMap = new Map()
  for (const d of docs) byTaskMap.set(d.task || 'unknown', [...(byTaskMap.get(d.task || 'unknown') || []), d])
  const byGraphMap = new Map()
  for (const d of docs) byGraphMap.set(d.graphName || 'unknown', [...(byGraphMap.get(d.graphName || 'unknown') || []), d])

  const out = {
    metric: 'M9 AI run metrics',
    generatedAt: new Date().toISOString(),
    source: { collection: `${DB}.ai_runs`, uriHost: uri.replace(/\/\/[^@]*@/, '//***@').replace(/\?.*$/, '') },
    window: { from: from.toISOString(), to: to.toISOString(), days: (to - from) / 86400000 },
    overall: summarize(docs),
    byTask: Object.fromEntries([...byTaskMap.entries()].sort().map(([k, v]) => [k, summarize(v)])),
    byGraphName: Object.fromEntries([...byGraphMap.entries()].sort().map(([k, v]) => [k, summarize(v)])),
    dailyAllTime: Object.fromEntries([...byDayMap.entries()].sort().map(([k, v]) => [k, summarize(v)])),
    allTime: summarize(all),
  }
  mkdirSync('docs/metrics/raw', { recursive: true })
  const file = args.out || 'docs/metrics/raw/m9-ai-run-metrics.json'
  writeFileSync(file, JSON.stringify(out, null, 2))
  console.log('window:', out.window.from, '→', out.window.to)
  console.log('overall:', JSON.stringify(out.overall))
  console.log('byTask:', Object.entries(out.byTask).map(([k, v]) => `${k}: n=${v.requestCount} succ=${v.successRate.toFixed(3)} fb=${v.fallbackRate.toFixed(3)} p50=${v.p50Ms_nearestRank} p95=${v.p95Ms_nearestRank}`).join('\n         '))
  console.log('written:', file)
} finally { await client.close() }
