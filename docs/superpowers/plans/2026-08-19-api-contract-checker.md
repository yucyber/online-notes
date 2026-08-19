# API 契约检查器全量扫描 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 API 契约门禁递归扫描真实前端调用，以 `METHOD + normalized path` 比较领域 API、NestJS、OpenAPI，并校验 Next 本地路由及代理目标。

**Architecture:** 将现有 path-only 正则拆成可测试的纯提取函数，文件系统边界只负责递归读取和传递 `{file,text}`。领域 API、后端、OpenAPI、Next 调用和 Next route 分别生成 operation 集合，统一漂移计算器按层比较；Next 本地路径与代理后端目标保持两层契约。

**Tech Stack:** Node.js ESM、`node:test`、内置 `fs/path`、现有 `yaml` 包；不新增依赖。

## Global Constraints

- 不引入 TypeScript compiler、Babel 或其他新依赖。
- 不修改业务路由、API wrapper 或 OpenAPI 内容。
- operation 格式固定为 `METHOD /normalized/path`。
- 动态参数 `${id}`、`{id}`、`:noteId`、`[id]` 统一为 `:id`。
- Planned/Discarded 继续使用 path-only；Active Drift Registry 使用完整 operation。
- 现有工作区业务改动不属于本计划，不得暂存或提交。

---

### Task 1: operation 归一化与领域三方提取器

**Files:**
- Modify: `scripts/check-api-contract.mjs:2-152`
- Modify: `scripts/check-api-contract.test.mjs:1-67`

**Interfaces:**
- Produces: `normalizeOperation(method, path, options?) -> string`
- Produces: `extractClientOperations(sources) -> Map<string, SourceLocation[]>`
- Produces: `extractBackendOperations(sources) -> Map<string, SourceLocation[]>`
- Produces: `extractOpenApiOperations(document) -> Map<string, SourceLocation[]>`
- `SourceLocation`: `{ file: string, line: number }`

- [ ] **Step 1: 写归一化失败测试**

```js
test('normalizes parameters without collapsing methods', () => {
  assert.equal(normalizeOperation('patch', '/notes/${id}?draft=1'), 'PATCH /api/notes/:id')
  assert.equal(normalizeOperation('put', '/api/notes/{noteId}'), 'PUT /api/notes/:id')
  assert.notEqual(normalizeOperation('patch', '/notes/:id'), normalizeOperation('put', '/notes/:id'))
})
```

- [ ] **Step 2: 验证 RED**

Run: `node --test --test-name-pattern="normalizes parameters" scripts/check-api-contract.test.mjs`

Expected: FAIL，提示 `normalizeOperation` 未导出。

- [ ] **Step 3: 写最小归一化实现**

```js
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

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
```

- [ ] **Step 4: 验证 GREEN**

Run: `node --test --test-name-pattern="normalizes parameters" scripts/check-api-contract.test.mjs`

Expected: PASS。

- [ ] **Step 5: 写真实领域调用失败测试**

```js
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
```

- [ ] **Step 6: 验证 RED**

Run: `node --test --test-name-pattern="nested domain" scripts/check-api-contract.test.mjs`

Expected: FAIL，提示 `extractClientOperations` 未导出。

- [ ] **Step 7: 实现三类提取器**

```js
const TYPED_HELPER_METHODS = new Map([
  ['getTyped', 'GET'], ['postTyped', 'POST'], ['patchTyped', 'PATCH'],
])

function addOperation(result, method, path, file, text, index, options) {
  const key = normalizeOperation(method, path, options)
  const source = { file, line: text.slice(0, index).split('\n').length }
  result.set(key, [...(result.get(key) || []), source])
}

export function extractClientOperations(sources) {
  const result = new Map()
  const direct = /\bapi\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^>]+>)?\s*\(\s*([`'"])([\s\S]*?)\2/g
  const typed = /\b(getTyped|postTyped|patchTyped)\s*(?:<[^>]+>)?\s*\(\s*([`'"])([\s\S]*?)\2/g
  const backendFetch = /fetch\(\s*`\$\{API_URL\}([^`]*)`\s*,\s*\{[\s\S]*?method:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/g
  for (const { file, text } of sources) {
    for (const match of text.matchAll(direct)) addOperation(result, match[1], match[3], file, text, match.index)
    for (const match of text.matchAll(typed)) addOperation(result, TYPED_HELPER_METHODS.get(match[1]), match[3], file, text, match.index)
    for (const match of text.matchAll(backendFetch)) addOperation(result, match[2], match[1], file, text, match.index)
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
```

`extractBackendOperations` 沿用现有 `@Controller` 与 method decorator 分段方式，但把 `paths.add(...)` 改为调用 `addOperation(...)`。通用 helper 的动态 `url` 和 `RUM_ENDPOINT` 不匹配上述规则；带 `API_URL` base 的模板 fetch 会剥离 base。每个 operation 记录文件和 1-based line。

- [ ] **Step 8: 补 Controller/OpenAPI method 测试**

```js
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
```

- [ ] **Step 9: 跑全量脚本单测**

Run: `node --test scripts/check-api-contract.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 10: 提交 Task 1**

```powershell
git add -- scripts/check-api-contract.mjs scripts/check-api-contract.test.mjs
git commit -m "refactor(api): 按操作扫描领域契约"
```

---

### Task 2: Next 本地路由与 AI 代理双层契约

**Files:**
- Modify: `scripts/check-api-contract.mjs`
- Modify: `scripts/check-api-contract.test.mjs`

**Interfaces:**
- Consumes: `normalizeOperation(method, path, { local })`
- Produces: `extractNextClientOperations(sources) -> Map<string, SourceLocation[]>`
- Produces: `extractNextRouteOperations(sources) -> { local: Map, proxyTargets: Map }`

- [ ] **Step 1: 写普通 Next route 失败测试**

```js
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
```

- [ ] **Step 2: 验证 RED**

Run: `node --test --test-name-pattern="explicit Next" scripts/check-api-contract.test.mjs`

Expected: FAIL，提示 Next extractor 未导出。

- [ ] **Step 3: 实现显式调用和普通 route 提取**

识别 `fetch('/api/*')`、`axios.<method>('/api/*')`、`postAiJson('/api/*')`。fetch 未声明 method 时按 GET。route 从 `app/api/` 后转换目录，`[id]` 归一为 `:id`，只为源码实际导出的 method 生成 operation。

```js
const NEXT_AXIOS_RE = /\baxios\.(get|post|put|patch|delete)\s*\(\s*([`'"])(\/api\/[\s\S]*?)\2/g
const NEXT_JSON_RE = /\bpostAiJson\s*\(\s*([`'"])(\/api\/[\s\S]*?)\1/g
const NEXT_FETCH_RE = /\bfetch\s*\(\s*([`'"])(\/api\/[\s\S]*?)\1\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g

function routePathFromFile(file) {
  const relative = file.replace(/\\/g, '/').split('/app/api/')[1].replace(/\/route\.ts$/, '')
  return `/api/${relative}`
}
```

fetch options 中用 `/method:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i` 取 method，未匹配时使用 GET。若 `/api/` 模板包含无法归一为单个动态 ID 的表达式（如 `${kind}` 改变资源段），抛 unresolved error。

- [ ] **Step 4: 写 AI catch-all 失败测试**

```js
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
```

- [ ] **Step 5: 验证 RED**

Run: `node --test --test-name-pattern="AI allowlists" scripts/check-api-contract.test.mjs`

Expected: FAIL，因为 catch-all 尚未展开。

- [ ] **Step 6: 实现 AI 静态展开**

只对 `app/api/ai/[...path]/route.ts` 解析 `STREAM_PATHS`、`JSON_PATHS` 字符串字面量。writer 映射 `POST /api/ai/writer/stream`，其他名称映射 `POST /api/ai/<name>`。集合或映射无法识别时抛出带文件位置的 unresolved error。

- [ ] **Step 7: 写动态第一方调用失败测试**

```js
test('rejects unresolved first-party Next calls', () => {
  assert.throws(
    () => extractNextClientOperations([{ file: 'x.ts', text: 'fetch(`/api/${kind}/${id}`)' }]),
    /Unresolved first-party Next API call.*x\.ts/,
  )
})
```

- [ ] **Step 8: 实现定位错误并跑全量单测**

Run: `node --test scripts/check-api-contract.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 9: 提交 Task 2**

```powershell
git add -- scripts/check-api-contract.mjs scripts/check-api-contract.test.mjs
git commit -m "feat(api): 校验 Next 本地接口契约"
```

---

### Task 3: 分层漂移、operation 登记与真实仓库 main

**Files:**
- Modify: `scripts/check-api-contract.mjs:154-259`
- Modify: `scripts/check-api-contract.test.mjs`
- Modify: `docs/api-contract-drift.md:1-14`

**Interfaces:**
- Produces: `calculateDrift(surfaces) -> Drift[]`
- `Drift`: `{ operation: string, layer: string, source?: SourceLocation }`

- [ ] **Step 1: 写分层漂移失败测试**

```js
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
```

- [ ] **Step 2: 验证 RED**

Run: `node --test --test-name-pattern="drift by layer" scripts/check-api-contract.test.mjs`

Expected: FAIL，提示 `calculateDrift` 未导出。

- [ ] **Step 3: 实现分层计算**

```text
client - backend               -> client-backend
backend - openapi              -> backend-openapi
openapi - backend              -> openapi-backend
nextClient - nextRoutes        -> next-client-route
proxyTargets.values - backend  -> next-proxy-backend
proxyTargets.values - openapi  -> next-proxy-openapi
```

后端多于领域客户端不报错。错误格式为 `layer: operation (file:line)`。

```js
export function calculateDrift({ client, backend, openapi, nextClient, nextRoutes, proxyTargets }) {
  const drift = []
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
  return drift.sort((a, b) => `${a.layer} ${a.operation}`.localeCompare(`${b.layer} ${b.operation}`))
}
```

- [ ] **Step 4: 写 operation registry 测试并更新 parser**

Active fixture 第一列使用 `PATCH /api/users/me`，断言 parse 后 key 保留 method；path-only 活跃项必须报错。Planned/Discarded fixture 继续返回 path 集合。

- [ ] **Step 5: 更新登记表说明**

把 `docs/api-contract-drift.md` 的扫描范围改为 `src/lib/api/**/*.ts`，Active 表第一列从“路径”改为“操作”；Planned/Discarded 的 `Path` 列不变。

- [ ] **Step 6: 接入递归真实仓库读取**

```js
function listFiles(dir, predicate) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(fullPath, predicate))
    else if (entry.isFile() && predicate(fullPath)) files.push(fullPath)
  }
  return files
}

function readSources(files) {
  return files.map(file => ({ file, text: readFileSync(file, 'utf8') }))
}
```

main 读取领域 `**/*.ts`、Controller `**/*.controller.ts`、前端 `**/*.{ts,tsx}`、Next `app/api/**/route.ts` 和 OpenAPI。输出各 surface 文件数/operation 数，存在未登记漂移时 exit code 1。

- [ ] **Step 7: 跑全量单测**

Run: `node --test scripts/check-api-contract.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 8: 跑真实契约检查**

Run: `npm run check:api-contract`

Expected: exit code 1，并至少报告：

```text
backend-openapi: PATCH /api/users/me
next-client-route: POST /api/auth/logout
```

不得出现领域客户端不存在后端的误报；五个 AI 本地调用和代理目标不得产生漂移。

- [ ] **Step 9: 检查范围并提交**

Run: `git diff --check`

Expected: exit code 0。

```powershell
git add -- scripts/check-api-contract.mjs scripts/check-api-contract.test.mjs docs/api-contract-drift.md
git commit -m "fix(api): 消除契约检查盲区"
```

---

### Task 4: 最终回归与规格对照

**Files:**
- Verify: `scripts/check-api-contract.mjs`
- Verify: `scripts/check-api-contract.test.mjs`
- Verify: `docs/api-contract-drift.md`
- Verify against: `docs/superpowers/specs/2026-08-19-api-contract-checker-design.md`

**Interfaces:**
- Produces: 完整单测和真实仓库扫描证据

- [ ] **Step 1: 运行完整单测**

Run: `node --test scripts/check-api-contract.test.mjs`

Expected: 0 failed。

- [ ] **Step 2: 运行真实扫描**

Run: `npm run check:api-contract`

Expected: 现有漂移未修复时 exit code 1 且只报告真实未登记项；“发现漂移”不算 checker 自身测试失败。

- [ ] **Step 3: 对照规格逐项核验**

确认有证据覆盖：递归 12 个领域文件、method 区分、四类动态参数、typed helper、known-base fetch、OpenAPI method、普通 Next route、AI 五条 allowlist、五个代理目标、unresolved 第一方调用、operation registry。

- [ ] **Step 4: 保护工作区既有改动**

Run: `git status --short`

Expected: 本计划文件均已提交；原有业务 modified/untracked 文件保持未暂存且未被覆盖。
