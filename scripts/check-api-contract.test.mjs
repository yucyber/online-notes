import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractBackendOperations,
  extractClientOperations,
  extractNextClientOperations,
  extractNextRouteOperations,
  extractOpenApiOperations,
  normalizeOperation,
  validateReleaseGateOperations,
} from './check-api-contract.mjs'

function createValidDocument() {
  return {
    paths: {
      '/api/auth/logout': {
        post: {
          responses: { '200': { $ref: '#/components/responses/LogoutEnvelope' } },
        },
      },
      '/api/notes/{id}/room-ticket': {
        parameters: [{ $ref: '#/components/parameters/Id' }],
        post: {
          security: [{ CookieAuth: [] }, { BearerAuth: [] }],
          responses: { '201': { $ref: '#/components/responses/RoomTicketEnvelope' } },
        },
      },
    },
    components: {
      parameters: {
        Id: { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      },
      securitySchemes: {
        CookieAuth: { type: 'apiKey', in: 'cookie', name: 'notes_token' },
        BearerAuth: { type: 'http', scheme: 'bearer' },
      },
      responses: {
        LogoutEnvelope: {
          content: {
            'application/json': {
              schema: {
                allOf: [{ $ref: '#/components/schemas/ApiEnvelope' }, {
                  type: 'object',
                  required: ['data'],
                  properties: { data: { $ref: '#/components/schemas/LogoutResult' } },
                }],
              },
            },
          },
        },
        RoomTicketEnvelope: {
          content: {
            'application/json': {
              schema: {
                allOf: [{ $ref: '#/components/schemas/ApiEnvelope' }, {
                  type: 'object',
                  required: ['data'],
                  properties: { data: { $ref: '#/components/schemas/RoomTicket' } },
                }],
              },
            },
          },
        },
      },
      schemas: {
        LogoutResult: {
          type: 'object',
          required: ['message'],
          properties: { message: { type: 'string' } },
        },
        RoomTicket: {
          type: 'object',
          required: ['ticket', 'role', 'expiresIn'],
          properties: {
            ticket: { type: 'string' },
            role: { type: 'string', enum: ['writer', 'reader'] },
            expiresIn: { type: 'integer' },
          },
        },
      },
    },
  }
}

test('accepts the expected logout and room-ticket contract', () => {
  assert.doesNotThrow(() => validateReleaseGateOperations(createValidDocument()))
})

test('rejects release-gate operation drift', () => {
  const cases = [
    ['logout POST', (doc) => { delete doc.paths['/api/auth/logout'].post }],
    ['LogoutEnvelope', (doc) => { delete doc.components.responses.LogoutEnvelope }],
    ['LogoutResult.message', (doc) => { delete doc.components.schemas.LogoutResult.properties.message }],
    ['room-ticket POST', (doc) => { delete doc.paths['/api/notes/{id}/room-ticket'].post }],
    ['room-ticket Id parameter', (doc) => { doc.paths['/api/notes/{id}/room-ticket'].parameters = [] }],
    ['CookieAuth', (doc) => { doc.paths['/api/notes/{id}/room-ticket'].post.security = [{ BearerAuth: [] }] }],
    ['BearerAuth', (doc) => { doc.paths['/api/notes/{id}/room-ticket'].post.security = [{ CookieAuth: [] }] }],
    ['CookieAuth scheme', (doc) => { doc.components.securitySchemes.CookieAuth.name = 'wrong_cookie' }],
    ['BearerAuth scheme', (doc) => { doc.components.securitySchemes.BearerAuth.scheme = 'basic' }],
    ['Id parameter definition', (doc) => { doc.components.parameters = { Id: { name: 'wrong', in: 'query', required: false, schema: { type: 'number' } } } }],
    ['RoomTicketEnvelope', (doc) => { delete doc.components.responses.RoomTicketEnvelope }],
    ['RoomTicketEnvelope.data', (doc) => { doc.components.responses.RoomTicketEnvelope.content['application/json'].schema.allOf[1].required = [] }],
    ['RoomTicket required fields', (doc) => { doc.components.schemas.RoomTicket.required = ['ticket'] }],
    ['RoomTicket field types', (doc) => { doc.components.schemas.RoomTicket.properties.expiresIn.type = 'string' }],
    ['RoomTicket role enum', (doc) => { doc.components.schemas.RoomTicket.properties.role.enum = ['writer'] }],
  ]

  for (const [message, mutate] of cases) {
    const document = createValidDocument()
    mutate(document)
    assert.throws(() => validateReleaseGateOperations(document), new RegExp(message))
  }
})

test('normalizes parameters without collapsing methods', () => {
  assert.equal(normalizeOperation('patch', '/notes/${id}?draft=1'), 'PATCH /api/notes/:id')
  assert.equal(normalizeOperation('put', '/api/notes/{noteId}'), 'PUT /api/notes/:id')
  assert.equal(normalizeOperation('get', '/api'), 'GET /api')
  assert.notEqual(normalizeOperation('patch', '/notes/:id'), normalizeOperation('put', '/notes/:id'))
})

test('extracts nested domain API operations', () => {
  const operations = extractClientOperations([
    { file: 'api/notes.ts', text: "api.put<Note>(`/notes/${id}`, body)" },
    { file: 'api/users.ts', text: "patchTyped<User>('/users/me', dto)" },
    { file: 'api/server-notes.ts', text: "fetch(`${API_URL}/notes/${id}`, { method: 'GET' })" },
    { file: 'api/client.ts', text: "getTyped(url); fetch(RUM_ENDPOINT, { method: 'POST' })" },
  ])
  assert.deepEqual([...operations.keys()].sort(), [
    'GET /api/notes/:id', 'PATCH /api/users/me', 'PUT /api/notes/:id',
  ])
})

test('extracts explicit Next calls and filesystem routes', () => {
  const client = extractNextClientOperations([
    { file: 'auth.ts', text: "fetch('/api/auth/logout', { method: 'POST' })" },
    { file: 'page.tsx', text: "axios.post('/api/ai/summary', body)" },
  ])
  const routes = extractNextRouteOperations([{
    file: 'src/app/api/auth/logout/route.ts', text: 'export async function POST() {}',
  }])
  assert.ok(client.has('POST /api/auth/logout'))
  assert.ok(routes.local.has('POST /api/auth/logout'))
  assert.ok(client.has('POST /api/ai/summary'))
})

test('expands AI allowlists and proxy targets', () => {
  const routes = extractNextRouteOperations([{
    file: 'src/app/api/ai/[...path]/route.ts',
    text: [
      "const STREAM_PATHS = new Set(['writer', 'pet'])",
      "const JSON_PATHS = new Set(['mindmap', 'mermaid', 'summary'])",
      "path: name === 'writer' ? '/ai/writer/stream' : `/ai/${name}`",
      "return { path: `/ai/${name}`, mode: 'json' }",
      'export async function POST() {}',
    ].join('\n'),
  }])
  assert.equal(routes.local.size, 5)
  assert.equal(routes.proxyTargets.get('POST /api/ai/writer'), 'POST /api/ai/writer/stream')
  assert.equal(routes.proxyTargets.get('POST /api/ai/pet'), 'POST /api/ai/pet')
})

test('derives AI proxy targets from route mappings', () => {
  const routes = extractNextRouteOperations([{
    file: 'src/app/api/ai/[...path]/route.ts',
    text: [
      "const STREAM_PATHS = new Set(['writer', 'pet'])",
      "const JSON_PATHS = new Set(['mindmap'])",
      "return { path: name === 'writer' ? '/ai/writer/v2' : `/ai/${name}`, mode: 'stream' }",
      "return { path: `/ai/${name}`, mode: 'json' }",
      'export async function POST() {}',
    ].join('\n'),
  }])
  assert.equal(routes.proxyTargets.get('POST /api/ai/writer'), 'POST /api/ai/writer/v2')
  assert.equal(routes.proxyTargets.get('POST /api/ai/pet'), 'POST /api/ai/pet')
  assert.equal(routes.proxyTargets.get('POST /api/ai/mindmap'), 'POST /api/ai/mindmap')
})

test('rejects unresolved AI proxy mappings', () => {
  const file = 'src/app/api/ai/[...path]/route.ts'
  const route = (streamMapping, jsonMapping = 'return { path: `/ai/${name}`, mode: \'json\' }') => [
    "const STREAM_PATHS = new Set(['writer', 'pet'])",
    "const JSON_PATHS = new Set(['mindmap'])",
    streamMapping,
    jsonMapping,
    'export async function POST() {}',
  ].join('\n')
  const cases = [
    route('', 'return { path: `/ai/${name}`, mode: \'json\' }'),
    route("return { path: name === 'writer' ? '/ai/writer/stream' : `/ai/${target}`, mode: 'stream' }"),
    route("return { path: name === 'writer' ? '/ai/writer/stream' : `/ai/${name}`, mode: 'stream' }", "return { path: `/ai/${target}`, mode: 'json' }"),
  ]

  for (const text of cases) {
    assert.throws(
      () => extractNextRouteOperations([{ file, text }]),
      /Unresolved AI route mapping.*\[\.\.\.path\]\/route\.ts/,
    )
  }
})

test('rejects unresolved first-party Next calls', () => {
  assert.throws(
    () => extractNextClientOperations([{ file: 'x.ts', text: 'fetch(`/api/${kind}/${id}`)' }]),
    /Unresolved first-party Next API call.*x\.ts/,
  )
})

test('aligns controller and OpenAPI parameters while preserving methods', () => {
  const backend = extractBackendOperations([{
    file: 'notes.controller.ts',
    text: "@Controller('notes')\nclass Notes {\n@Patch(':id') update() {}\n}",
  }])
  const openapi = extractOpenApiOperations({ paths: { '/api/notes/{id}': { patch: {}, put: {} } } })
  assert.ok(backend.has('PATCH /api/notes/:id'))
  assert.ok(openapi.has('PATCH /api/notes/:id'))
  assert.ok(openapi.has('PUT /api/notes/:id'))
})
