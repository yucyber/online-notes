#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const live = process.argv.includes('--live')

const envFiles = [
  '.env.compose.example',
  'notes-backend/.env.example',
  'notes-frontend/.env.local.example',
  'notes-backend/.env',
  'notes-frontend/.env.local',
]

const required = [
  { key: 'SENSENOVA_API_KEY', purpose: 'SenseNova gateway key for DeepSeek model' },
  { key: 'SENSENOVA_BASE_URL', purpose: 'SenseNova OpenAI-compatible base URL' },
  { key: 'SENSENOVA_TEXT_MODEL', purpose: 'SenseNova text model, e.g. deepseek-v4-flash' },
  { key: 'SILICONFLOW_API_KEY', purpose: 'SiliconFlow key for Qwen embedding/reranker' },
  { key: 'SILICONFLOW_BASE_URL', purpose: 'SiliconFlow OpenAI-compatible base URL' },
  { key: 'SILICONFLOW_EMBEDDING_MODEL', purpose: 'SiliconFlow embedding model, e.g. Qwen/Qwen3-Embedding-8B' },
  { key: 'SILICONFLOW_RERANKER_MODEL', purpose: 'SiliconFlow reranker model, e.g. Qwen/Qwen3-Reranker-8B' },
  { key: 'AI_TEXT_PROVIDER', purpose: 'Default fast text provider route' },
  { key: 'AI_REASONING_PROVIDER', purpose: 'Default reasoning/long-context provider route' },
  { key: 'AI_EMBEDDING_PROVIDER', purpose: 'Default embedding provider route' },
]

const optional = [
  { key: 'MIMO_API_KEY', purpose: 'Optional MiMo provider key' },
  { key: 'MIMO_BASE_URL', purpose: 'Optional MiMo OpenAI-compatible base URL' },
  { key: 'MIMO_MODEL', purpose: 'Optional MiMo model' },
  { key: 'SILICONFLOW_RERANKER_PATH', purpose: 'Optional SiliconFlow reranker endpoint path; defaults to /rerank' },
  { key: 'AI_RERANKER_PROVIDER', purpose: 'Default reranker provider route' },
]

const frontendSecretPrefixes = [
  'MIMO_',
  'SENSENOVA_',
  'SILICONFLOW_',
  'MODELARK_',
  'COZE_',
  'ZHIPU_',
]

function parseEnvFile(path) {
  if (!existsSync(path)) return {}
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  const env = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2] ?? ''
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[match[1]] = value
  }
  return env
}

function collectEnv() {
  const byFile = new Map()
  const merged = {}
  for (const relative of envFiles) {
    const absolute = resolve(root, relative)
    const parsed = parseEnvFile(absolute)
    byFile.set(relative, parsed)
    Object.assign(merged, parsed)
  }
  Object.assign(merged, process.env)
  return { byFile, merged }
}

function isPlaceholder(value) {
  return /^(your_|change-me|example|placeholder|xxx|test)/i.test(String(value || ''))
}

function mask(value) {
  if (!value) return '<missing>'
  if (isPlaceholder(value)) return '<placeholder>'
  return `<configured:${value.length}>`
}

function configured(value) {
  return Boolean(value) && !isPlaceholder(value)
}

function formatStatus(ok, label) {
  return `${ok ? 'OK ' : 'WARN'} ${label}`
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''))
}

function endpoint(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}${path}`
}

function findFrontendSecrets(byFile) {
  const found = []
  for (const file of ['notes-frontend/.env.local', 'notes-frontend/.env.local.example']) {
    const env = byFile.get(file) || {}
    for (const key of Object.keys(env)) {
      if (key.startsWith('NEXT_PUBLIC_') && key.includes('API_KEY')) {
        found.push({ file, key, reason: 'public API key-like variable' })
      }
      if (frontendSecretPrefixes.some((prefix) => key.startsWith(prefix))) {
        found.push({ file, key, reason: 'AI provider secret should live in notes-backend/.env' })
      }
    }
  }
  return found
}

function validateLocalConfig(merged, byFile) {
  const warnings = []
  const rows = []

  for (const item of required) {
    const value = merged[item.key]
    const present = configured(value)
    rows.push({
      key: item.key,
      status: present ? 'configured' : value ? 'placeholder' : 'missing',
      value: mask(value),
      purpose: item.purpose,
    })
  }

  for (const item of optional) {
    const value = merged[item.key]
    rows.push({
      key: item.key,
      status: configured(value) ? 'configured' : value ? 'placeholder' : 'optional',
      value: mask(value),
      purpose: item.purpose,
      optional: true,
    })
  }

  for (const key of ['MIMO_BASE_URL', 'SENSENOVA_BASE_URL', 'SILICONFLOW_BASE_URL']) {
    if (merged[key] && !isPlaceholder(merged[key]) && !isHttpUrl(merged[key])) {
      warnings.push(`${key} should be an http(s) base URL.`)
    }
  }

  const providerExpectations = {
    AI_TEXT_PROVIDER: ['sensenova', 'mimo'],
    AI_REASONING_PROVIDER: ['mimo', 'sensenova'],
    AI_EMBEDDING_PROVIDER: ['siliconflow'],
    AI_RERANKER_PROVIDER: ['siliconflow'],
  }

  for (const [key, allowed] of Object.entries(providerExpectations)) {
    const value = merged[key]
    if (value && !allowed.includes(String(value).toLowerCase())) {
      warnings.push(`${key} is "${value}", expected one of: ${allowed.join(', ')}.`)
    }
  }

  for (const entry of findFrontendSecrets(byFile)) {
    warnings.push(`${entry.file} contains ${entry.key}; ${entry.reason}.`)
  }

  return { rows, warnings }
}

async function readProviderError(response) {
  const text = await response.text()
  if (!text) return ''
  try {
    const data = JSON.parse(text)
    const code = data.code ?? data.error?.code ?? data.error_code ?? ''
    const msg = data.msg ?? data.message ?? data.error?.message ?? text
    return [code, msg].filter(Boolean).join(' ')
  } catch {
    return text.slice(0, 500)
  }
}

async function postJson(url, apiKey, body) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function getJson(url, apiKey) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    return await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function extractModelIds(data) {
  const source = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : []

  return source
    .map((item) => (typeof item === 'string' ? item : item?.id))
    .filter(Boolean)
}

async function checkModelCatalog({ name, baseUrl, apiKey, models }) {
  if (!configured(baseUrl) || !configured(apiKey)) {
    return { name, skipped: true, reason: 'base URL or API key is missing' }
  }

  const requestedModels = models.filter(configured)
  if (requestedModels.length === 0) {
    return { name, skipped: true, reason: 'no model is configured for catalog validation' }
  }

  const response = await getJson(endpoint(baseUrl, '/models'), apiKey)
  if (!response.ok) {
    return { name, ok: false, status: response.status, error: await readProviderError(response) }
  }

  const data = await response.json().catch(() => ({}))
  const ids = extractModelIds(data)
  const lowerToExact = new Map(ids.map((id) => [String(id).toLowerCase(), id]))
  const missing = requestedModels.filter((model) => !ids.includes(model))

  if (missing.length > 0) {
    const detail = missing
      .map((model) => {
        const exact = lowerToExact.get(String(model).toLowerCase())
        return exact
          ? `${model} not found exactly; provider lists ${exact}`
          : `${model} not found in provider model catalog`
      })
      .join('; ')
    return { name, ok: false, status: response.status, error: detail }
  }

  return {
    name,
    ok: true,
    status: response.status,
    detail: `${ids.length} models; verified ${requestedModels.length} configured model(s)`,
  }
}

async function checkOpenAiChat({ name, baseUrl, apiKey, model }) {
  if (!configured(baseUrl) || !configured(apiKey) || !configured(model)) {
    return { name, skipped: true, reason: 'base URL, API key, or model is missing' }
  }

  const response = await postJson(endpoint(baseUrl, '/chat/completions'), apiKey, {
    model,
    messages: [{ role: 'user', content: 'Hello. Reply with OK.' }],
    max_tokens: 64,
    temperature: 0,
  })

  if (!response.ok) {
    return { name, ok: false, status: response.status, error: await readProviderError(response) }
  }

  const data = await response.json().catch(() => ({}))
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    return { name, ok: false, status: response.status, error: 'No assistant content in response.' }
  }
  return { name, ok: true, status: response.status }
}

async function checkOpenAiEmbedding({ name, baseUrl, apiKey, model }) {
  if (!configured(baseUrl) || !configured(apiKey) || !configured(model)) {
    return { name, skipped: true, reason: 'base URL, API key, or model is missing' }
  }

  const response = await postJson(endpoint(baseUrl, '/embeddings'), apiKey, {
    model,
    input: 'health check',
  })

  if (!response.ok) {
    return { name, ok: false, status: response.status, error: await readProviderError(response) }
  }

  const data = await response.json().catch(() => ({}))
  const embedding = data.data?.[0]?.embedding
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return { name, ok: false, status: response.status, error: 'No embedding vector in response.' }
  }
  return { name, ok: true, status: response.status, detail: `${embedding.length} dims` }
}

async function checkReranker(env) {
  if (!configured(env.SILICONFLOW_BASE_URL) || !configured(env.SILICONFLOW_API_KEY) || !configured(env.SILICONFLOW_RERANKER_MODEL)) {
    return { name: 'SiliconFlow Qwen reranker', skipped: true, reason: 'base URL, API key, or reranker model is missing' }
  }

  const configuredPath = env.SILICONFLOW_RERANKER_PATH || '/rerank'
  const path = configuredPath.startsWith('/') ? configuredPath : `/${configuredPath}`
  const response = await postJson(endpoint(env.SILICONFLOW_BASE_URL, path), env.SILICONFLOW_API_KEY, {
    model: env.SILICONFLOW_RERANKER_MODEL,
    query: 'health check',
    documents: ['health check', 'unrelated document'],
  })

  if (!response.ok) {
    return { name: 'SiliconFlow Qwen reranker', ok: false, status: response.status, error: await readProviderError(response) }
  }
  return { name: 'SiliconFlow Qwen reranker', ok: true, status: response.status }
}

function printDryRunReport(rows, warnings) {
  console.log('AI configuration report')
  console.log(`Mode: ${live ? 'live' : 'dry-run'}`)
  console.log('')
  for (const row of rows) {
    const ok = row.status === 'configured' || row.status === 'optional'
    console.log(`${formatStatus(ok, row.key)} = ${row.value}`)
    console.log(`     ${row.purpose}`)
  }
  if (warnings.length > 0) {
    console.log('')
    console.log('Warnings:')
    for (const warning of warnings) console.log(`- ${warning}`)
  }
  if (!live) {
    console.log('')
    console.log('No external AI provider calls were made. Use check:ai-config:live to verify configured keys with providers.')
  }
}

async function main() {
  const { byFile, merged } = collectEnv()
  const { rows, warnings } = validateLocalConfig(merged, byFile)
  printDryRunReport(rows, warnings)

  if (!live) return

  console.log('')
  console.log('Live provider checks:')
  const modelCatalogModels = [
    merged.SILICONFLOW_EMBEDDING_MODEL,
    merged.SILICONFLOW_RERANKER_MODEL,
  ]

  const checks = [
    await checkOpenAiChat({
      name: 'SenseNova DeepSeek chat',
      baseUrl: merged.SENSENOVA_BASE_URL,
      apiKey: merged.SENSENOVA_API_KEY,
      model: merged.SENSENOVA_TEXT_MODEL,
    }),
    await checkModelCatalog({
      name: 'SiliconFlow model catalog',
      baseUrl: merged.SILICONFLOW_BASE_URL,
      apiKey: merged.SILICONFLOW_API_KEY,
      models: modelCatalogModels,
    }),
    await checkOpenAiEmbedding({
      name: 'SiliconFlow Qwen embedding',
      baseUrl: merged.SILICONFLOW_BASE_URL,
      apiKey: merged.SILICONFLOW_API_KEY,
      model: merged.SILICONFLOW_EMBEDDING_MODEL,
    }),
    await checkReranker(merged),
  ]

  let failed = false
  for (const result of checks) {
    if (result.skipped) {
      console.log(`SKIP ${result.name}: ${result.reason}`)
    } else if (result.ok) {
      console.log(`OK   ${result.name}: HTTP ${result.status}${result.detail ? ` (${result.detail})` : ''}`)
    } else {
      failed = true
      console.log(`FAIL ${result.name}: HTTP ${result.status} ${result.error || ''}`.trim())
    }
  }

  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(`AI config check failed: ${error.message}`)
  process.exitCode = 1
})
