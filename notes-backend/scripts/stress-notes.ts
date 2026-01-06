import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { URL } from 'url'

type Sample = { ms: number; status: number }

const API = process.env.API_URL || 'http://localhost:3001/api'
const TOKEN = process.env.TOKEN || ''
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '50', 10)
const REQUESTS = parseInt(process.env.REQUESTS || '500', 10)

function p95(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil(0.95 * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]
}

function doGet(u: URL): Promise<{ status: number, body?: any }> {
  return new Promise((resolve) => {
    const isHttps = u.protocol === 'https:'
    const req = (isHttps ? httpsRequest : httpRequest)({
      hostname: u.hostname,
      port: u.port ? Number(u.port) : (isHttps ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => {
        let body
        try { body = JSON.parse(data) } catch { }
        resolve({ status: res.statusCode || 0, body })
      })
    })
    req.on('error', () => resolve({ status: 0 }))
    req.setTimeout(3000, () => { try { req.destroy() } catch { } })
    req.end()
  })
}

async function runOnce(): Promise<Sample & { body?: any }> {
  const start = Date.now()
  const u = new URL(`${API}/notes`)
  u.searchParams.set('keyword', 'markdown')
  u.searchParams.set('page', '1')
  u.searchParams.set('size', '10')
  const resp = await doGet(u)
  return { ms: Date.now() - start, status: resp.status, body: resp.body }
}

async function main() {
  console.log(`Target: ${API}/notes | concurrency=${CONCURRENCY} | total=${REQUESTS}`)

  // Run one request first to check connectivity and auth
  console.log('Running initial probe request...')
  const probe = await runOnce()
  console.log(`Probe result: status=${probe.status}, latency=${probe.ms}ms`)
  if (probe.body && probe.body._debug) {
    console.log('Debug Info:', JSON.stringify(probe.body._debug, null, 2))
  }

  console.log('Running second probe request (check cache hit)...')
  const probe2 = await runOnce()
  console.log(`Probe 2 result: status=${probe2.status}, latency=${probe2.ms}ms`)
  if (probe2.body && probe2.body._debug) {
    console.log('Debug Info 2:', JSON.stringify(probe2.body._debug, null, 2))
  }

  if (probe.status >= 400) {
    console.error('Probe failed. Check token or API URL.')
    process.exit(1)
  }

  const durations: number[] = []
  let errors = 0
  const pool: Promise<void>[] = []

  let inFlight = 0
  async function enqueue() {
    if (durations.length + inFlight >= REQUESTS) return
    inFlight++
    const res = await runOnce()
    durations.push(res.ms)
    if (res.status < 200 || res.status >= 300) errors++
    inFlight--
    await enqueue()
  }

  for (let i = 0; i < CONCURRENCY; i++) pool.push(enqueue())
  await Promise.all(pool)

  const avg = durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length)
  const p95v = p95(durations)
  console.log(JSON.stringify({ count: durations.length, avgMs: avg, p95Ms: p95v, errors }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
