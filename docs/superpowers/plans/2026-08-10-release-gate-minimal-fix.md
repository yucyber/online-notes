# 发布门禁最小修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让协作鉴权测试和 API 契约检查恢复通过，并用完整验证结果更新整改报告。

**Architecture:** 保留现有 HttpOnly Cookie → room-ticket → Yjs WebSocket 鉴权链路，只迁移已经过期的前端测试。OpenAPI 以现有 controller 和 service 返回值为准补登记两个路由，不修改生产业务代码。

**Tech Stack:** Next.js 16、React 18、Jest、Testing Library、NestJS 10、OpenAPI 3.0、PowerShell/npm。

## Global Constraints

- 只修改关键测试、`notes-backend/openapi.yaml` 和整改报告，不修改生产业务代码。
- 复杂回归背景只用简洁中文注释；API、Yjs、JWT、ACL 等术语保留英文。
- Commit message 使用 `类型(范围): 中文简述`。
- 不处理覆盖率、结构债、i18n、依赖升级或 browser E2E。
- 所有“通过”结论必须来自本分支上的新鲜命令输出。

---

### Task 1: 将协作鉴权测试迁移到 room-ticket 流程

**Files:**
- Modify: `notes-frontend/__tests__/editor.tiptap.auth.spec.tsx`
- Reference: `notes-frontend/src/components/editor/useTiptapCollab.ts`
- Reference: `notes-frontend/src/lib/api/notes.ts`

**Interfaces:**
- Consumes: `notesAPI.getRoomTicket(noteId): Promise<{ ticket: string; role: 'writer' | 'reader'; expiresIn: number }>`
- Produces: 覆盖 room-ticket 成功、获取失败和 WebSocket 配置缺失的 Jest 回归测试。

- [x] **Step 1: 运行现有测试并确认旧契约失败**

Run:

```powershell
cd notes-frontend
npm.cmd run ci:test -- --runInBand __tests__/editor.tiptap.auth.spec.tsx
```

Expected: FAIL；旧测试同步查找 provider，或期待 `协作需要登录`，与异步 room-ticket 实现不符。

- [x] **Step 2: mock room-ticket API 并清理旧 JWT 测试设施**

在测试文件 imports 前加入：

```typescript
const mockGetRoomTicket = jest.fn()

jest.mock('@/lib/api/notes', () => ({
  notesAPI: {
    getRoomTicket: (...args: unknown[]) => mockGetRoomTicket(...args),
  },
}))
```

在 `beforeEach` 中重置 mock，并删除 `localStorage.clear()`、`jwtWithExp()` 和所有 `localStorage.setItem('notes_token', ...)`：

```typescript
beforeEach(() => {
  mockGetRoomTicket.mockReset()
  ;(WebsocketProvider as any).instances.length = 0
  process.env.NEXT_PUBLIC_YWS_URL = 'ws://localhost:1234'
})
```

- [x] **Step 3: 改写成功场景为异步 room-ticket 断言**

将旧的 `passes access_token ... when token exists` 测试改为：

```typescript
test('passes the room ticket to WebsocketProvider after ticket issuance', async () => {
  mockGetRoomTicket.mockResolvedValue({ ticket: 'room-ticket', role: 'writer', expiresIn: 300 })

  render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => {}} user={user} />)

  await waitFor(() => expect((WebsocketProvider as any).instances).toHaveLength(1))
  expect(mockGetRoomTicket).toHaveBeenCalledWith('n1')
  expect((WebsocketProvider as any).instances[0].options.params.access_token).toBe('room-ticket')
})
```

同时从 Testing Library import 中加入 `waitFor`。

- [x] **Step 4: 改写失败和配置缺失场景**

用以下两个测试替换旧的缺 token、token 过期和缺 URL 场景：

```typescript
test('degrades without creating a provider when room-ticket issuance fails', async () => {
  mockGetRoomTicket.mockRejectedValue(new Error('unauthorized'))

  render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => {}} user={user} />)

  expect(await screen.findByText('协作鉴权失败')).toBeInTheDocument()
  expect((WebsocketProvider as any).instances).toHaveLength(0)
})

test('renders readable status when websocket url is missing', async () => {
  mockGetRoomTicket.mockResolvedValue({ ticket: 'room-ticket', role: 'writer', expiresIn: 300 })
  delete process.env.NEXT_PUBLIC_YWS_URL

  render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => {}} user={user} />)

  expect(await screen.findByText('协作配置缺失')).toBeInTheDocument()
  expect((WebsocketProvider as any).instances).toHaveLength(0)
})
```

- [x] **Step 5: 运行定向测试确认通过**

Run:

```powershell
cd notes-frontend
npx.cmd jest --runInBand --coverage=false __tests__/editor.tiptap.auth.spec.tsx
```

Expected: PASS，3 tests passed，0 failed。定向验证关闭 coverage，完整 coverage 门禁由 Task 3 执行；否则单文件覆盖率会触发全局阈值并造成假失败。

- [x] **Step 6: 提交测试迁移**

```powershell
git add notes-frontend/__tests__/editor.tiptap.auth.spec.tsx
git commit -m "test(协作): 迁移房间票据鉴权测试" -m "旧测试仍依赖浏览器可读 JWT；改为验证异步 room-ticket 获取、连接参数和失败降级。"
```

---

### Task 2: 补登记 OpenAPI 路由和响应结构

**Files:**
- Modify: `notes-backend/openapi.yaml`
- Reference: `notes-backend/src/modules/auth/auth.controller.ts`
- Reference: `notes-backend/src/modules/notes/notes.controller.ts`
- Reference: `notes-backend/src/modules/notes/notes.service.ts`

**Interfaces:**
- Consumes: `POST /api/auth/logout` 返回 `{ message: 'OK' }`；`POST /api/notes/{id}/room-ticket` 返回 `{ ticket, role, expiresIn }`。
- Produces: OpenAPI paths `POST /api/auth/logout`、`POST /api/notes/{id}/room-ticket` 和 schema `RoomTicket`。

- [x] **Step 1: 运行契约检查确认两个未登记路由**

Run:

```powershell
npm.cmd run check:api-contract
```

Expected: FAIL，报告 `/api/auth/logout` 和 `/api/notes/:id/room-ticket` 未登记。

- [x] **Step 2: 登记 logout 路由**

在 `/api/auth/login` 和 `/api/auth/me` 之间加入：

```yaml
  /api/auth/logout:
    post:
      tags: [Auth]
      summary: 退出登录并清除认证 Cookie
      responses:
        '200':
          $ref: '#/components/responses/Ok'
```

该接口只清除 Cookie，不要求有效登录态，因此不声明 `BearerAuth`。

- [x] **Step 3: 登记 room-ticket 路由**

在 `/api/notes/{id}/lock` 前加入：

```yaml
  /api/notes/{id}/room-ticket:
    parameters:
      - $ref: '#/components/parameters/Id'
    post:
      tags: [Notes]
      summary: 签发笔记协作房间短时票据
      security:
        - CookieAuth: []
        - BearerAuth: []
      responses:
        '201':
          $ref: '#/components/responses/RoomTicketEnvelope'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '404':
          $ref: '#/components/responses/NotFound'
```

NestJS `@Post` 未显式设置状态码，因此契约使用 `201`。

在 `components.securitySchemes` 中补充 Cookie 鉴权声明；两个 security requirement 并列表示 Cookie 或 Bearer 任一方式均可：

```yaml
    CookieAuth:
      type: apiKey
      in: cookie
      name: notes_token
```

- [x] **Step 4: 定义响应 envelope 和 schema**

在 `components.responses` 的 `NoteEnvelope` 后加入：

```yaml
    RoomTicketEnvelope:
      description: 协作房间短时票据
      content:
        application/json:
          schema:
            allOf:
              - $ref: '#/components/schemas/ApiEnvelope'
              - type: object
                properties:
                  data:
                    $ref: '#/components/schemas/RoomTicket'
```

在 `components.schemas` 的 `Note` 后加入：

```yaml
    RoomTicket:
      type: object
      required: [ticket, role, expiresIn]
      properties:
        ticket:
          type: string
          description: 仅用于指定笔记 Yjs 房间的短时 JWT
        role:
          type: string
          enum: [writer, reader]
        expiresIn:
          type: integer
          description: 有效期，单位为秒
          example: 300
```

- [x] **Step 5: 运行契约检查确认通过**

Run:

```powershell
npm.cmd run check:api-contract
```

Expected: PASS，输出 `API contract check passed`，退出码 0。

- [x] **Step 6: 提交 OpenAPI 契约**

```powershell
git add notes-backend/openapi.yaml
git commit -m "docs(openapi): 登记退出登录和房间票据接口" -m "使现有后端路由与 API 契约基线一致，恢复契约发布门禁。"
```

---

### Task 3: 全量验证并同步整改报告

**Files:**
- Modify: `docs/代码安全-重复逻辑-功能验收扫描报告-2026-08-07.md`

**Interfaces:**
- Consumes: Task 1 的 Jest 结果和 Task 2 的契约检查结果。
- Produces: 与本分支实际验证输出一致的整改记录。

- [x] **Step 1: 运行根目录静态门禁**

Run:

```powershell
npm.cmd run check:api-contract
npm.cmd run check:ai-config
```

Expected: 两条命令均退出码 0；AI 检查为 dry-run，不调用外部 provider。

- [x] **Step 2: 运行后端完整验证**

Run:

```powershell
cd notes-backend
npm.cmd run build
npm.cmd run test:unit
```

Expected: build 退出码 0；85 tests passed，0 failed。若仓库新增测试，以实际总数为准且必须 0 failed。

- [x] **Step 3: 运行 y-websocket 完整测试**

Run:

```powershell
cd y-websocket
npm.cmd test
```

Expected: 4 tests passed，0 failed。若仓库新增测试，以实际总数为准且必须 0 failed。

- [x] **Step 4: 运行前端完整验证**

Run:

```powershell
cd notes-frontend
npm.cmd run type-check
npm.cmd run lint
npm.cmd run ci:test -- --runInBand
npm.cmd run build
```

Expected: 所有命令退出码 0；Jest 7 suites、23 tests 全部通过；生产 build 成功。若仓库新增测试，以实际总数为准且必须 0 failed。

- [x] **Step 5: 更新整改报告**

在报告第 9 节新增 `2026-08-10 发布门禁收口` 小节，记录：

```markdown
### 9.5 发布门禁收口（2026-08-10）

| 检查项 | 状态 | 结果 |
| --- | --- | --- |
| 协作鉴权前端回归 | **已通过** | 测试已迁移到 room-ticket 异步流程；完整 Jest：7 suites / 23 tests 通过 |
| API 契约漂移 | **已修复** | 已登记 `POST /api/auth/logout` 与 `POST /api/notes/{id}/room-ticket`；`check:api-contract` 通过 |
| 后端 build / unit | **已通过** | TypeScript build 通过；85 tests 通过 |
| y-websocket unit | **已通过** | 4 tests 通过 |
| 前端 type-check / lint / build | **已通过** | type-check、ESLint 和 Next.js production build 通过 |

本轮未执行外部 AI live 请求、依赖 audit 和浏览器 E2E；这些项目不纳入本次最小修复的通过结论。
```

若执行时测试总数发生变化，按本轮命令的实际数字更新表格，且必须保持 0 failed。

- [x] **Step 6: 校验文档和工作区差异**

Run:

```powershell
git diff --check
git status --short
```

Expected: `git diff --check` 退出码 0；只有整改报告尚未提交。

- [x] **Step 7: 提交整改报告**

```powershell
git add "docs/代码安全-重复逻辑-功能验收扫描报告-2026-08-07.md"
git commit -m "docs(验收): 更新发布门禁验证结果" -m "记录协作测试和 API 契约收口后的完整验证证据，并明确本轮未覆盖的外部检查。"
```

- [x] **Step 8: 提交后进行最终验证**

重复 Step 1 至 Step 4 的全部命令，并运行：

```powershell
git status --short --branch
git log -4 --oneline
```

Expected: 所有门禁退出码 0，工作区干净，最近提交包含设计、计划、测试迁移、OpenAPI 契约、验收报告和审查修复。

## 已执行记录与偏差（2026-08-10）

- Task 1–3 已执行并提交；最终验证为前端 7 suites / 23 tests、后端 85 tests、y-websocket 4 tests，全部 0 failed。
- 定向 Jest 原命令因单文件 coverage 触发全局阈值而退出 1，已改为 `--coverage=false`；完整 coverage 门禁仍由全量 Jest 承担。
- 独立审查发现 room-ticket 漏写 Cookie 鉴权，提交 `f2c21e6` 已补充 `CookieAuth`，并在该提交后重新运行全部门禁，退出码均为 0。
- 未执行项：外部 AI live、依赖 audit、y-websocket 运行时 smoke、浏览器 E2E。
- 验收复扫追加的 Task 4–7 已完成：定向协作测试 3/3、契约语义测试 2/2，最终全量门禁通过。
- 安装 `yaml` 时 npm 摘要显示 1 low / 1 high；为控制范围未运行自动修复，完整 audit 仍保留为独立待办。

---

### Task 4: 强化 WebSocket URL 缺失回归测试

**Files:**
- Modify: `notes-frontend/__tests__/editor.tiptap.auth.spec.tsx`

**Interfaces:**
- Consumes: `notesAPI.getRoomTicket('n1')` 的成功 Promise。
- Produces: 能证明 ticket 请求已完成后仍因缺少 `NEXT_PUBLIC_YWS_URL` 而降级的回归测试。

- [x] **Step 1: 收紧配置缺失断言并观察失败**

在 `renders readable status when websocket url is missing` 中加入：

```typescript
await waitFor(() => expect(mockGetRoomTicket).toHaveBeenCalledWith('n1'))
expect(await screen.findByText('协作配置缺失')).toBeInTheDocument()
expect((WebsocketProvider as any).instances).toHaveLength(0)
```

Run:

```powershell
cd notes-frontend
npx.cmd jest --runInBand --coverage=false __tests__/editor.tiptap.auth.spec.tsx
```

Expected: 当前实现下测试通过；该补充属于断言完整性修正，不要求生产代码变化。如果断言失败，先确认 ticket effect 是否执行，不修改业务时序来迎合测试。

- [x] **Step 2: 提交测试强化**

```powershell
git add notes-frontend/__tests__/editor.tiptap.auth.spec.tsx
git commit -m "test(协作): 强化配置缺失场景断言" -m "确认 room-ticket 请求实际发生后仍不会在缺少 WebSocket URL 时创建 provider。"
```

---

### Task 5: 为新增契约建立语义级自动门禁

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/check-api-contract.mjs`
- Create: `scripts/check-api-contract.test.mjs`

**Interfaces:**
- Consumes: `notes-backend/openapi.yaml` 的完整 OpenAPI document。
- Produces: `validateReleaseGateOperations(document)`；对 logout 和 room-ticket 的 method、status、security、参数与 schema 进行结构化验证。

- [x] **Step 1: 安装 YAML parser**

Run:

```powershell
npm.cmd install --save-dev yaml@^2.9.0
```

Expected: 根目录 `devDependencies` 新增 `yaml`，lockfile 同步更新；不引入生产运行时依赖。

- [x] **Step 2: 先写失败的语义验证测试**

创建 `scripts/check-api-contract.test.mjs`，用 `node:test` 构造最小 OpenAPI document，分别删除以下字段并断言 validator 抛错：

```javascript
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateReleaseGateOperations } from './check-api-contract.mjs'

test('rejects room-ticket without CookieAuth or BearerAuth alternatives', () => {
  const document = createValidDocument()
  document.paths['/api/notes/{id}/room-ticket'].post.security = [{ BearerAuth: [] }]
  assert.throws(() => validateReleaseGateOperations(document), /CookieAuth/)
})

test('rejects logout without typed message data', () => {
  const document = createValidDocument()
  delete document.components.schemas.LogoutResult.properties.message
  assert.throws(() => validateReleaseGateOperations(document), /LogoutResult\.message/)
})
```

同一文件还要覆盖 room-ticket 的 `post`、`201`、`Id` parameter、`RoomTicketEnvelope`、`required: [data]` 和 `RoomTicket.required`。

Run:

```powershell
node --test scripts/check-api-contract.test.mjs
```

Expected: FAIL，因为 validator 尚未导出。

- [x] **Step 3: 实现结构化解析和 validator**

在 `scripts/check-api-contract.mjs` 中：

```javascript
import YAML from 'yaml'

export function validateReleaseGateOperations(document) {
  // 精确检查两个本轮新增 operation；错误信息必须指出缺失的字段路径。
}
```

`main()` 使用 `YAML.parse(readFileSync(OPENAPI_FILE, 'utf8'))`，先执行现有 drift 检查，再调用 validator。通过 `if (import.meta.url === pathToFileURL(process.argv[1]).href) main()` 避免测试 import 时直接执行 CLI。

- [x] **Step 4: 验证 semantic tests 和正式门禁**

Run:

```powershell
node --test scripts/check-api-contract.test.mjs
npm.cmd run check:api-contract
```

Expected: semantic tests 全部通过；正式门禁在 Task 6 收紧真实 schema 前先因 `LogoutEnvelope` 缺失而失败，Task 6 完成后输出 0 drift rows 并退出 0。

- [x] **Step 5: 提交语义门禁**

```powershell
git add package.json package-lock.json scripts/check-api-contract.mjs scripts/check-api-contract.test.mjs
git commit -m "test(openapi): 增加发布接口语义门禁" -m "路径集合检查无法发现 method、鉴权和 schema 漂移；新增 YAML 结构化断言覆盖本轮两个接口。"
```

---

### Task 6: 收紧 logout 与 room-ticket 响应 schema

**Files:**
- Modify: `notes-backend/openapi.yaml`

**Interfaces:**
- Consumes: Task 5 的 `validateReleaseGateOperations(document)`。
- Produces: `LogoutEnvelope`、`LogoutResult`，以及强制包含 `data` 的 `RoomTicketEnvelope`。

- [x] **Step 1: 运行语义门禁确认当前 schema 失败**

Run:

```powershell
npm.cmd run check:api-contract
```

Expected: FAIL，指出 logout 缺少 typed `data.message`，或 room-ticket envelope 未将 `data` 标为 required。

- [x] **Step 2: 补充精确响应 schema**

将 logout 200 response 改为 `#/components/responses/LogoutEnvelope`，并新增：

```yaml
    LogoutEnvelope:
      description: 已清除认证 Cookie
      content:
        application/json:
          schema:
            allOf:
              - $ref: '#/components/schemas/ApiEnvelope'
              - type: object
                required: [data]
                properties:
                  data:
                    $ref: '#/components/schemas/LogoutResult'
```

新增 schema：

```yaml
    LogoutResult:
      type: object
      required: [message]
      properties:
        message:
          type: string
          example: OK
```

同时在 `RoomTicketEnvelope` 的扩展 object 中加入 `required: [data]`；保留 `RoomTicket.required: [ticket, role, expiresIn]`。

- [x] **Step 3: 验证并提交 schema**

Run:

```powershell
node --test scripts/check-api-contract.test.mjs
npm.cmd run check:api-contract
```

Expected: 两条命令退出码 0。

```powershell
git add notes-backend/openapi.yaml
git commit -m "docs(openapi): 收紧发布接口响应结构" -m "明确 logout 的 data.message，并要求 room-ticket envelope 必须包含票据数据。"
```

---

### Task 7: 收敛整改报告旧状态并完成补漏验收

**Files:**
- Modify: `docs/代码安全-重复逻辑-功能验收扫描报告-2026-08-07.md`

**Interfaces:**
- Consumes: Task 4–6 的最新验证输出。
- Produces: 不再同时出现“待 shell 恢复”和“已通过”的一致验收报告。

- [x] **Step 1: 修订历史状态而非删除历史证据**

- 将 9.1 中 room-ticket、HttpOnly Cookie、Throttler 的“待安装/待回归”改为当前状态，并引用 9.5 的验证数字。
- 将 9.2 的依赖 audit 保持“未验证”，不得写成已通过。
- 将 9.4 标题改为“历史待办（截至 2026-08-07）”，在标题下说明完成状态以 9.5 和本次补漏验收为准。
- 新增 9.6，记录语义门禁测试数量、定向协作测试 3/3，以及最新全量门禁结果。

- [x] **Step 2: 执行最终全量验证**

Run:

```powershell
npm.cmd run check:api-contract
npm.cmd run check:ai-config
cd notes-backend; npm.cmd run build; npm.cmd run test:unit
cd ../y-websocket; npm.cmd test
cd ../notes-frontend; npm.cmd run type-check; npm.cmd run lint; npm.cmd run ci:test -- --runInBand; npm.cmd run build
```

Expected: 所有命令退出码 0；报告只记录本次实际取得的数字。外部 AI live、audit、runtime smoke 和 browser E2E 继续明确为未验证。

- [x] **Step 3: 提交报告和最终检查**

```powershell
git add "docs/代码安全-重复逻辑-功能验收扫描报告-2026-08-07.md"
git commit -m "docs(验收): 收敛发布门禁历史状态" -m "消除旧待办与最新验证结论的冲突，并记录 OpenAPI 语义门禁补漏结果。"
git diff --check
git status --short --branch
```

Expected: `git diff --check` 退出 0，工作区干净。
