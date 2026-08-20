import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  calculateDrift,
  extractBackendInventory,
  extractBackendOperations,
  extractClientInventory,
  extractClientOperations,
  extractNextClientOperations,
  extractNextClientInventory,
  extractNextRouteInventory,
  extractNextRouteOperations,
  extractOpenApiInventory,
  extractOpenApiOperations,
  listFiles,
  normalizeOperation,
  parseApprovedNonContractPaths,
  parseRegistry,
  readSources,
  validateReleaseGateOperations,
} from './check-api-contract.mjs'

test('calculates contract drift by layer', () => {
  const drift = calculateDrift({
    client: new Map([['PUT /api/notes/:id', [{ file: 'notes.ts', line: 1 }]]]),
    backend: new Map([
      ['PATCH /api/notes/:id', [{ file: 'notes.controller.ts', line: 1 }]],
      ['POST /api/ai/summary', [{ file: 'ai.controller.ts', line: 1 }]],
    ]),
    openapi: new Map([['POST /api/ai/summary', [{ file: 'openapi.yaml', line: 1 }]]]),
    nextClient: new Map([['POST /api/auth/logout', [{ file: 'auth.ts', line: 1 }]]]),
    nextRoutes: new Map(),
    proxyTargets: new Map([['POST /api/ai/summary', 'POST /api/ai/summary']]),
  })
  assert.deepEqual(drift.map(item => [item.layer, item.operation]), [
    ['client-backend', 'PUT /api/notes/:id'],
    ['backend-openapi', 'PATCH /api/notes/:id'],
    ['next-client-route', 'POST /api/auth/logout'],
  ])
})

test('calculates reverse and proxy contract drift in stable order', () => {
  const proxySource = { file: 'route.ts', line: 9 }
  const drift = calculateDrift({
    client: new Map(),
    backend: new Map(),
    openapi: new Map([
      ['DELETE /api/z-orphan', [{ file: 'openapi-z.yaml', line: 3 }]],
      ['DELETE /api/a-orphan', [{ file: 'openapi-a.yaml', line: 2 }]],
    ]),
    nextClient: new Map(),
    nextRoutes: new Map([['POST /api/ai/local', [proxySource]]]),
    proxyTargets: new Map([['POST /api/ai/local', 'POST /api/ai/missing']]),
  })
  assert.deepEqual(drift, [
    {
      operation: 'DELETE /api/a-orphan',
      layer: 'openapi-backend',
      source: { file: 'openapi-a.yaml', line: 2 },
    },
    {
      operation: 'DELETE /api/z-orphan',
      layer: 'openapi-backend',
      source: { file: 'openapi-z.yaml', line: 3 },
    },
    {
      operation: 'POST /api/ai/missing',
      layer: 'next-proxy-backend',
      source: proxySource,
    },
    {
      operation: 'POST /api/ai/missing',
      layer: 'next-proxy-openapi',
      source: proxySource,
    },
  ])
})

test('parses active drift registry by operation', () => {
  const registry = parseRegistry(`
## Active Drift Registry

| 操作 | 消费者 | 后端状态 | OpenAPI 状态 | 决策 | 验证方式 |
| --- | --- | --- | --- | --- | --- |
| \`PATCH /api/users/me\` | settings | 已实现 | 缺失 | \`document-openapi\` | contract test |
`)
  assert.deepEqual([...registry.keys()], ['PATCH /api/users/me'])

  assert.throws(() => parseRegistry(`
## Active Drift Registry

| 操作 | 消费者 | 后端状态 | OpenAPI 状态 | 决策 | 验证方式 |
| --- | --- | --- | --- | --- | --- |
| \`/api/users/me\` | settings | 已实现 | 缺失 | \`document-openapi\` | contract test |
`), /Active drift registry requires an HTTP method: \/api\/users\/me/)
})

test('keeps planned and discarded registry entries as paths', () => {
  const paths = parseApprovedNonContractPaths(`
## Planned APIs

| Path | Reason | Re-entry condition |
| --- | --- | --- |
| \`/api/v1/drafts/sync\` | planned | implementation |

## Discarded APIs

| Path | Reason | Replacement |
| --- | --- | --- |
| \`/api/v1/network/status\` | discarded | health |

## Active Drift Registry
`)
  assert.deepEqual([...paths].sort(), [
    '/api/v1/drafts/sync',
    '/api/v1/network/status',
  ])
})

test('reads matching source files recursively', () => {
  const directory = mkdtempSync(join(tmpdir(), 'api-contract-'))
  try {
    mkdirSync(join(directory, 'nested'))
    writeFileSync(join(directory, 'root.ts'), 'root')
    writeFileSync(join(directory, 'nested', 'child.ts'), 'child')
    writeFileSync(join(directory, 'nested', 'ignored.tsx'), 'ignored')

    const files = listFiles(directory, file => file.endsWith('.ts'))
    assert.deepEqual(files.map(file => basename(file)).sort(), ['child.ts', 'root.ts'])
    assert.deepEqual(
      readSources(files).map(source => [basename(source.file), source.text]).sort(),
      [['child.ts', 'child'], ['root.ts', 'root']],
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('continues Next client inventory after unresolved sources', () => {
  const inventory = extractNextClientInventory([{
    file: 'mixed.ts',
    text: [
      'fetch(`/api/${kind}/${id}`)',
      'fetch(`/api/${scope}/${slug}`)',
      "fetch('/api/auth/logout', { method: 'POST' })",
    ].join('\n'),
  }])
  assert.deepEqual([...inventory.operations.keys()], ['POST /api/auth/logout'])
  assert.deepEqual(inventory.errors.map(error => error.message), [
    'Unresolved first-party Next API call at mixed.ts:1',
    'Unresolved first-party Next API call at mixed.ts:2',
  ])
})

test('parses Next paths and methods without unsafe defaults', () => {
  const inventory = extractNextClientInventory([
    { file: 'dynamic-path.ts', text: 'fetch(`/api/${kind}`)' },
    { file: 'query.ts', text: 'fetch(`/api/search?q=${term}`)' },
    { file: 'dynamic-method.ts', text: "fetch('/api/dynamic-method', { method: verb })" },
    { file: 'head.ts', text: "fetch('/api/head', { method: 'HEAD' })" },
    { file: 'opaque.ts', text: "fetch('/api/opaque', init)" },
    { file: 'concat.ts', text: "axios.post('/api/ai/' + kind, body)" },
    { file: 'generic.ts', text: "axios.post<Result>('/api/generic', body)" },
    { file: 'commented-method.ts', text: "fetch('/api/commented', { /* note */ method: 'POST' })" },
    { file: 'commented-fetch-arg.ts', text: "fetch(/* local */ '/api/commented-fetch')" },
    { file: 'commented-axios-arg.ts', text: "axios.post(/* local */ '/api/commented-axios', body)" },
    { file: 'commented-spread.ts', text: "fetch('/api/spread', { /* note */ ...init })" },
    { file: 'computed-init.ts', text: "fetch('/api/computed', { [key]: 'POST' })" },
    { file: 'computed-static.ts', text: "fetch('/api/computed-static', { ['met' + 'hod']: 'POST' })" },
    { file: 'escaped-method.ts', text: "fetch('/api/escaped', { meth\\u006Fd: 'POST' })" },
    { file: 'quoted-interpolation.ts', text: "fetch('/api/notes/${id}')" },
    { file: 'template-id.ts', text: 'fetch(`/api/notes/${id}`)' },
    { file: 'parenthesized-fetch.ts', text: "fetch(('/api/parenthesized'), { method: 'POST' })" },
    { file: 'bracket-axios.ts', text: "axios['post']('/api/bracket', body)" },
    { file: 'optional-fetch.ts', text: "fetch?.('/api/optional')" },
    { file: 'optional-axios.ts', text: "axios.post?.('/api/optional-axios')" },
    { file: 'dynamic-json.ts', text: 'postAiJson(path, body)' },
    { file: 'generic-json.ts', text: "postAiJson<Result>('/api/json-generic', body)" },
    { file: 'plain.ts', text: "fetch('/api/plain')" },
    { file: 'headers.ts', text: "fetch('/api/headers', { headers: { Accept: 'application/json' } })" },
  ])

  assert.deepEqual([...inventory.operations.keys()].sort(), [
    'GET /api/commented-fetch',
    'GET /api/headers',
    'GET /api/notes/:id',
    'GET /api/plain',
    'GET /api/search',
    'POST /api/bracket',
    'POST /api/commented',
    'POST /api/commented-axios',
    'POST /api/generic',
    'POST /api/json-generic',
    'POST /api/parenthesized',
  ])
  assert.deepEqual(inventory.errors.map(error => error.message), [
    'Unresolved first-party Next API call at dynamic-path.ts:1',
    'Unresolved first-party Next API call at dynamic-method.ts:1',
    'Unresolved first-party Next API call at head.ts:1',
    'Unresolved first-party Next API call at opaque.ts:1',
    'Unresolved first-party Next API call at concat.ts:1',
    'Unresolved first-party Next API call at commented-spread.ts:1',
    'Unresolved first-party Next API call at computed-init.ts:1',
    'Unresolved first-party Next API call at computed-static.ts:1',
    'Unresolved first-party Next API call at escaped-method.ts:1',
    'Unresolved first-party Next API call at quoted-interpolation.ts:1',
    'Unresolved first-party Next API call at optional-fetch.ts:1',
    'Unresolved first-party Next API call at optional-axios.ts:1',
    'Unresolved first-party Next API call at dynamic-json.ts:1',
  ])
})

test('fails closed on unsupported contract syntax while retaining resolved operations', () => {
  const cases = [
    {
      name: 'domain call arguments',
      inventory: extractClientInventory([
        { file: 'api/variable.ts', text: 'api.get(path)' },
        { file: 'api/concat.ts', text: "api.get('/notes' + suffix)" },
        { file: 'api/typed.ts', text: 'getTyped(path)' },
        { file: 'api/backend-fetch.ts', text: "fetch(`${API_URL}/notes`, { method: 'GET' + suffix })" },
        { file: 'api/quoted-base.ts', text: "fetch('${API_URL}/notes', { method: 'GET' })" },
        { file: 'api/quoted-template.ts', text: "api.get('/notes/${id}')" },
        { file: 'api/optional-member.ts', text: "api?.get('/notes')" },
        { file: 'api/optional-call.ts', text: "api.get?.('/notes')" },
        { file: 'api/valid.ts', text: "api.post('/notes', body)" },
        { file: 'api/nested-generic.ts', text: "api.get<Result<Note>>('/nested')" },
      ]),
      operations: ['POST /api/notes', 'GET /api/nested'],
      errors: 8,
      message: /Unresolved domain API call/,
    },
    {
      name: 'backend decorator arguments',
      inventory: extractBackendInventory([
        {
          file: 'constant-controller.ts',
          text: "@Controller(ROUTE)\nclass Invalid {\n@Get('hidden') read() {}\n}",
        },
        {
          file: 'constant-method.ts',
          text: "@Controller('notes')\nclass Notes {\n@Get(PATH) hidden() {}\n@Post('visible') visible() {}\n}",
        },
        {
          file: 'unsupported-method.ts',
          text: "@Controller('notes')\nclass Notes {\n@Head('hidden') hidden() {}\n}",
        },
        {
          file: 'dynamic-controller.ts',
          text: '@Controller(`notes/${scope}`)\nclass Notes {\n@Get() hidden() {}\n}',
        },
        {
          file: 'orphan-method.ts',
          text: "class Notes {\n@Get('hidden') hidden() {}\n}",
        },
        {
          file: 'all-method.ts',
          text: "@Controller('notes')\nclass Notes {\n@All('hidden') hidden() {}\n}",
        },
        {
          file: 'sse-method.ts',
          text: "@Controller('notes')\nclass Notes {\n@Sse('events') events() {}\n}",
        },
      ]),
      operations: ['POST /api/notes/visible'],
      errors: 7,
      message: /Unresolved backend (?:Controller|Get|Head|All|Sse) decorator/,
    },
    {
      name: 'OpenAPI methods',
      inventory: extractOpenApiInventory({
        paths: {
          '/api/notes': { get: {}, head: {}, options: {} },
        },
      }),
      operations: ['GET /api/notes'],
      errors: 2,
      message: /Unresolved OpenAPI (?:HEAD|OPTIONS) operation/,
    },
    {
      name: 'Next route exports',
      inventory: extractNextRouteInventory([{
        file: 'src/app/api/example/route.ts',
        text: 'export const POST = async () => {}\nexport async function GET() {}',
      }, {
        file: 'src/app/api/reexport/route.ts',
        text: 'export { handler as PATCH }',
      }]),
      operations: ['GET /api/example'],
      errors: 2,
      message: /Unresolved Next route export/,
    },
  ]

  for (const scenario of cases) {
    const operations = scenario.inventory.operations || scenario.inventory.local
    assert.deepEqual([...operations.keys()], scenario.operations, scenario.name)
    assert.equal(scenario.inventory.errors.length, scenario.errors, scenario.name)
    for (const error of scenario.inventory.errors) assert.match(error.message, scenario.message, scenario.name)
  }

  const forwarding = extractClientInventory([{
    file: 'api/client.ts',
    text: "import { getTyped } from './helpers'\napi.get(url); getTyped(path); fetch(url); fetch(RUM_ENDPOINT, { method: 'POST' })",
  }])
  assert.equal(forwarding.operations.size, 0)
  assert.deepEqual(forwarding.errors, [])
})

test('rejects non-AI required and optional catch-all routes', () => {
  const inventory = extractNextRouteInventory([
    {
      file: 'src/app/api/files/[...path]/route.ts',
      text: 'export async function GET() {}',
    },
    {
      file: 'src/app/api/assets/[[...segments]]/route.ts',
      text: 'export async function POST() {}',
    },
    {
      file: 'src/app/api/notes/[id]/route.ts',
      text: 'export async function PATCH() {}',
    },
    {
      file: 'src/app/api/ai/[...path]/route.ts',
      text: 'export async function GET() {}',
    },
  ])

  assert.deepEqual([...inventory.local.keys()], ['PATCH /api/notes/:id'])
  assert.deepEqual(inventory.errors.map(error => error.message), [
    'Unresolved Next catch-all route at src/app/api/files/[...path]/route.ts:1',
    'Unresolved Next catch-all route at src/app/api/assets/[[...segments]]/route.ts:1',
    'Unresolved AI catch-all method at src/app/api/ai/[...path]/route.ts:1',
  ])
})

test('accumulates route unresolved with other operations and diagnostics', () => {
  const routeInventory = extractNextRouteInventory([
    {
      file: 'src/app/api/ai/[...path]/route.ts',
      text: [
        "const STREAM_PATHS = new Set(['writer'])",
        "const JSON_PATHS = new Set(['summary'])",
        "return { path: name === 'writer' ? '/ai/writer/stream' : `/ai/${target}`, mode: 'stream' }",
        "return { path: `/ai/${name}`, mode: 'json' }",
        'export async function POST() {}',
      ].join('\n'),
    },
    {
      file: 'src/app/api/auth/session/route.ts',
      text: 'export async function POST() {}',
    },
  ])
  const nextClientInventory = extractNextClientInventory([{
    file: 'mixed-client.ts',
    text: [
      'fetch(`/api/${kind}`)',
      "fetch('/api/missing', { method: 'POST' })",
    ].join('\n'),
  }])
  const drift = calculateDrift({
    client: new Map(),
    backend: new Map([['GET /api/backend-only', [{ file: 'backend.ts', line: 1 }]]]),
    openapi: new Map(),
    nextClient: nextClientInventory.operations,
    nextRoutes: routeInventory.local,
    proxyTargets: routeInventory.proxyTargets,
  })
  const diagnostics = [
    ...routeInventory.errors.map(error => error.message),
    ...nextClientInventory.errors.map(error => error.message),
    ...drift.map(item => `${item.layer}: ${item.operation}`),
  ]

  assert.deepEqual([...routeInventory.local.keys()], [
    'POST /api/ai/writer',
    'POST /api/ai/summary',
    'POST /api/auth/session',
  ])
  assert.deepEqual(diagnostics, [
    'Unresolved AI route mapping at src/app/api/ai/[...path]/route.ts:1',
    'Unresolved first-party Next API call at mixed-client.ts:1',
    'backend-openapi: GET /api/backend-only',
    'next-client-route: POST /api/missing',
  ])
})

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
