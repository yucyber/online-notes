#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import YAML from 'yaml'

const REGISTRY = 'docs/api-contract-drift.md'
const CLIENT_DIR = 'notes-frontend/src/lib/api'
const OPENAPI_FILE = 'notes-backend/openapi.yaml'
const BACKEND_MODULES_DIR = 'notes-backend/src/modules'
const FRONTEND_SRC_DIR = 'notes-frontend/src'
const NEXT_ROUTES_DIR = 'notes-frontend/src/app/api'
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
const NEXT_AXIOS_RE = /\baxios\.(get|post|put|patch|delete)\s*\(\s*([`'"])(\/api\/[\s\S]*?)\2/g
const NEXT_JSON_RE = /\bpostAiJson\s*\(\s*([`'"])(\/api\/[\s\S]*?)\1/g
const NEXT_FETCH_RE = /\bfetch\s*\(\s*([`'"])(\/api\/[\s\S]*?)\1\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g

export function listFiles(dir, predicate) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(fullPath, predicate))
    else if (entry.isFile() && predicate(fullPath)) files.push(fullPath)
  }
  return files
}

export function readSources(files) {
  return files.map(file => ({ file, text: readFileSync(file, 'utf8') }))
}

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
  if (!local && path !== '/api' && !path.startsWith('/api/')) path = `/api${path}`
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

function assertResolvableNextPath(path, file, text, index) {
  const interpolations = String(path).match(/\$\{[^}]+\}/g) || []
  const isSingleDynamicSegment = interpolations.length === 1
    && String(path).split('?')[0].split('/').includes(interpolations[0])
  if (interpolations.length > 0 && !isSingleDynamicSegment) {
    const line = text.slice(0, index).split('\n').length
    throw new Error(`Unresolved first-party Next API call at ${file}:${line}`)
  }
}

function collectNextClientOperations(sources, errors) {
  const result = new Map()
  const addResolved = (method, path, file, text, index) => {
    try {
      assertResolvableNextPath(path, file, text, index)
    } catch (error) {
      if (!errors) throw error
      errors.push(error)
      return
    }
    addOperation(result, method, path, file, text, index, { local: true })
  }
  for (const { file, text } of sources) {
    for (const match of text.matchAll(NEXT_AXIOS_RE)) {
      addResolved(match[1], match[3], file, text, match.index)
    }
    for (const match of text.matchAll(NEXT_JSON_RE)) {
      addResolved('POST', match[2], file, text, match.index)
    }
    for (const match of text.matchAll(NEXT_FETCH_RE)) {
      const method = match[3]?.match(/method:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i)?.[1] || 'GET'
      addResolved(method, match[2], file, text, match.index)
    }
  }
  return result
}

export function extractNextClientOperations(sources) {
  return collectNextClientOperations(sources)
}

export function extractNextClientInventory(sources) {
  const errors = []
  // 单个动态调用仍然失败，但不能遮蔽同文件或其他文件中的可定位漂移。
  const operations = collectNextClientOperations(sources, errors)
  return { operations, errors }
}

function routePathFromFile(file) {
  const relative = file.replace(/\\/g, '/').split('/app/api/')[1].replace(/\/route\.ts$/, '')
  return `/api/${relative}`
}

function unresolvedAiRoute(file, text, index, subject = 'allowlist') {
  const line = text.slice(0, index).split('\n').length
  throw new Error(`Unresolved AI route ${subject} at ${file}:${line}`)
}

function extractAiAllowlist(text, file, name) {
  const declaration = new RegExp(`\\bconst\\s+${name}\\s*=\\s*new\\s+Set\\s*\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)`).exec(text)
  if (!declaration) unresolvedAiRoute(file, text, 0)
  const entries = declaration[1]
  const values = [...entries.matchAll(/(['"])([^'"]*)\1/g)].map(match => match[2])
  if (values.length === 0 || entries.replace(/(['"])([^'"]*)\1/g, '').replace(/[\s,]/g, '')) {
    unresolvedAiRoute(file, text, declaration.index)
  }
  return values
}

function extractAiProxyMappings(text, file) {
  const stream = /path\s*:\s*name\s*===\s*(['"])writer\1\s*\?\s*(['"])(\/ai\/[^'"]+)\2\s*:\s*`(\/ai\/\$\{name\})`/.exec(text)
  const json = /return\s*\{\s*path\s*:\s*`(\/ai\/\$\{name\})`\s*,\s*mode\s*:\s*(['"])json\2\s*\}/.exec(text)
  if (!stream || !json || stream[4] !== json[1]) {
    unresolvedAiRoute(file, text, 0, 'mapping')
  }
  return { writer: stream[3], generic: stream[4] }
}

export function extractNextRouteOperations(sources) {
  const local = new Map()
  const proxyTargets = new Map()
  for (const { file, text } of sources) {
    if (!file.replace(/\\/g, '/').includes('/app/api/') || !file.endsWith('route.ts')) continue
    if (file.replace(/\\/g, '/').endsWith('/app/api/ai/[...path]/route.ts')) {
      if (!/export\s+(?:async\s+)?function\s+POST\s*\(/.test(text)) continue
      const streamPaths = extractAiAllowlist(text, file, 'STREAM_PATHS')
      const jsonPaths = extractAiAllowlist(text, file, 'JSON_PATHS')
      const mappings = extractAiProxyMappings(text, file)
      for (const name of streamPaths) {
        const operation = normalizeOperation('POST', `/api/ai/${name}`, { local: true })
        addOperation(local, 'POST', `/api/ai/${name}`, file, text, 0, { local: true })
        const target = name === 'writer' ? mappings.writer : mappings.generic.replace('${name}', name)
        proxyTargets.set(operation, normalizeOperation('POST', target))
      }
      for (const name of jsonPaths) {
        const operation = normalizeOperation('POST', `/api/ai/${name}`, { local: true })
        addOperation(local, 'POST', `/api/ai/${name}`, file, text, 0, { local: true })
        if (!proxyTargets.has(operation)) {
          proxyTargets.set(operation, normalizeOperation('POST', mappings.generic.replace('${name}', name)))
        }
      }
      continue
    }
    const path = routePathFromFile(file)
    const methods = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g
    for (const match of text.matchAll(methods)) {
      addOperation(local, match[1], path, file, text, match.index, { local: true })
    }
  }
  return { local, proxyTargets }
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

export function calculateDrift({ client, backend, openapi, nextClient, nextRoutes, proxyTargets }) {
  const drift = []
  const layerOrder = [
    'client-backend',
    'backend-openapi',
    'openapi-backend',
    'next-client-route',
    'next-proxy-backend',
    'next-proxy-openapi',
  ]
  const addMissing = (from, to, layer) => {
    for (const [operation, sources] of from) {
      if (!to.has(operation)) drift.push({ operation, layer, source: sources[0] })
    }
  }
  addMissing(client, backend, 'client-backend')
  addMissing(backend, openapi, 'backend-openapi')
  addMissing(openapi, backend, 'openapi-backend')
  addMissing(nextClient, nextRoutes, 'next-client-route')
  for (const [localOperation, targetOperation] of proxyTargets) {
    const source = nextRoutes.get(localOperation)?.[0]
    if (!backend.has(targetOperation)) drift.push({ operation: targetOperation, layer: 'next-proxy-backend', source })
    if (!openapi.has(targetOperation)) drift.push({ operation: targetOperation, layer: 'next-proxy-openapi', source })
  }
  return drift.sort((a, b) => {
    const layerDifference = layerOrder.indexOf(a.layer) - layerOrder.indexOf(b.layer)
    return layerDifference || a.operation.localeCompare(b.operation)
  })
}

export function parseRegistry(text = readFileSync(REGISTRY, 'utf8')) {
  const section = '## Active Drift Registry'
  const start = text.indexOf(section)
  if (start === -1) return new Map()
  const next = text.indexOf('\n## ', start + section.length)
  const body = text.slice(start, next === -1 ? text.length : next)
  const rows = body.split('\n').filter(line => line.startsWith('| `'))
  const map = new Map()
  for (const row of rows) {
    const cells = row.split('|').map(c => c.trim())
    // cells: ['', operation, consumer, backend, openapi, decision, verification, '']
    const operation = (cells[1] || '').replace(/`/g, '')
    const match = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/api(?:\/.*)?)$/.exec(operation)
    if (!match) throw new Error(`Active drift registry requires an HTTP method: ${operation}`)
    const decision = (cells[5] || '').replace(/`/g, '')
    const verification = cells[6] || ''
    map.set(normalizeOperation(match[1], match[2]), { decision, verification })
  }
  return map
}

export function parseApprovedNonContractPaths(text = readFileSync(REGISTRY, 'utf8')) {
  const sections = ['## Planned APIs', '## Discarded APIs']
  const paths = new Set()

  for (const section of sections) {
    const start = text.indexOf(section)
    if (start === -1) continue
    const next = text.indexOf('\n## ', start + section.length)
    const end = next === -1 ? text.length : next
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
  const clientFiles = listFiles(CLIENT_DIR, file => file.endsWith('.ts'))
  const backendFiles = listFiles(BACKEND_MODULES_DIR, file => file.endsWith('.controller.ts'))
  const frontendFiles = listFiles(FRONTEND_SRC_DIR, file => /\.tsx?$/.test(file))
  const nextRouteFiles = listFiles(NEXT_ROUTES_DIR, file => file.replace(/\\/g, '/').endsWith('/route.ts'))
  const openApiDocument = YAML.parse(readFileSync(OPENAPI_FILE, 'utf8'))
  validateReleaseGateOperations(openApiDocument)
  const client = extractClientOperations(readSources(clientFiles))
  const backend = extractBackendOperations(readSources(backendFiles))
  const openapi = extractOpenApiOperations(openApiDocument)
  const nextClientInventory = extractNextClientInventory(readSources(frontendFiles))
  const nextClient = nextClientInventory.operations
  const { local: nextRoutes, proxyTargets } = extractNextRouteOperations(readSources(nextRouteFiles))
  const drift = calculateDrift({ client, backend, openapi, nextClient, nextRoutes, proxyTargets })

  console.log(`client: ${clientFiles.length} files, ${client.size} operations`)
  console.log(`backend: ${backendFiles.length} files, ${backend.size} operations`)
  console.log(`openapi: 1 files, ${openapi.size} operations`)
  console.log(`next-client: ${frontendFiles.length} files, ${nextClient.size} operations`)
  console.log(`next-routes: ${nextRouteFiles.length} files, ${nextRoutes.size} operations`)
  console.log(`proxy-targets: ${nextRouteFiles.length} files, ${proxyTargets.size} operations`)

  const registry = parseRegistry()
  const approvedNonContractPaths = parseApprovedNonContractPaths()
  const openApiPaths = new Set([...openapi.keys()].map(operation => operation.split(' ')[1]))
  let failures = nextClientInventory.errors.length

  for (const error of nextClientInventory.errors) console.error(error.message)

  for (const [operation, entry] of registry.entries()) {
    if (!ALLOWED_DECISIONS.has(entry.decision)) {
      console.error(`Invalid decision for ${operation}: ${entry.decision}`)
      failures++
    }
    if (!entry.verification || entry.verification.length < 8) {
      console.error(`Missing verification for ${operation}`)
      failures++
    }
  }

  for (const item of drift) {
    if (!registry.has(item.operation)) {
      const location = item.source ? ` (${item.source.file}:${item.source.line})` : ''
      console.error(`${item.layer}: ${item.operation}${location}`)
      failures++
    }
  }

  for (const operation of registry.keys()) {
    if (!drift.some(item => item.operation === operation)) {
      console.error(`Stale API contract drift registration: ${operation}`)
      failures++
    }
  }

  for (const path of approvedNonContractPaths) {
    if ([...registry.keys()].some(operation => operation.endsWith(` ${path}`))) {
      console.error(`Approved non-contract path is still in drift registry: ${path}`)
      failures++
    }
    if (openApiPaths.has(path)) {
      console.error(`Approved non-contract path must not be in executable OpenAPI paths: ${path}`)
      failures++
    }
  }

  if (failures > 0) {
    process.exit(1)
  }
  console.log(`API contract drift register OK: ${drift.length} drift rows`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
