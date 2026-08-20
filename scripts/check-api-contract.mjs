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
const OPENAPI_OPERATION_METHODS = new Set([
  ...HTTP_METHODS,
  'HEAD',
  'OPTIONS',
  'TRACE',
])
const TYPED_HELPER_METHODS = new Map([
  ['getTyped', 'GET'],
  ['postTyped', 'POST'],
  ['patchTyped', 'PATCH'],
])

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

function sourceLine(text, index) {
  return text.slice(0, index).split('\n').length
}

function maskComments(text) {
  // 用等长空白屏蔽注释，避免 phantom candidate 且保留原始行号索引。
  const chars = text.split('')
  for (let index = 0; index < chars.length;) {
    const quote = chars[index]
    if (quote === "'" || quote === '"' || quote === '`') {
      index++
      while (index < chars.length) {
        if (chars[index] === '\\') index += 2
        else if (chars[index++] === quote) break
      }
      continue
    }
    if (chars[index] === '/' && chars[index + 1] === '/') {
      chars[index++] = ' '
      chars[index++] = ' '
      while (index < chars.length && chars[index] !== '\n') chars[index++] = ' '
      continue
    }
    if (chars[index] === '/' && chars[index + 1] === '*') {
      chars[index++] = ' '
      chars[index++] = ' '
      while (index < chars.length) {
        if (chars[index] === '*' && chars[index + 1] === '/') {
          chars[index++] = ' '
          chars[index++] = ' '
          break
        }
        if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' '
        index++
      }
      continue
    }
    index++
  }
  return chars.join('')
}

function readCallArguments(text, openParen) {
  // 只拆顶层参数；不完整的括号或字符串会返回 null，由上层 fail-closed。
  const argumentsList = []
  const stack = []
  let argumentStart = openParen + 1
  for (let index = argumentStart; index < text.length; index++) {
    const char = text[index]
    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      index++
      while (index < text.length) {
        if (text[index] === '\\') index += 2
        else if (text[index] === quote) break
        else index++
      }
      continue
    }
    if (char === '/' && text[index + 1] === '/') {
      index += 2
      while (index < text.length && text[index] !== '\n') index++
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index++
      index++
      continue
    }
    if (char === '(' || char === '{' || char === '[') {
      stack.push(char)
      continue
    }
    if (char === ')' && stack.length === 0) {
      const argument = text.slice(argumentStart, index).trim()
      if (argument) argumentsList.push({ text: argument, index: argumentStart })
      return { arguments: argumentsList, end: index }
    }
    if (char === ')' || char === '}' || char === ']') {
      stack.pop()
      continue
    }
    if (char === ',' && stack.length === 0) {
      argumentsList.push({ text: text.slice(argumentStart, index).trim(), index: argumentStart })
      argumentStart = index + 1
    }
  }
  return null
}

function findNamedCallCandidates(text, pattern) {
  const code = maskComments(text)
  return [...code.matchAll(pattern)].map(match => {
    let cursor = match.index + match[0].length
    while (/\s/.test(code[cursor] || '')) cursor++
    let optional = match[0].includes('?.')
    if (code.slice(cursor, cursor + 2) === '?.') {
      optional = true
      cursor += 2
      while (/\s/.test(code[cursor] || '')) cursor++
    }
    if (code[cursor] !== '<' && code[cursor] !== '(') return null
    if (code[cursor] === '<') {
      let depth = 0
      while (cursor < code.length) {
        if (code[cursor] === '<') depth++
        else if (code[cursor] === '>' && --depth === 0) {
          cursor++
          break
        }
        cursor++
      }
      while (/\s/.test(code[cursor] || '')) cursor++
    }
    const openParen = code[cursor] === '(' ? cursor : -1
    return {
      match,
      index: match.index,
      openParen,
      optional,
      call: openParen === -1 ? null : readCallArguments(text, openParen),
    }
  }).filter(Boolean)
}

function isFunctionDeclaration(text, index) {
  return /\bfunction\s*$/.test(maskComments(text.slice(0, index)))
}

function readLeadingStaticString(expression) {
  const value = String(expression).trim()
  const quote = value[0]
  if (quote !== "'" && quote !== '"' && quote !== '`') return null
  for (let index = 1; index < value.length; index++) {
    if (value[index] === '\\') {
      index++
      continue
    }
    if (value[index] === quote) {
      return { quote, value: value.slice(1, index), rest: value.slice(index + 1).trim() }
    }
  }
  return null
}

function readStaticLiteral(expression) {
  const literal = readLeadingStaticString(expression)
  return literal && !literal.rest ? literal : null
}

function readStaticString(expression) {
  return readStaticLiteral(expression)?.value ?? null
}

function unwrapParenthesizedExpression(expression) {
  let value = maskComments(String(expression)).trim()
  while (value.startsWith('(')) {
    const group = readCallArguments(value, 0)
    if (!group || group.end !== value.length - 1 || group.arguments.length !== 1) break
    value = group.arguments[0].text.trim()
  }
  return value
}

function hasQuotedInterpolation(literal) {
  return literal?.quote !== '`' && literal?.value.includes('${')
}

function recordUnresolved(errors, message) {
  const error = new Error(message)
  if (!errors) throw error
  errors.push(error)
}

function isClientForwardingHelper(file, expression) {
  const normalizedFile = file.replace(/\\/g, '/')
  return (normalizedFile === 'api/client.ts' || normalizedFile.endsWith('/api/client.ts'))
    && /^(?:url|path)$/.test(String(expression).trim())
}

function isEnvironmentEndpoint(expression) {
  const value = String(expression).trim()
  return /^[A-Z_$][A-Z0-9_$]*_ENDPOINT$/.test(value)
    || /^process\.env(?:\.[A-Z][A-Z0-9_]*|\[['"][A-Z][A-Z0-9_]*['"]\])$/.test(value)
}

function unresolvedDomainCall(errors, file, text, index) {
  recordUnresolved(errors, `Unresolved domain API call at ${file}:${sourceLine(text, index)}`)
}

function collectClientOperations(sources, errors) {
  const result = new Map()
  for (const { file, text } of sources) {
    const direct = findNamedCallCandidates(text, /\bapi\s*(?:\.|\?\.)\s*(get|post|put|patch|delete|head|options)\b/gi)
    const typed = findNamedCallCandidates(text, /\b(getTyped|postTyped|patchTyped)\b/g)
      .filter(candidate => !isFunctionDeclaration(text, candidate.index))
    const fetches = findNamedCallCandidates(text, /\bfetch\b/g)
      .filter(candidate => !isFunctionDeclaration(text, candidate.index))
    const candidates = [
      ...direct.map(candidate => ({ ...candidate, kind: 'direct' })),
      ...typed.map(candidate => ({ ...candidate, kind: 'typed' })),
      ...fetches.map(candidate => ({ ...candidate, kind: 'fetch' })),
    ].sort((left, right) => left.index - right.index)

    for (const candidate of candidates) {
      const firstArgument = candidate.call?.arguments[0]?.text
      const firstArgumentCode = unwrapParenthesizedExpression(firstArgument)
      if (candidate.kind === 'fetch'
        && (isEnvironmentEndpoint(firstArgumentCode) || isClientForwardingHelper(file, firstArgumentCode))) continue
      if (!candidate.call || !firstArgument) {
        unresolvedDomainCall(errors, file, text, candidate.index)
        continue
      }
      if (candidate.optional) {
        unresolvedDomainCall(errors, file, text, candidate.index)
        continue
      }

      if (candidate.kind === 'fetch') {
        const template = readStaticLiteral(firstArgumentCode)
        const method = parseFetchMethod(candidate.call)
        if (candidate.call.arguments.length !== 2
          || template?.quote !== '`'
          || !template.value.startsWith('${API_URL}')
          || !method) {
          unresolvedDomainCall(errors, file, text, candidate.index)
          continue
        }
        addOperation(result, method, template.value.slice('${API_URL}'.length), file, text, candidate.index)
        continue
      }

      const pathLiteral = readStaticLiteral(firstArgumentCode)
      if (!pathLiteral || hasQuotedInterpolation(pathLiteral)) {
        if (isClientForwardingHelper(file, firstArgumentCode)) continue
        unresolvedDomainCall(errors, file, text, candidate.index)
        continue
      }
      const method = candidate.kind === 'direct'
        ? candidate.match[1]
        : TYPED_HELPER_METHODS.get(candidate.match[1])
      if (!HTTP_METHODS.has(String(method).toUpperCase())) {
        unresolvedDomainCall(errors, file, text, candidate.index)
        continue
      }
      addOperation(result, method, pathLiteral.value, file, text, candidate.index)
    }
  }
  return result
}

export function extractClientOperations(sources) {
  return collectClientOperations(sources)
}

export function extractClientInventory(sources) {
  const errors = []
  const operations = collectClientOperations(sources, errors)
  return { operations, errors }
}

function assertResolvableNextPath(path, file, text, index) {
  const pathOnly = String(path).split('?')[0]
  const segments = pathOnly.split('/')
  const interpolations = pathOnly.match(/\$\{[^}]+\}/g) || []
  const resolvable = interpolations.every(interpolation => {
    const expression = interpolation.slice(2, -1).trim()
    return segments.includes(interpolation) && /^(?:id|[A-Za-z_$][\w$]*Id)$/.test(expression)
  })
  if (!resolvable) {
    throw new Error(`Unresolved first-party Next API call at ${file}:${sourceLine(text, index)}`)
  }
}

function splitTopLevelProperties(body) {
  return readCallArguments(`(${body})`, 0)?.arguments.map(argument => argument.text) || null
}

function parseFetchMethod(call) {
  if (!call || call.arguments.length === 0 || call.arguments.length > 2) return null
  if (call.arguments.length === 1) return 'GET'
  const options = call.arguments[1].text.trim()
  if (!options.startsWith('{') || !options.endsWith('}')) return null
  const optionsCode = maskComments(options)
  const properties = splitTopLevelProperties(optionsCode.slice(1, -1))
  if (!properties || properties.some(property => property.trim().startsWith('...'))) return null

  let method = null
  for (const property of properties) {
    const trimmed = property.trim()
    const colon = trimmed.indexOf(':')
    if (trimmed.startsWith('[') || (colon !== -1 && trimmed.slice(0, colon).includes('\\'))) return null
    const match = /^(?:method|['"]method['"])\s*:\s*([\s\S]+)$/.exec(trimmed)
    if (match) {
      if (method !== null) return null
      method = readStaticString(match[1])
      if (!method) return null
      continue
    }
    if (/^(?:(?:get|set)\s+)?(?:method\b|['"]method['"]|\[\s*['"]method)/.test(trimmed)) return null
  }
  // 只有可完整检查的 object literal 确认没有 method 时，才能安全采用 fetch 的 GET 默认值。
  if (method === null) return 'GET'
  const normalized = method.toUpperCase()
  return HTTP_METHODS.has(normalized) ? normalized : null
}

function unresolvedNextClientCall(errors, file, text, index) {
  recordUnresolved(errors, `Unresolved first-party Next API call at ${file}:${sourceLine(text, index)}`)
}

function collectNextClientOperations(sources, errors) {
  const result = new Map()
  for (const { file, text } of sources) {
    const candidates = [
      ...findNamedCallCandidates(text, /\bfetch\b/g)
        .filter(candidate => !isFunctionDeclaration(text, candidate.index))
        .map(candidate => ({ ...candidate, kind: 'fetch' })),
      ...findNamedCallCandidates(text, /\baxios\s*(?:\.|\?\.)\s*(get|post|put|patch|delete|head|options)\b/gi)
        .map(candidate => ({ ...candidate, kind: 'axios' })),
      ...findNamedCallCandidates(text, /\baxios\s*\[\s*['"](get|post|put|patch|delete|head|options)['"]\s*\]/gi)
        .map(candidate => ({ ...candidate, kind: 'axios' })),
      ...findNamedCallCandidates(text, /\bpostAiJson\b/g)
        .filter(candidate => !isFunctionDeclaration(text, candidate.index))
        .map(candidate => ({ ...candidate, kind: 'json' })),
    ].sort((left, right) => left.index - right.index)

    for (const candidate of candidates) {
      const firstArgument = candidate.call?.arguments[0]?.text || text.slice(candidate.openParen + 1)
      const firstArgumentCode = unwrapParenthesizedExpression(firstArgument)
      const leadingPath = readLeadingStaticString(firstArgumentCode)?.value
      if (leadingPath !== '/api' && !leadingPath?.startsWith('/api/')) {
        if (candidate.kind === 'json') unresolvedNextClientCall(errors, file, text, candidate.index)
        continue
      }
      if (candidate.optional) {
        unresolvedNextClientCall(errors, file, text, candidate.index)
        continue
      }
      const pathLiteral = readStaticLiteral(firstArgumentCode)
      const path = pathLiteral && !hasQuotedInterpolation(pathLiteral) ? pathLiteral.value : null
      let method = null
      if (path) {
        if (candidate.kind === 'fetch') method = parseFetchMethod(candidate.call)
        else if (candidate.kind === 'axios') {
          const verb = candidate.match[1].toUpperCase()
          method = HTTP_METHODS.has(verb) ? verb : null
        } else method = 'POST'
      }
      if (!path || !method) {
        unresolvedNextClientCall(errors, file, text, candidate.index)
        continue
      }
      try {
        assertResolvableNextPath(path, file, text, candidate.index)
      } catch (error) {
        if (!errors) throw error
        errors.push(error)
        continue
      }
      addOperation(result, method, path, file, text, candidate.index, { local: true })
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

function extractRouteMethods(text, file, errors) {
  const methods = []
  const code = maskComments(text)
  const exports = /\bexport\s+(?:(async)\s+)?(function|const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g
  for (const match of code.matchAll(exports)) {
    const method = match[3]
    const isSupportedFunction = match[2] === 'function'
      && HTTP_METHODS.has(method)
      && /^\s*\(/.test(code.slice(match.index + match[0].length))
    if (!isSupportedFunction) {
      recordUnresolved(errors, `Unresolved Next route export at ${file}:${sourceLine(text, match.index)}`)
      continue
    }
    methods.push({ method, index: match.index })
  }
  const reexports = /\bexport\s*\{([\s\S]*?)\}(?:\s*from\b[^;\n]+)?/g
  for (const match of code.matchAll(reexports)) {
    if (/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(match[1])) {
      recordUnresolved(errors, `Unresolved Next route export at ${file}:${sourceLine(text, match.index)}`)
    }
  }
  return methods
}

function collectNextRouteOperations(sources, errors) {
  const local = new Map()
  const proxyTargets = new Map()
  for (const { file, text } of sources) {
    if (!file.replace(/\\/g, '/').includes('/app/api/') || !file.endsWith('route.ts')) continue
    const methods = extractRouteMethods(text, file, errors)
    if (file.replace(/\\/g, '/').endsWith('/app/api/ai/[...path]/route.ts')) {
      for (const method of methods.filter(entry => entry.method !== 'POST')) {
        recordUnresolved(errors, `Unresolved AI catch-all method at ${file}:${sourceLine(text, method.index)}`)
      }
      if (!methods.some(entry => entry.method === 'POST')) continue
      let streamPaths
      let jsonPaths
      try {
        streamPaths = extractAiAllowlist(text, file, 'STREAM_PATHS')
        jsonPaths = extractAiAllowlist(text, file, 'JSON_PATHS')
      } catch (error) {
        // AI allowlist 只能影响当前 source，否则会遮蔽其他 route 与 drift diagnostics。
        if (!errors) throw error
        errors.push(error)
        continue
      }
      for (const name of streamPaths) {
        addOperation(local, 'POST', `/api/ai/${name}`, file, text, 0, { local: true })
      }
      for (const name of jsonPaths) {
        addOperation(local, 'POST', `/api/ai/${name}`, file, text, 0, { local: true })
      }

      let mappings
      try {
        mappings = extractAiProxyMappings(text, file)
      } catch (error) {
        // Local route 已能从 allowlist 确认；mapping 失败只阻断 proxy target，不能抹掉 local inventory。
        if (!errors) throw error
        errors.push(error)
        continue
      }
      for (const name of streamPaths) {
        const operation = normalizeOperation('POST', `/api/ai/${name}`, { local: true })
        const target = name === 'writer' ? mappings.writer : mappings.generic.replace('${name}', name)
        proxyTargets.set(operation, normalizeOperation('POST', target))
      }
      for (const name of jsonPaths) {
        const operation = normalizeOperation('POST', `/api/ai/${name}`, { local: true })
        if (!proxyTargets.has(operation)) {
          proxyTargets.set(operation, normalizeOperation('POST', mappings.generic.replace('${name}', name)))
        }
      }
      continue
    }
    const path = routePathFromFile(file)
    if (/\[\[?\.\.\.[^\]]+\]\]?/.test(path)) {
      recordUnresolved(errors, `Unresolved Next catch-all route at ${file}:1`)
      continue
    }
    for (const method of methods) {
      addOperation(local, method.method, path, file, text, method.index, { local: true })
    }
  }
  return { local, proxyTargets }
}

export function extractNextRouteOperations(sources) {
  return collectNextRouteOperations(sources)
}

export function extractNextRouteInventory(sources) {
  const errors = []
  const inventory = collectNextRouteOperations(sources, errors)
  return { ...inventory, errors }
}

function unresolvedBackendDecorator(errors, file, text, index, name) {
  recordUnresolved(errors, `Unresolved backend ${name} decorator at ${file}:${sourceLine(text, index)}`)
}

function extractDecoratorCandidates(text) {
  const candidates = []
  const code = maskComments(text)
  const decorators = /@(Controller|Get|Post|Put|Patch|Delete|Head|Options|All|Sse)\b/g
  for (const match of code.matchAll(decorators)) {
    const suffix = code.slice(match.index + match[0].length)
    const whitespace = suffix.match(/^\s*/)?.[0].length || 0
    const openParen = match.index + match[0].length + whitespace
    const call = code[openParen] === '(' ? readCallArguments(text, openParen) : null
    candidates.push({ name: match[1], index: match.index, call })
  }
  return candidates
}

function staticDecoratorPath(candidate) {
  if (!candidate.call || candidate.call.arguments.length > 1) return null
  if (candidate.call.arguments.length === 0) return ''
  const path = readStaticString(candidate.call.arguments[0].text)
  return path?.includes('${') ? null : path
}

function collectBackendOperations(sources, errors) {
  const result = new Map()

  for (const { file, text } of sources) {
    const candidates = extractDecoratorCandidates(text)
    const controllers = candidates.filter(candidate => candidate.name === 'Controller')
    const prefixes = new Map()
    for (const controller of controllers) {
      const prefix = staticDecoratorPath(controller)
      if (prefix === null) unresolvedBackendDecorator(errors, file, text, controller.index, controller.name)
      else prefixes.set(controller, prefix)
    }

    for (const method of candidates.filter(candidate => candidate.name !== 'Controller')) {
      if (!HTTP_METHODS.has(method.name.toUpperCase())) {
        unresolvedBackendDecorator(errors, file, text, method.index, method.name)
        continue
      }
      const route = staticDecoratorPath(method)
      if (route === null) {
        unresolvedBackendDecorator(errors, file, text, method.index, method.name)
        continue
      }
      const controller = controllers.findLast(candidate => candidate.index < method.index)
      if (!controller) {
        unresolvedBackendDecorator(errors, file, text, method.index, method.name)
        continue
      }
      const prefix = prefixes.get(controller)
      if (prefix === undefined) continue
      const joined = [prefix, route].filter(Boolean).join('/')
      addOperation(result, method.name, `/api/${joined}`.replace(/\/+/g, '/'), file, text, method.index)
    }
  }

  return result
}

export function extractBackendOperations(sources) {
  return collectBackendOperations(sources)
}

export function extractBackendInventory(sources) {
  const errors = []
  const operations = collectBackendOperations(sources, errors)
  return { operations, errors }
}

function collectOpenApiOperations(document, errors) {
  const result = new Map()
  for (const [path, pathItem] of Object.entries(document.paths || {})) {
    for (const [rawMethod, operation] of Object.entries(pathItem || {})) {
      const method = rawMethod.toUpperCase()
      if (!OPENAPI_OPERATION_METHODS.has(method) || !operation) continue
      if (!HTTP_METHODS.has(method)) {
        recordUnresolved(errors, `Unresolved OpenAPI ${method} operation at notes-backend/openapi.yaml:1`)
        continue
      }
      addOperation(result, method, path, 'notes-backend/openapi.yaml', '', 0)
    }
  }
  return result
}

export function extractOpenApiOperations(document) {
  return collectOpenApiOperations(document)
}

export function extractOpenApiInventory(document) {
  const errors = []
  const operations = collectOpenApiOperations(document, errors)
  return { operations, errors }
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
  const clientInventory = extractClientInventory(readSources(clientFiles))
  const client = clientInventory.operations
  const backendInventory = extractBackendInventory(readSources(backendFiles))
  const backend = backendInventory.operations
  const openApiInventory = extractOpenApiInventory(openApiDocument)
  const openapi = openApiInventory.operations
  const nextClientInventory = extractNextClientInventory(readSources(frontendFiles))
  const nextClient = nextClientInventory.operations
  const nextRouteInventory = extractNextRouteInventory(readSources(nextRouteFiles))
  const { local: nextRoutes, proxyTargets } = nextRouteInventory
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
  const unresolved = [
    ...nextClientInventory.errors,
    ...clientInventory.errors,
    ...backendInventory.errors,
    ...openApiInventory.errors,
    ...nextRouteInventory.errors,
  ]
  let failures = unresolved.length

  for (const error of unresolved) console.error(error.message)

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
