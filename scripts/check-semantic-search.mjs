#!/usr/bin/env node
// 诊断后端语义搜索链路是否正常。
// 覆盖三层：
//   1) embedding 供应商（SiliconFlow Qwen）能否为查询词生成向量，并报告维度；
//   2) /api/v1/semantic/search 在 vector/hybrid/keyword 三种模式下的召回结果；
//   3) （--with-db）MongoDB 里笔记的 embedding 覆盖率 + 向量索引 vector_index 是否存在、维度是否正确。
// 不写任何数据，只读 + 调用查询接口。

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const root = process.cwd()

// ---------------- 参数解析 ----------------
function readArgs(argv) {
  const args = { query: '计算机', timeoutMs: 30000, withDb: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--base-url') args.baseUrl = next()
    else if (a === '--token') args.token = next()
    else if (a === '--email') args.email = next()
    else if (a === '--password') args.password = next()
    else if (a === '--query') args.query = next()
    else if (a === '--timeout') args.timeoutMs = Number(next())
    else if (a === '--with-db' || a === '--db') args.withDb = true
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

function printHelp() {
  console.log(`用法: node scripts/check-semantic-search.mjs [选项]

选项:
  --base-url <url>      后端 API 前缀，默认 http://localhost:3001/api
  --query <text>        查询词，默认 "计算机"
  --token <jwt>         直接提供 Bearer token（跳过登录）
  --email <email>       登录邮箱（与 --password 一起用来自动换取 token）
  --password <pwd>      登录密码
  --with-db             额外连接 MongoDB，检查 embedding 覆盖率与向量索引
  --timeout <ms>        单请求超时，默认 30000
`)
}

// ---------------- 环境变量读取 ----------------
function parseEnvFile(path) {
  if (!existsSync(path)) return {}
  const env = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let value = m[2] ?? ''
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[m[1]] = value
  }
  return env
}

function collectEnv() {
  const merged = {}
  // 顺序很重要：先读 .env.example（占位符兜底），再读 .env（真实值覆盖占位符），
  // 最后用 process.env 覆盖，保证真实配置优先级最高。
  for (const rel of ['notes-backend/.env.example', 'notes-backend/.env']) {
    Object.assign(merged, parseEnvFile(resolve(root, rel)))
  }
  Object.assign(merged, process.env)
  return merged
}

function configured(value) {
  return Boolean(value) && !/^(your_|change-me|example|placeholder|xxx|test)/i.test(String(value || ''))
}

function mask(value) {
  if (!value) return '<missing>'
  if (!configured(value)) return '<placeholder>'
  return `<configured:${value.length}>`
}

// ---------------- HTTP 辅助 ----------------
async function request(url, { method = 'GET', headers = {}, body, timeoutMs }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const text = await response.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { status: response.status, headers: response.headers, data }
  } catch (error) {
    // 网络层失败（连接拒绝/DNS/超时）也返回结构化结果，避免脚本直接崩溃
    const reason = error?.name === 'AbortError' ? '请求超时' : (error?.cause?.code || error?.message || String(error))
    return { status: 0, headers: { get: () => null }, data: null, error: reason }
  } finally {
    clearTimeout(timer)
  }
}

// 后端响应统一包：{ code, message, data, requestId, timestamp }
function unwrap(payload) {
  if (payload && typeof payload === 'object' && 'code' in payload && 'data' in payload) {
    return { code: payload.code, message: payload.message, data: payload.data }
  }
  return { code: 0, message: 'OK', data: payload }
}

// ---------------- 检查 1：embedding 供应商 ----------------
async function checkEmbedding(env, query, timeoutMs) {
  const baseUrl = env.SILICONFLOW_BASE_URL
  const apiKey = env.SILICONFLOW_API_KEY
  const model = env.SILICONFLOW_EMBEDDING_MODEL
  if (!configured(baseUrl) || !configured(apiKey) || !configured(model)) {
    return { ok: false, reason: 'SILICONFLOW_* 配置缺失或为占位符', dims: 0 }
  }
  const url = `${String(baseUrl).replace(/\/+$/, '')}/embeddings`
  const res = await request(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: { model, input: query },
    timeoutMs,
  })
  if (res.status === 0) return { ok: false, reason: `网络请求失败: ${res.error}`, dims: 0 }
  if (res.status !== 200) {
    const err = res.data?.error?.message || res.data?.message || JSON.stringify(res.data)
    return { ok: false, reason: `HTTP ${res.status}: ${String(err).slice(0, 300)}`, dims: 0 }
  }
  const data = res.data
  const embedding = data?.data?.[0]?.embedding
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return { ok: false, reason: '响应中没有 embedding 向量', dims: 0 }
  }
  return { ok: true, reason: '', dims: embedding.length }
}

// ---------------- 检查 2：获取 token ----------------
async function resolveToken(args, env, baseUrl) {
  if (args.token) return { token: args.token, source: '--token' }
  if (args.email && args.password) {
    const res = await request(`${baseUrl}/auth/login`, {
      method: 'POST',
      body: { email: args.email, password: args.password },
      timeoutMs: args.timeoutMs,
    })
    if (res.status === 0) return { error: `登录请求失败: ${res.error}` }
    const envelope = unwrap(res.data)
    if (res.status !== 200 && res.status !== 201) {
      return { error: `登录失败 HTTP ${res.status}: ${envelope.message || JSON.stringify(res.data)}` }
    }
    const setCookie = res.headers.get('set-cookie') || ''
    const m = setCookie.match(/notes_token=([^;]+)/)
    if (!m) return { error: '登录成功但响应中没有 notes_token cookie' }
    return { token: m[1], source: 'login' }
  }
  const authFile = resolve(root, 'api-test/auth.json')
  if (existsSync(authFile)) {
    try {
      const saved = JSON.parse(readFileSync(authFile, 'utf8'))
      if (saved?.token) return { token: saved.token, source: 'api-test/auth.json（可能已过期）' }
    } catch {}
  }
  return { error: '未提供 token，也无法登录。请用 --token 或 --email/--password。' }
}

// ---------------- 检查 3：语义搜索接口 ----------------
async function searchMode(baseUrl, token, query, mode, timeoutMs) {
  const params = new URLSearchParams({ q: query, mode, limit: '10', page: '1' })
  const res = await request(`${baseUrl}/v1/semantic/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs,
  })
  if (res.status === 0) return { mode, status: 0, error: `网络请求失败: ${res.error}`, total: -1, items: [] }
  const envelope = unwrap(res.data)
  if (res.status !== 200) {
    return { mode, status: res.status, error: envelope.message || JSON.stringify(res.data), total: -1, items: [] }
  }
  const page = envelope.data || {}
  const items = Array.isArray(page.data) ? page.data : []
  return { mode, status, total: Number(page.total ?? 0), items }
}

function formatItem(item) {
  const title = String(item?.title || '').slice(0, 40)
  const score = Number(item?.score || 0).toFixed(4)
  return `    - [${score}] ${title || '(无标题)'}`
}

// ---------------- 检查 4：MongoDB embedding 覆盖与向量索引 ----------------
async function checkDatabase(env) {
  const uri = env.MONGODB_URI
  if (!configured(uri)) return { skipped: 'MONGODB_URI 未配置' }

  let MongoClient
  try {
    const requireFromBackend = createRequire(resolve(root, 'notes-backend/package.json'))
    MongoClient = requireFromBackend('mongodb').MongoClient
  } catch (error) {
    return { skipped: `无法加载 mongodb 驱动: ${error.message}` }
  }

  let dbName = 'test'
  try { dbName = new URL(uri).pathname.replace(/^\//, '').split('/')[0] || 'test' } catch {}

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 })
  try {
    await client.connect()
    // 与后端 Mongoose 行为保持一致：URI 未携带库名时，MongoDB 默认连 "test" 库。
    // 这里用 client.db()（不带名字）而不是手动指定，避免又查错库。
    const db = client.db()
    dbName = db.databaseName
    const coll = db.collection('notes')

    const total = await coll.countDocuments({})
    const withEmbedding = await coll.countDocuments({ embedding: { $exists: true, $not: { $size: 0 } } })

    // 判断集群类型：共享/免费集群（msg=isdbgrid）不支持 Atlas Search，专用集群返回 setName。
    // 用来区分"找不到 Search 页签（免费集群）"与"索引建错了地方/类型"。
    let tier = 'unknown'
    try {
      const hello = await db.admin().command({ hello: 1 })
      tier = hello?.msg === 'isdbgrid'
        ? '共享/免费集群（不支持 Atlas Search）'
        : (hello?.setName ? `专用集群副本集 ${hello.setName}` : 'unknown')
    } catch {}

    // 普通索引里若出现名为 vector_index 的索引，说明在 "Indexes" 页建错了类型：
    // 普通 B-tree 索引 ≠ Atlas Search 向量索引，$vectorSearch 不会使用它。
    let regularIndexNames = []
    try {
      regularIndexNames = (await coll.listIndexes().toArray()).map((i) => i.name)
    } catch {}

    let indexSummary = []
    try {
      const indexes = await coll.listSearchIndexes().toArray()
      indexSummary = indexes.map((idx) => {
        // Atlas Search 索引定义有两种结构，都要兼容：
        //   数组形式：{ fields: [ { type:'vector', path, numDimensions, similarity } ] }
        //   映射形式：{ mappings: { fields: { path: [ {...} ] } } }
        const def = idx.latestDefinition || {}
        const list = Array.isArray(def.fields) ? def.fields.slice() : []
        const mapped = def.mappings?.fields || {}
        for (const [path, arr] of Object.entries(mapped)) {
          const sub = Array.isArray(arr) ? arr : [arr]
          for (const f of sub) list.push({ ...f, path: f.path || path })
        }
        const vectors = list
          .filter((f) => f && f.type === 'vector')
          .map((f) => ({ path: f.path, numDimensions: f.numDimensions, similarity: f.similarity }))
        return { name: idx.name, status: idx.status, vectors }
      })
    } catch (error) {
      indexSummary = `无法列出搜索索引（非 Atlas 或本地 MongoDB 不支持 listSearchIndexes）: ${error.message}`
    }

    return {
      skipped: false,
      dbName,
      total,
      withEmbedding,
      missingEmbedding: total - withEmbedding,
      tier,
      regularIndexNames,
      indexSummary,
    }
  } catch (error) {
    return { skipped: false, error: `连接 MongoDB 失败: ${error.message}` }
  } finally {
    await client.close().catch(() => {})
  }
}

// ---------------- 输出与诊断 ----------------
function printConfig(env, baseUrl, query) {
  console.log('=== 配置概览（值已脱敏）===')
  console.log(`  base-url              : ${baseUrl}`)
  console.log(`  query                 : ${query}`)
  console.log(`  SILICONFLOW_API_KEY   : ${mask(env.SILICONFLOW_API_KEY)}`)
  console.log(`  SILICONFLOW_BASE_URL  : ${mask(env.SILICONFLOW_BASE_URL)}`)
  console.log(`  SILICONFLOW_EMBEDDING_MODEL : ${env.SILICONFLOW_EMBEDDING_MODEL || '<missing>'}`)
  console.log(`  AI_EMBEDDING_PROVIDER: ${env.AI_EMBEDDING_PROVIDER || '<missing>'}`)
  console.log(`  MONGODB_URI           : ${mask(env.MONGODB_URI)}`)
  console.log('')
}

function buildDiagnosis(embedding, results) {
  const vector = results.find((r) => r.mode === 'vector')
  const hybrid = results.find((r) => r.mode === 'hybrid')
  const keyword = results.find((r) => r.mode === 'keyword')

  const keywordTotal = keyword && keyword.total > 0 ? keyword.total : 0
  const vectorTotal = vector && vector.total > 0 ? vector.total : 0
  const vectorRealHit = vector ? vector.items.some((it) => Number(it.score) > 0) : false

  const lines = []
  if (!embedding.ok) {
    lines.push('❌ 根因：查询 embedding 生成失败 → 语义检索无法建立查询向量。请检查 SILICONFLOW_API_KEY / SILICONFLOW_EMBEDDING_MODEL 是否有效。')
    return lines
  }

  if (vector && vector.status !== 200) {
    lines.push(`❌ vector 模式返回 HTTP ${vector.status}: ${vector.error}`)
  }

  if (vectorTotal === 0 && keywordTotal > 0) {
    lines.push('❌ vector 模式返回 0 条但 keyword 命中 >0 → 说明 $vectorSearch 在抛错（被 controller 捕获后直接返回空，未走关键词兜底）。')
    lines.push('   最可能：Atlas 向量索引 vector_index 不存在，或 numDimensions 与模型维度不符。用 --with-db 确认索引定义。')
  } else if (vectorTotal > 0 && !vectorRealHit) {
    lines.push('⚠️ vector 模式有结果但所有 score 都是 0 → 实际是关键词兜底结果，向量召回没有贡献。')
    lines.push('   可能：笔记都没有 embedding（历史笔记未补算 / AI 生成失败）。用 --with-db 查看 embedding 覆盖率。')
  } else if (vectorTotal > 0 && vectorRealHit) {
    lines.push('✅ 语义检索链路正常：vector 模式返回了带相似度分数的真实向量结果。')
  } else if (vectorTotal === 0 && keywordTotal === 0) {
    lines.push('⚠️ vector 与 keyword 都未命中：笔记正文可能字面不含该查询词，或当前账号范围内没有笔记。')
    lines.push('   用 --with-db 确认笔记总数与 embedding 覆盖率。')
  }

  if (hybrid && hybrid.total === 0 && keywordTotal > 0) {
    lines.push('ℹ️ hybrid 模式为 0 但 keyword 命中 >0，属于异常（hybrid 本应回退 keyword），需关注后端日志。')
  }
  return lines
}

async function main() {
  const args = readArgs(process.argv.slice(2))
  if (args.help) { printHelp(); return }

  const env = collectEnv()
  const baseUrl = args.baseUrl || env.API_BASE_URL || env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'
  const timeoutMs = Number(args.timeoutMs) || 30000

  printConfig(env, baseUrl, args.query)

  // 1) embedding 供应商
  console.log('=== 1) embedding 供应商（查询向量生成）===')
  const embedding = await checkEmbedding(env, args.query, timeoutMs)
  if (embedding.ok) console.log(`  OK   生成查询向量成功，维度 = ${embedding.dims}`)
  else console.log(`  FAIL ${embedding.reason}`)
  console.log('')

  // 2) token
  const auth = await resolveToken(args, env, baseUrl)
  const results = []
  if (auth.error) {
    console.log(`=== 2/3) 跳过接口测试：${auth.error} ===`)
  } else {
    console.log(`=== 2) 认证 token 来源：${auth.source} ===`)
    console.log('')

    // vector/hybrid 可能触发上游 embedding + Atlas 检索，超时放宽到 2 分钟
    console.log(`=== 3) 语义搜索接口（q="${args.query}"）===`)
    for (const mode of ['vector', 'hybrid', 'keyword']) {
      const modeTimeout = mode === 'keyword' ? timeoutMs : Math.max(timeoutMs, 120000)
      const result = await searchMode(baseUrl, auth.token, args.query, mode, modeTimeout)
      results.push(result)
      if (result.error) {
        console.log(`  ${mode.padEnd(7)} HTTP ${result.status}  ${result.error}`)
      } else {
        console.log(`  ${mode.padEnd(7)} HTTP ${result.status}  total=${result.total}`)
        result.items.slice(0, 5).forEach(formatItem)
      }
      console.log('')
    }
  }

  // 4) 数据库
  if (args.withDb) {
    console.log('=== 4) MongoDB embedding 覆盖与向量索引 ===')
    const db = await checkDatabase(env)
    if (db.skipped) {
      console.log(`  SKIP ${db.skipped}`)
    } else if (db.error) {
      console.log(`  FAIL ${db.error}`)
    } else {
      console.log(`  数据库=${db.dbName}  笔记总数=${db.total}  有 embedding=${db.withEmbedding}  缺 embedding=${db.missingEmbedding}`)
      console.log(`  集群类型：${db.tier || 'unknown'}`)
      if (db.regularIndexNames && db.regularIndexNames.includes('vector_index')) {
        console.log('  ⚠️ 检测到普通索引里存在名为 vector_index 的索引 —— 这是普通索引，不是 Atlas Search 向量索引，$vectorSearch 不会使用它。')
      }
      if (Array.isArray(db.indexSummary)) {
        if (db.indexSummary.length === 0) console.log('  向量索引（Atlas Search）：无（未创建 vector_index）')
        let hasVectorNamedVectorIndex = false
        for (const idx of db.indexSummary) {
          const vectors = idx.vectors.map((v) => `path=${v.path} dims=${v.numDimensions} sim=${v.similarity}`).join(', ')
          console.log(`  向量索引（Atlas Search）：name=${idx.name} status=${idx.status} ${vectors || '(非向量索引)'}`)
          if (idx.name === 'vector_index' && idx.vectors.length > 0) hasVectorNamedVectorIndex = true
        }
        // 代码写死索引名为 vector_index；存在向量索引但名字不符时直接点出根因
        const anyVector = db.indexSummary.some((idx) => idx.vectors.length > 0)
        if (anyVector && !hasVectorNamedVectorIndex) {
          console.log('  ❌ 已存在向量索引，但名字不是 vector_index —— 代码里写死 index: "vector_index"，所以 $vectorSearch 找不到它。')
          console.log('     修复：把该索引重建成 vector_index，或修改 semantic.service.ts / note-recommendation.service.ts 里的索引名。')
        }
      } else {
        console.log(`  向量索引：${db.indexSummary}`)
      }
    }
    console.log('')
  }

  // 5) 诊断结论
  console.log('=== 诊断结论 ===')
  const diagnosis = buildDiagnosis(embedding, results)
  if (diagnosis.length === 0) diagnosis.push('未产生明确结论（可能未执行接口测试）。')
  for (const line of diagnosis) console.log(line)

  // 明确的基础设施失败才让脚本以非零码退出，便于 CI 使用
  const infraFailed =
    !embedding.ok ||
    results.some((r) => r.status >= 500) ||
    Boolean(auth.error)
  if (infraFailed) process.exitCode = 1
}

main().catch((error) => {
  console.error(`语义搜索检查脚本异常: ${error.message}`)
  process.exitCode = 1
})
