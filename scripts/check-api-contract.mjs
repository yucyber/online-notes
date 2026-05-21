#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const REGISTRY = 'docs/api-contract-drift.md'
const CLIENT_FILE = 'notes-frontend/src/lib/api.ts'
const OPENAPI_FILE = 'notes-backend/openapi.yaml'
const ALLOWED_DECISIONS = new Set([
  'implement-now',
  'hide-client-entry',
  'mark-planned-or-remove',
  'document-openapi',
])

function normalizeBraces(p) {
  return p.replace(/\$\{[^}]+\}/g, ':id').replace(/\{[^}]+\}/g, ':id')
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
  const re = /api\.(?:get|post|put|patch|delete)\s*(?:<[^>]+>)?\s*\(\s*([`'"])((?:\\\1|(?!\1).)+?)\1/g
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
  const rows = text.split('\n').filter(line => line.startsWith('| `/api/'))
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

function main() {
  const clientPaths = extractClientPaths()
  const openApiPaths = extractOpenApiPaths()

  const drift = [
    ...new Set([...clientPaths, ...openApiPaths]),
  ]
    .filter(p => clientPaths.has(p) !== openApiPaths.has(p))
    .sort()

  const registry = parseRegistry()
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
    if (!registry.has(path)) {
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
