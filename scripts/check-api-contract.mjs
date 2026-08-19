#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import YAML from 'yaml'

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
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const TYPED_HELPER_METHODS = new Map([
  ['getTyped', 'GET'],
  ['postTyped', 'POST'],
  ['patchTyped', 'PATCH'],
])

function assertContract(condition, field) {
  if (!condition) throw new Error(`OpenAPI release gate: missing or invalid ${field}`)
}

function responseDataSchema(response) {
  const allOf = response?.content?.['application/json']?.schema?.allOf
  return Array.isArray(allOf) ? allOf.find(item => item?.type === 'object' && item?.properties?.data) : null
}

export function validateReleaseGateOperations(document) {
  const logout = document?.paths?.['/api/auth/logout']?.post
  assertContract(logout, 'logout POST')
  assertContract(logout.responses?.['200']?.$ref === '#/components/responses/LogoutEnvelope', 'LogoutEnvelope')

  const logoutEnvelope = document?.components?.responses?.LogoutEnvelope
  const logoutData = responseDataSchema(logoutEnvelope)
  assertContract(logoutData?.required?.includes('data'), 'LogoutEnvelope.data')
  assertContract(logoutData?.properties?.data?.$ref === '#/components/schemas/LogoutResult', 'LogoutResult')
  const logoutResult = document?.components?.schemas?.LogoutResult
  assertContract(logoutResult?.required?.includes('message') && logoutResult?.properties?.message?.type === 'string', 'LogoutResult.message')

  const roomPath = document?.paths?.['/api/notes/{id}/room-ticket']
  const roomTicket = roomPath?.post
  assertContract(roomTicket, 'room-ticket POST')
  assertContract(roomPath.parameters?.some(parameter => parameter?.$ref === '#/components/parameters/Id'), 'room-ticket Id parameter')
  const idParameter = document?.components?.parameters?.Id
  assertContract(idParameter?.name === 'id' && idParameter?.in === 'path' && idParameter?.required === true && idParameter?.schema?.type === 'string', 'Id parameter definition')
  assertContract(roomTicket.security?.some(requirement => 'CookieAuth' in requirement), 'CookieAuth')
  assertContract(roomTicket.security?.some(requirement => 'BearerAuth' in requirement), 'BearerAuth')
  const cookieAuth = document?.components?.securitySchemes?.CookieAuth
  assertContract(cookieAuth?.type === 'apiKey' && cookieAuth?.in === 'cookie' && cookieAuth?.name === 'notes_token', 'CookieAuth scheme')
  const bearerAuth = document?.components?.securitySchemes?.BearerAuth
  assertContract(bearerAuth?.type === 'http' && bearerAuth?.scheme === 'bearer', 'BearerAuth scheme')
  assertContract(roomTicket.responses?.['201']?.$ref === '#/components/responses/RoomTicketEnvelope', 'RoomTicketEnvelope response')

  const roomEnvelope = document?.components?.responses?.RoomTicketEnvelope
  assertContract(roomEnvelope, 'RoomTicketEnvelope')
  const roomData = responseDataSchema(roomEnvelope)
  assertContract(roomData?.required?.includes('data'), 'RoomTicketEnvelope.data')
  assertContract(roomData?.properties?.data?.$ref === '#/components/schemas/RoomTicket', 'RoomTicket schema reference')

  const roomSchema = document?.components?.schemas?.RoomTicket
  const required = new Set(roomSchema?.required || [])
  assertContract(['ticket', 'role', 'expiresIn'].every(field => required.has(field)), 'RoomTicket required fields')
  const roleValues = roomSchema?.properties?.role?.enum || []
  assertContract(roomSchema?.properties?.ticket?.type === 'string' && roomSchema?.properties?.expiresIn?.type === 'integer', 'RoomTicket field types')
  assertContract(roleValues.length === 2 && roleValues.includes('writer') && roleValues.includes('reader'), 'RoomTicket role enum')
}

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

export function normalizeOperation(method, rawPath, { local = false } = {}) {
  const verb = String(method).toUpperCase()
  if (!HTTP_METHODS.has(verb)) throw new Error(`Unsupported HTTP method: ${method}`)
  let path = String(rawPath).split('?')[0]
    .replace(/\$\{[^}]+\}|\{[^}]+\}|\[[^\]]+\]|:[^/]+/g, ':id')
    .replace(/\/+/g, '/')
  if (!path.startsWith('/')) path = `/${path}`
  if (!local && !path.startsWith('/api/')) path = `/api${path}`
  return `${verb} ${path}`
}

function addOperation(result, method, path, file, text, index, options) {
  const key = normalizeOperation(method, path, options)
  const source = { file, line: text.slice(0, index).split('\n').length }
  result.set(key, [...(result.get(key) || []), source])
}

export function extractClientOperations(sources) {
  const result = new Map()
  const direct = /\bapi\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^>]+>)?\s*\(\s*([`'"])([\s\S]*?)\2/g
  const typed = /\b(getTyped|postTyped|patchTyped)\s*(?:<[^>]+>)?\s*\(\s*([`'"])([\s\S]*?)\2/g
  // 只剥离可确认的 API_URL 前缀；动态 url 无法安全归一化，避免制造误报。
  const backendFetch = /fetch\(\s*`\$\{API_URL\}([^`]*)`\s*,\s*\{[\s\S]*?method:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/g
  for (const { file, text } of sources) {
    for (const match of text.matchAll(direct)) addOperation(result, match[1], match[3], file, text, match.index)
    for (const match of text.matchAll(typed)) addOperation(result, TYPED_HELPER_METHODS.get(match[1]), match[3], file, text, match.index)
    for (const match of text.matchAll(backendFetch)) addOperation(result, match[2], match[1], file, text, match.index)
  }
  return result
}

export function extractBackendOperations(sources) {
  const result = new Map()
  const controllerRe = /@Controller\((['"])(.*?)\1\)/g
  const methodRe = /@(Get|Post|Put|Patch|Delete)\((?:(['"])(.*?)\2)?\)/g

  for (const { file, text } of sources) {
    const controllers = [...text.matchAll(controllerRe)]
    for (let i = 0; i < controllers.length; i++) {
      const prefix = controllers[i][2]
      const start = controllers[i].index || 0
      const end = i + 1 < controllers.length ? controllers[i + 1].index || text.length : text.length
      const body = text.slice(start, end)

      // 按 Controller 区间匹配，避免相邻 Controller 的 decorator 串入当前前缀。
      for (const match of body.matchAll(methodRe)) {
        const route = match[3] || ''
        const joined = [prefix, route].filter(Boolean).join('/')
        addOperation(result, match[1], `/api/${joined}`.replace(/\/+/g, '/'), file, text, start + match.index)
      }
    }
  }

  return result
}

export function extractOpenApiOperations(document) {
  const result = new Map()
  for (const [path, pathItem] of Object.entries(document.paths || {})) {
    for (const method of HTTP_METHODS) {
      if (pathItem?.[method.toLowerCase()]) addOperation(result, method, path, 'notes-backend/openapi.yaml', '', 0)
    }
  }
  return result
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
  const openApiDocument = YAML.parse(readFileSync(OPENAPI_FILE, 'utf8'))
  validateReleaseGateOperations(openApiDocument)
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

  // Zero active drift rows is valid after planned/discarded cleanup.

  if (failures > 0) {
    process.exit(1)
  }
  console.log(`API contract drift register OK: ${drift.length} drift rows`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
