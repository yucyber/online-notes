#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REGISTRY = 'docs/api-contract-drift.md'
const CLIENT_FILE = 'notes-frontend/src/lib/api.ts'
const OPENAPI_FILE = 'notes-backend/openapi.yaml'
const BACKEND_MODULES_DIR = 'notes-backend/src/modules'
const ALLOWED_DECISIONS = new Set([
  'implement-now',
  'hide-client-entry',
  'mark-planned-or-remove',
  'document-openapi',
])

function normalizeBraces(p) {
  return p
    .replace(/\$\{[^}]+\}/g, ':id')
    .replace(/\{[^}]+\}/g, ':id')
    .replace(/:[^/]+/g, ':id')
}

function normalizeApiPath(p) {
  let path = p.split('?')[0]
  path = normalizeBraces(path)
  if (path.startsWith('/v1/')) return '/api' + path
  if (path.startsWith('/api/')) return path
  if (path.startsWith('/')) return '/api' + path
  return path
}

function extractClientPaths() {
  const text = readFileSync(CLIENT_FILE, 'utf8')
  // Permissive matcher: allow ${...} inside template literals.
  // Captures the quoted path, including template-literal interpolations.
  const re = /api\s*\.\s*(?:get|post|put|patch|delete)\s*(?:<[^>]+>)?\s*\(\s*([`'"])((?:\\\1|(?!\1).)+?)\1/g
  const paths = new Set()
  for (const match of text.matchAll(re)) {
    paths.add(normalizeApiPath(match[2]))
  }
  // Also count `// path: '/...'` markers as client-side surface.
  // Used by entries that were intentionally short-circuited (e.g., assets/embeds
  // that throw FeatureUnavailableError) but whose API surface still exists for
  // contract-tracking purposes.
  const markerRe = /\/\/\s*path:\s*['"`]([^'"`]+)['"`]/g
  for (const match of text.matchAll(markerRe)) {
    paths.add(normalizeApiPath(match[1]))
  }
  return paths
}

function listControllerFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listControllerFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.controller.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

function extractBackendPaths() {
  const paths = new Set()
  const controllerFiles = listControllerFiles(BACKEND_MODULES_DIR)
  const controllerRe = /@Controller\((['"])(.*?)\1\)/g
  const methodRe = /@(Get|Post|Put|Patch|Delete)\((?:(['"])(.*?)\2)?\)/g

  for (const file of controllerFiles) {
    const text = readFileSync(file, 'utf8')
    const controllers = [...text.matchAll(controllerRe)]
    for (let i = 0; i < controllers.length; i++) {
      const prefix = controllers[i][2]
      const start = controllers[i].index || 0
      const end = i + 1 < controllers.length ? controllers[i + 1].index || text.length : text.length
      const body = text.slice(start, end)

      for (const match of body.matchAll(methodRe)) {
        const route = match[3] || ''
        const joined = [prefix, route].filter(Boolean).join('/')
        paths.add(normalizeApiPath(`/api/${joined}`.replace(/\/+/g, '/')))
      }
    }
  }

  return paths
}

function extractOpenApiPaths() {
  const text = readFileSync(OPENAPI_FILE, 'utf8')
  // Tolerate optional quotes and 2/4-space indentation.
  const re = /^\s*(['"]?)(\/api\/[^:'"\s]+)\1\s*:\s*$/gm
  const paths = new Set()
  for (const match of text.matchAll(re)) {
    paths.add(normalizeBraces(match[2]))
  }
  return paths
}

function parseRegistry() {
  const text = readFileSync(REGISTRY, 'utf8')
  const tableStart = text.indexOf('| 路径 |')
  const tableText = tableStart === -1 ? text : text.slice(tableStart)
  const rows = tableText.split('\n').filter(line => line.startsWith('| `/api/'))
  const map = new Map()
  for (const row of rows) {
    const cells = row.split('|').map(c => c.trim())
    // cells: ['', path, consumer, backend, openapi, decision, verification, '']
    const path = (cells[1] || '').replace(/`/g, '')
    const decision = (cells[5] || '').replace(/`/g, '')
    const verification = cells[6] || ''
    map.set(path, { decision, verification })
  }
  return map
}

function parseApprovedNonContractPaths() {
  const text = readFileSync(REGISTRY, 'utf8')
  const sections = ['## Planned APIs', '## Discarded APIs']
  const paths = new Set()

  for (const section of sections) {
    const start = text.indexOf(section)
    if (start === -1) continue
    const next = text.indexOf('\n## ', start + section.length)
    const table = text.indexOf('\n| 路径 |', start + section.length)
    const candidates = [next, table].filter(index => index !== -1)
    const end = candidates.length > 0 ? Math.min(...candidates) : text.length
    const body = text.slice(start, end)
    const rows = body.split('\n').filter(line => line.startsWith('| `/api/'))
    for (const row of rows) {
      const cells = row.split('|').map(c => c.trim())
      const path = (cells[1] || '').replace(/`/g, '')
      if (path) paths.add(normalizeApiPath(path))
    }
  }

  return paths
}

function main() {
  const clientPaths = extractClientPaths()
  const backendPaths = extractBackendPaths()
  const openApiPaths = extractOpenApiPaths()
  const implementedPaths = new Set([...clientPaths, ...backendPaths])

  const drift = [
    ...new Set([...implementedPaths, ...openApiPaths]),
  ]
    .filter(p => implementedPaths.has(p) !== openApiPaths.has(p))
    .sort()

  const registry = parseRegistry()
  const approvedNonContractPaths = parseApprovedNonContractPaths()
  let failures = 0

  for (const [path, entry] of registry.entries()) {
    if (!ALLOWED_DECISIONS.has(entry.decision)) {
      console.error(`Invalid decision for ${path}: ${entry.decision}`)
      failures++
    }
    if (!entry.verification || entry.verification.length < 8) {
      console.error(`Missing verification for ${path}`)
      failures++
    }
  }

  for (const path of drift) {
    if (!registry.has(path) && !approvedNonContractPaths.has(path)) {
      console.error(`Unregistered API contract drift: ${path}`)
      failures++
    }
  }

  for (const path of registry.keys()) {
    if (!drift.includes(path)) {
      console.error(`Stale API contract drift registration: ${path}`)
      failures++
    }
  }

  for (const path of approvedNonContractPaths) {
    if (registry.has(path)) {
      console.error(`Approved non-contract path is still in drift registry: ${path}`)
      failures++
    }
    if (openApiPaths.has(path)) {
      console.error(`Approved non-contract path must not be in executable OpenAPI paths: ${path}`)
      failures++
    }
  }

  if (registry.size === 0) {
    console.error('Expected at least one drift row')
    failures++
  }

  if (failures > 0) {
    process.exit(1)
  }
  console.log(`API contract drift register OK: ${drift.length} drift rows`)
}

main()
