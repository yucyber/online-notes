# 稳定性与重构实施计划

> **给 agentic workers：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项实施本计划。步骤使用 checkbox（`- [ ]`）语法，便于执行过程中跟踪状态。

**目标：** 实现 `docs/superpowers/specs/2026-05-19-stability-refactor-design.md` 中已批准的第一阶段稳定性与可维护性修复。

**架构：** 按风险优先顺序推进：先修复 WebSocket 协作鉴权一致性，再收紧 Board/Mindmap 资源归属边界，随后建立 API 契约漂移清单，最后拆分 `NotesService`。实施过程中保持公开 Controller 路径、统一响应 envelope、前端 API 函数名稳定。

**技术栈：** Next.js App Router、React 18、Jest/ts-jest、NestJS 10、Mongoose、Redis、Yjs/y-websocket、Node 内置 test runner 与 `ts-node/register`。

---

## 文件地图

- 修改：`notes-frontend/src/components/editor/TiptapEditor.tsx`
  - 增加携带 token 的 `WebsocketProvider` 创建逻辑，并稳定表达鉴权/降级状态。
- 修改：`notes-frontend/__tests__/editor.tiptap.spec.tsx`
  - 增加 provider 参数、缺 token、缺 URL、组件清理相关测试。
- 修改：`notes-backend/package.json`
  - 使用 Node test runner 和现有 `ts-node` 增加最小 `test:unit` 脚本。
- 新建：`notes-backend/test/boards-mindmaps-access.test.ts`
  - 覆盖 Board/Mindmap service 的 owner 正常访问、跨用户拒绝、非法 ID、同 ID 创建冲突行为。
- 修改：`notes-backend/src/modules/boards/boards.controller.ts`
- 修改：`notes-backend/src/modules/boards/boards.service.ts`
- 修改：`notes-backend/src/modules/mindmaps/mindmaps.controller.ts`
- 修改：`notes-backend/src/modules/mindmaps/mindmaps.service.ts`
  - 将用户 ID 传入 get/update，并强制使用 `_id + userId` 查询。
- 修改：`notes-frontend/src/app/dashboard/boards/[id]/page.tsx`
- 修改：`notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx`
  - 401/403 不自动创建资源；只有确认 404 时才自动创建。
- 新建：`docs/api-contract-drift.md`
  - 面向人工审查的 API 契约漂移登记表。
- 新建：`scripts/check-api-contract.mjs`
  - 轻量校验脚本，确保每条契约漂移记录都有明确决策。
- 修改：`package.json`
  - 增加 `check:api-contract`。
- 新建：`notes-backend/src/modules/notes/note-access.service.ts`
  - 集中处理 ObjectId 解析和 Note 访问查询构造。
- 新建：`notes-backend/src/modules/notes/note-counter.service.ts`
  - 集中处理分类/标签计数差量。
- 修改：`notes-backend/src/modules/notes/notes.module.ts`
  - 注册新的服务。
- 修改：`notes-backend/src/modules/notes/notes.service.ts`
  - 将访问控制和计数逻辑委托给专用服务。
- 新建：`notes-backend/test/note-access-counter.test.ts`
  - 覆盖访问控制 helper 和计数差量 helper。

## 任务 1：增加后端单元测试入口

**文件：**
- 修改：`notes-backend/package.json`

- [ ] **步骤 1：增加单元测试脚本**

在 `notes-backend/package.json` 中，将 `scripts` 更新为包含：

```json
{
  "build": "tsc",
  "start": "node dist/main.js",
  "dev": "nodemon",
  "start:prod": "node dist/main.js",
  "test:unit": "node --test -r ts-node/register -r tsconfig-paths/register test/**/*.test.ts"
}
```

- [ ] **步骤 2：运行空的后端测试命令**

运行：

```bash
cd notes-backend
npm run test:unit
```

预期：如果没有发现测试文件，命令退出码为 `0`，或者输出“没有匹配测试文件”之类的信息。如果 Node 因没有测试文件而返回错误，先继续创建任务 3 的第一个测试，再回到该命令验证。

- [ ] **步骤 3：提交测试入口**

```bash
git add notes-backend/package.json
git commit -m "test: add backend unit test runner"
```

## 任务 2：修复 WebSocket 协作鉴权

**文件：**
- 修改：`notes-frontend/src/components/editor/TiptapEditor.tsx`
- 修改：`notes-frontend/__tests__/editor.tiptap.spec.tsx`

- [ ] **步骤 1：先写 provider token 行为的失败测试**

将以下测试追加到 `notes-frontend/__tests__/editor.tiptap.spec.tsx`：

```tsx
jest.mock('y-websocket', () => {
  const providerInstances: any[] = []
  class WebsocketProvider {
    static instances = providerInstances
    awareness = {
      clientID: 1,
      setLocalStateField: jest.fn(),
      getStates: jest.fn(() => new Map()),
      on: jest.fn(),
      off: jest.fn(),
    }
    on = jest.fn()
    off = jest.fn()
    destroy = jest.fn()
    wsconnected = false
    wsconnecting = false
    synced = false
    constructor(public url: string, public room: string, public doc: any, public options: any) {
      providerInstances.push(this)
    }
  }
  return { WebsocketProvider }
})

jest.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve()
    destroy = jest.fn()
  },
}))

describe('TiptapEditor collaboration auth', () => {
  const user = { id: 'u1', name: 'User One' }

  beforeEach(() => {
    jest.resetModules()
    localStorage.clear()
    process.env.NEXT_PUBLIC_YWS_URL = 'ws://localhost:1234'
  })

  test('passes access_token to WebsocketProvider when token exists', async () => {
    localStorage.setItem('notes_token', 'jwt-token')
    const { default: TiptapEditor } = await import('@/components/editor/TiptapEditor')
    const { WebsocketProvider } = await import('y-websocket')

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => {}} user={user} />)

    expect((WebsocketProvider as any).instances[0].options.params.access_token).toBe('jwt-token')
  })

  test('does not create provider when token is missing', async () => {
    const { default: TiptapEditor } = await import('@/components/editor/TiptapEditor')
    const { WebsocketProvider } = await import('y-websocket')

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => {}} user={user} />)

    expect((WebsocketProvider as any).instances).toHaveLength(0)
    expect(screen.getByText(/本地/)).toBeInTheDocument()
  })
})
```

- [ ] **步骤 2：运行测试，确认新测试失败**

运行：

```bash
cd notes-frontend
npm test -- __tests__/editor.tiptap.spec.tsx --runInBand
```

预期：至少一个新增测试失败，原因是当前 `TiptapEditor` 还没有传入 `params.access_token`。

- [ ] **步骤 3：引入 token helper**

在 `notes-frontend/src/components/editor/TiptapEditor.tsx` 中增加：

```tsx
import { getToken, getTokenExpiration } from '@/lib/auth'
```

- [ ] **步骤 4：扩展连接状态类型**

将：

```tsx
const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
```

替换为：

```tsx
type CollabStatus = 'config-missing' | 'auth-missing' | 'auth-expired' | 'auth-failed' | 'connecting' | 'connected' | 'disconnected'
const [connStatus, setConnStatus] = useState<CollabStatus>('connecting')
```

- [ ] **步骤 5：在创建 provider 前增加 token 检查**

在 WebSocket 相关 `useEffect` 内、`let p: WebsocketProvider | null = null` 之前插入：

```tsx
const token = getToken()
const expiresAt = token ? getTokenExpiration(token) : null

if (!token) {
  setLocalMode(true)
  setCollabEnabled(false)
  setProvider(null)
  setConnStatus('auth-missing')
  return
}

if (expiresAt && expiresAt <= Date.now()) {
  setLocalMode(true)
  setCollabEnabled(false)
  setProvider(null)
  setConnStatus('auth-expired')
  return
}
```

同时将缺少 URL 的分支改为：

```tsx
setConnStatus('config-missing')
```

- [ ] **步骤 6：向 WebsocketProvider 传入 token 参数**

将 provider 创建逻辑替换为：

```tsx
p = new WebsocketProvider(yws, room, ydoc, {
  connect: true,
  maxBackoffTime: 10000,
  disableBc: true,
  params: { access_token: token },
})
```

- [ ] **步骤 7：在 WebSocket close/error 时标记鉴权失败**

在 `connection-close` handler 中增加：

```tsx
if (e?.code === 1008 || e?.code === 4401 || String(e?.reason || '').includes('401')) {
  setConnStatus('auth-failed')
  setLocalMode(true)
  setCollabEnabled(false)
}
```

在 `connection-error` handler 中增加：

```tsx
if (String(e?.message || e || '').includes('401')) {
  setConnStatus('auth-failed')
  setLocalMode(true)
  setCollabEnabled(false)
}
```

- [ ] **步骤 8：运行前端聚焦测试**

运行：

```bash
cd notes-frontend
npm test -- __tests__/editor.tiptap.spec.tsx --runInBand
```

预期：`editor.tiptap.spec.tsx` 内所有测试通过。

- [ ] **步骤 9：提交协作鉴权修复**

```bash
git add notes-frontend/src/components/editor/TiptapEditor.tsx notes-frontend/__tests__/editor.tiptap.spec.tsx
git commit -m "fix: pass auth token to collaboration websocket"
```

## 任务 3：收紧 Board/Mindmap 资源归属权限

**文件：**
- 新建：`notes-backend/test/boards-mindmaps-access.test.ts`
- 修改：`notes-backend/src/modules/boards/boards.controller.ts`
- 修改：`notes-backend/src/modules/boards/boards.service.ts`
- 修改：`notes-backend/src/modules/mindmaps/mindmaps.controller.ts`
- 修改：`notes-backend/src/modules/mindmaps/mindmaps.service.ts`
- 修改：`notes-frontend/src/app/dashboard/boards/[id]/page.tsx`
- 修改：`notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx`

- [ ] **步骤 1：先写后端归属权限失败测试**

创建 `notes-backend/test/boards-mindmaps-access.test.ts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { Types } from 'mongoose'
import { BoardsService } from '../src/modules/boards/boards.service'
import { MindmapsService } from '../src/modules/mindmaps/mindmaps.service'

function createModel(seed: any[] = []) {
  const rows = [...seed]
  return {
    async create(data: any) {
      const doc = { _id: data._id || new Types.ObjectId(), id: String(data._id || new Types.ObjectId()), ...data }
      rows.push(doc)
      return doc
    },
    findOne(query: any) {
      return {
        lean: () => ({
          exec: async () => rows.find(row =>
            String(row._id) === String(query._id) &&
            String(row.userId) === String(query.userId)
          ) || null,
        }),
      }
    },
    findOneAndUpdate(query: any, update: any) {
      return {
        lean: () => ({
          exec: async () => {
            const row = rows.find(item =>
              String(item._id) === String(query._id) &&
              String(item.userId) === String(query.userId)
            )
            if (!row) return null
            Object.assign(row, update)
            return row
          },
        }),
      }
    },
  }
}

test('boards service denies cross-user read', async () => {
  const ownerId = new Types.ObjectId()
  const otherId = new Types.ObjectId()
  const boardId = new Types.ObjectId()
  const service = new BoardsService(createModel([{ _id: boardId, userId: ownerId, title: 'A', content: {} }]) as any)

  await assert.rejects(() => service.getById(String(boardId), String(otherId)), /Board not found/)
})

test('mindmaps service denies cross-user update', async () => {
  const ownerId = new Types.ObjectId()
  const otherId = new Types.ObjectId()
  const mapId = new Types.ObjectId()
  const service = new MindmapsService(createModel([{ _id: mapId, userId: ownerId, title: 'M', content: {} }]) as any)

  await assert.rejects(() => service.update(String(mapId), String(otherId), { title: 'Changed' }), /Mindmap not found/)
})
```

- [ ] **步骤 2：运行后端测试，确认失败**

运行：

```bash
cd notes-backend
npm run test:unit
```

预期：出现 TypeScript 或运行时失败，因为 `getById` 和 `update` 还没有接收 `userId` 参数。

- [ ] **步骤 3：更新 Board service 签名和 ID 校验**

在 `notes-backend/src/modules/boards/boards.service.ts` 中，将 `getById` 和 `update` 替换为：

```ts
private parseObjectId(id: string, label: string) {
  if (!Types.ObjectId.isValid(id)) {
    const { BadRequestException } = require('@nestjs/common')
    throw new BadRequestException(`${label} is invalid`)
  }
  return new Types.ObjectId(id)
}

async getById(id: string, userId: string) {
  const doc = await this.model.findOne({
    _id: this.parseObjectId(id, 'Board id'),
    userId: this.parseObjectId(userId, 'User id'),
  }).lean().exec()
  if (!doc) throw new NotFoundException('Board not found')
  return {
    id: String((doc as any).id || (doc as any)?._id),
    title: String((doc as any).title || ''),
    content: (doc as any).content,
  }
}

async update(id: string, userId: string, input: { title?: string; content?: any }) {
  const updateData: any = {}
  if (input.title !== undefined) updateData.title = input.title
  if (input.content !== undefined) updateData.content = input.content

  const doc = await this.model.findOneAndUpdate(
    {
      _id: this.parseObjectId(id, 'Board id'),
      userId: this.parseObjectId(userId, 'User id'),
    },
    updateData,
    { new: true },
  ).lean().exec()
  if (!doc) throw new NotFoundException('Board not found')
  return {
    id: String((doc as any).id || (doc as any)?._id),
    title: String((doc as any).title || ''),
    content: (doc as any).content,
  }
}
```

- [ ] **步骤 4：更新 Mindmap service 签名和 ID 校验**

在 `notes-backend/src/modules/mindmaps/mindmaps.service.ts` 中应用同样模式，并使用错误消息 `Mindmap id is invalid` 和 `Mindmap not found`。

- [ ] **步骤 5：从 controller 传入用户 ID**

在 `boards.controller.ts` 中，将：

```ts
async get(@Param('id') id: string) {
  return await this.svc.getById(id)
}

@Put(':id')
async update(@Param('id') id: string, @Body() payload: { title?: string; content?: any }) {
  return await this.svc.update(id, payload)
}
```

替换为：

```ts
async get(@Param('id') id: string, @Req() req: any) {
  return await this.svc.getById(id, req.user.id)
}

@Put(':id')
async update(@Param('id') id: string, @Req() req: any, @Body() payload: { title?: string; content?: any }) {
  return await this.svc.update(id, req.user.id, payload)
}
```

在 `mindmaps.controller.ts` 中重复同样的 controller 改法。

- [ ] **步骤 6：避免前端在权限错误时自动创建资源**

在 `dashboard/boards/[id]/page.tsx` 和 `dashboard/mindmaps/[id]/page.tsx` 中，将 catch 分支替换为：

```tsx
const status = e.response?.status
if (status === 404) {
  try {
    const created = await createBoard({ _id: id, title: '未命名画板' })
    setBoard(created)
    setError('')
  } catch {
    setError('创建画板失败')
  }
} else if (status === 401 || status === 403) {
  setError('无权限访问该画板')
} else {
  setError('加载画板失败')
}
```

Mindmap 页面使用 `createMindMap`、`setMap`，并使用文案 `未命名思维导图` / `无权限访问该思维导图` / `加载思维导图失败`。

- [ ] **步骤 7：运行后端测试和构建**

运行：

```bash
cd notes-backend
npm run test:unit
npm run build
```

预期：测试通过，TypeScript 构建退出码为 `0`。

- [ ] **步骤 8：提交 Board/Mindmap 权限修复**

```bash
git add notes-backend/test/boards-mindmaps-access.test.ts notes-backend/src/modules/boards notes-backend/src/modules/mindmaps notes-frontend/src/app/dashboard/boards/[id]/page.tsx notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx
git commit -m "fix: enforce board and mindmap ownership"
```

## 任务 4：增加 API 契约漂移登记表

**文件：**
- 新建：`docs/api-contract-drift.md`
- 新建：`scripts/check-api-contract.mjs`
- 修改：`package.json`

- [ ] **步骤 1：创建契约漂移登记表**

创建 `docs/api-contract-drift.md`：

```markdown
# API 契约漂移登记表

| 路径 | 消费者 | 后端状态 | OpenAPI 状态 | 决策 | 验证方式 |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/assets/base64` | `notes-frontend/src/lib/api.ts` `assetsAPI.uploadBase64` | 缺失 | 缺失 | `hide-client-entry` | 附件 UI 显示明确的“暂不可用”提示。 |
| `/api/v1/assets/:id` | `notes-frontend/src/lib/api.ts` `assetsAPI.getById` | 缺失 | 缺失 | `hide-client-entry` | 不把直接资产读取宣传为当前可用能力。 |
| `/api/v1/embeds` | `notes-frontend/src/lib/api.ts` `embedsAPI.create` | 缺失 | 缺失 | `hide-client-entry` | Embed 创建路径返回明确不可用提示，而不是静默失败。 |
| `/api/v1/drafts/auto-save` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/drafts/sync` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/vector/upsert` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/vector/batch-upsert` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/network/status` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/network/diagnostics` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/boards/:id` | Board 页面与资源嵌入 | 存在 | 缺失 | `implement-now` | 归属权限测试通过，并补充 OpenAPI 条目，或在登记表中标为可接受漂移。 |
| `/api/v1/mindmaps/:id` | Mindmap 页面与资源嵌入 | 存在 | 缺失 | `implement-now` | 归属权限测试通过，并补充 OpenAPI 条目，或在登记表中标为可接受漂移。 |
| `/api/v1/semantic/*` | 仪表盘主题与语义搜索 | 存在 | 部分覆盖 | `implement-now` | 后续语义检索专项测试覆盖 semantic controller 行为。 |
```

- [ ] **步骤 2：创建轻量登记表校验脚本**

创建 `scripts/check-api-contract.mjs`：

```js
import { readFileSync } from 'node:fs'

const file = 'docs/api-contract-drift.md'
const text = readFileSync(file, 'utf8')
const rows = text.split('\n').filter(line => line.startsWith('| `/api/'))
const allowed = new Set(['implement-now', 'hide-client-entry', 'mark-planned-or-remove'])

let failures = 0
for (const row of rows) {
  const cells = row.split('|').map(cell => cell.trim()).filter(Boolean)
  const path = cells[0]
  const decision = cells[4]?.replace(/`/g, '')
  const verification = cells[5]
  if (!allowed.has(decision)) {
    console.error(`Invalid decision for ${path}: ${decision}`)
    failures++
  }
  if (!verification || verification.length < 8) {
    console.error(`Missing verification for ${path}`)
    failures++
  }
}

if (rows.length < 10) {
  console.error(`Expected at least 10 drift rows, found ${rows.length}`)
  failures++
}

if (failures > 0) process.exit(1)
console.log(`API contract drift register OK: ${rows.length} rows`)
```

- [ ] **步骤 3：增加根目录脚本**

在根目录 `package.json` 中增加：

```json
{
  "scripts": {
    "check:api-contract": "node scripts/check-api-contract.mjs"
  },
  "devDependencies": {
    "ts-node": "^10.9.2"
  },
  "dependencies": {
    "@types/ws": "^8.18.1",
    "ws": "^8.18.3",
    "y-websocket": "^3.0.0",
    "yjs": "^13.6.28"
  }
}
```

- [ ] **步骤 4：运行契约检查**

运行：

```bash
npm run check:api-contract
```

预期：输出 `API contract drift register OK: 12 rows`。

- [ ] **步骤 5：提交契约登记表**

```bash
git add docs/api-contract-drift.md scripts/check-api-contract.mjs package.json
git commit -m "docs: add api contract drift register"
```

## 任务 5：拆分 Note 访问控制与计数职责

**文件：**
- 新建：`notes-backend/src/modules/notes/note-access.service.ts`
- 新建：`notes-backend/src/modules/notes/note-counter.service.ts`
- 新建：`notes-backend/test/note-access-counter.test.ts`
- 修改：`notes-backend/src/modules/notes/notes.module.ts`
- 修改：`notes-backend/src/modules/notes/notes.service.ts`

- [ ] **步骤 1：先写访问控制和计数差量失败测试**

创建 `notes-backend/test/note-access-counter.test.ts`：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { Types } from 'mongoose'
import { NoteAccessService } from '../src/modules/notes/note-access.service'
import { NoteCounterService } from '../src/modules/notes/note-counter.service'

test('note access parses valid object ids and rejects invalid ids', () => {
  const service = new NoteAccessService()
  const id = new Types.ObjectId()
  assert.equal(String(service.objectId(String(id), 'note id')), String(id))
  assert.throws(() => service.objectId('bad-id', 'note id'), /note id is invalid/)
})

test('note access builds editor write scope', () => {
  const service = new NoteAccessService()
  const noteId = new Types.ObjectId()
  const userId = new Types.ObjectId()
  const query = service.writeScope(String(noteId), String(userId))
  assert.deepEqual(query.$or[1].acl.$elemMatch.role.$in, ['owner', 'editor'])
})

test('note counter computes category and tag deltas', () => {
  const service = new NoteCounterService({} as any, {} as any)
  assert.deepEqual(service.diffIds(['a', 'b'], ['b', 'c']), { add: ['c'], remove: ['a'] })
})
```

- [ ] **步骤 2：运行测试，确认失败**

运行：

```bash
cd notes-backend
npm run test:unit
```

预期：出现 `note-access.service` 和 `note-counter.service` 的 module-not-found 错误。

- [ ] **步骤 3：创建 NoteAccessService**

创建 `notes-backend/src/modules/notes/note-access.service.ts`：

```ts
import { BadRequestException, Injectable } from '@nestjs/common'
import { Types } from 'mongoose'

@Injectable()
export class NoteAccessService {
  objectId(id: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`${label} is invalid`)
    return new Types.ObjectId(id)
  }

  readScope(noteId: string, userId: string) {
    const noteObjectId = this.objectId(noteId, 'note id')
    const userObjectId = this.objectId(userId, 'user id')
    return {
      _id: noteObjectId,
      $or: [
        { userId: userObjectId },
        { acl: { $elemMatch: { userId: userObjectId } } },
        { visibility: 'public' },
      ],
    }
  }

  writeScope(noteId: string, userId: string) {
    const noteObjectId = this.objectId(noteId, 'note id')
    const userObjectId = this.objectId(userId, 'user id')
    return {
      _id: noteObjectId,
      $or: [
        { userId: userObjectId },
        { acl: { $elemMatch: { userId: userObjectId, role: { $in: ['owner', 'editor'] } } } },
      ],
    }
  }

  ownerScope(noteId: string, userId: string) {
    const noteObjectId = this.objectId(noteId, 'note id')
    const userObjectId = this.objectId(userId, 'user id')
    return {
      _id: noteObjectId,
      $or: [
        { userId: userObjectId },
        { acl: { $elemMatch: { userId: userObjectId, role: 'owner' } } },
      ],
    }
  }
}
```

- [ ] **步骤 4：创建 NoteCounterService**

创建 `notes-backend/src/modules/notes/note-counter.service.ts`：

```ts
import { Injectable } from '@nestjs/common'
import { CategoriesService } from '../categories/categories.service'
import { TagsService } from '../tags/tags.service'

@Injectable()
export class NoteCounterService {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly tagsService: TagsService,
  ) {}

  diffIds(prev: string[], next: string[]) {
    const prevSet = new Set(prev.filter(Boolean))
    const nextSet = new Set(next.filter(Boolean))
    return {
      add: [...nextSet].filter(id => !prevSet.has(id)),
      remove: [...prevSet].filter(id => !nextSet.has(id)),
    }
  }

  async incrementForCreate(input: { categoryId?: string; categoryIds?: string[]; tags?: string[] }) {
    const categoryIds = new Set<string>()
    if (input.categoryId) categoryIds.add(input.categoryId)
    for (const id of input.categoryIds || []) categoryIds.add(id)
    await Promise.all([...categoryIds].map(id => this.categoriesService.incrementNoteCount(id)))
    await Promise.all((input.tags || []).map(id => this.tagsService.incrementNoteCount(id)))
  }

  async updateCategories(prev: string[], next: string[]) {
    const delta = this.diffIds(prev, next)
    await Promise.all([
      ...delta.add.map(id => this.categoriesService.incrementNoteCount(id)),
      ...delta.remove.map(id => this.categoriesService.decrementNoteCount(id)),
    ])
  }

  async updateTags(prev: string[], next: string[]) {
    const delta = this.diffIds(prev, next)
    await Promise.all([
      ...delta.add.map(id => this.tagsService.incrementNoteCount(id)),
      ...delta.remove.map(id => this.tagsService.decrementNoteCount(id)),
    ])
  }

  async decrementForDelete(input: { categoryId?: string; categoryIds?: string[]; tags?: string[] }) {
    const categoryIds = new Set<string>()
    if (input.categoryId) categoryIds.add(input.categoryId)
    for (const id of input.categoryIds || []) categoryIds.add(id)
    await Promise.all([...categoryIds].map(id => this.categoriesService.decrementNoteCount(id)))
    await Promise.all((input.tags || []).map(id => this.tagsService.decrementNoteCount(id)))
  }
}
```

- [ ] **步骤 5：在 NotesModule 中注册服务**

在 `notes-backend/src/modules/notes/notes.module.ts` 中增加 providers：

```ts
providers: [NotesService, NoteAccessService, NoteCounterService],
exports: [NotesService, NoteAccessService, NoteCounterService],
```

并增加 imports：

```ts
import { NoteAccessService } from './note-access.service'
import { NoteCounterService } from './note-counter.service'
```

- [ ] **步骤 6：在 NotesService 中注入新服务**

在 `notes.service.ts` 中导入：

```ts
import { NoteAccessService } from './note-access.service'
import { NoteCounterService } from './note-counter.service'
```

向 constructor 增加参数：

```ts
private readonly noteAccess: NoteAccessService,
private readonly noteCounter: NoteCounterService,
```

- [ ] **步骤 7：替换 create 中的计数副作用**

在 `create` 中，将分类/标签计数循环替换为：

```ts
await this.noteCounter.incrementForCreate({
  categoryId: createNoteDto.categoryId,
  categoryIds: createNoteDto.categoryIds,
  tags: createNoteDto.tags,
})
```

- [ ] **步骤 8：替换 findOne 的访问范围查询**

在 `findOne` 中，将手写查询替换为：

```ts
const note = await this.noteModel
  .findOne(this.noteAccess.readScope(id, userId))
  .populate('categoryId', 'name')
  .populate('tags', 'name')
  .exec()
```

- [ ] **步骤 9：替换 update 的访问范围和计数更新逻辑**

在 `update` 中，将原始查询替换为：

```ts
const originalNote = await this.noteModel.findOne(this.noteAccess.writeScope(id, userId)).exec()
```

更新成功后，将分类/标签计数逻辑替换为：

```ts
if (updateNoteDto.categoryId && updateNoteDto.categoryId !== originalNote.categoryId?.toString()) {
  await this.noteCounter.updateCategories(
    originalNote.categoryId ? [originalNote.categoryId.toString()] : [],
    [updateNoteDto.categoryId],
  )
}

if (Array.isArray(updateNoteDto.categoryIds)) {
  await this.noteCounter.updateCategories(
    (originalNote.categoryIds || []).map(id => id.toString()),
    updateNoteDto.categoryIds,
  )
}

if (Array.isArray(updateNoteDto.tags)) {
  await this.noteCounter.updateTags(
    (originalNote.tags || []).map(id => id.toString()),
    updateNoteDto.tags,
  )
}
```

- [ ] **步骤 10：替换 remove 的权限和删除行为**

在 `remove` 中，将原始 note 查询替换为：

```ts
const note = await this.noteModel.findOne(this.noteAccess.ownerScope(id, userId)).exec()
```

将 `deleteOne` 查询替换为：

```ts
const result = await this.noteModel.deleteOne({ _id: this.noteAccess.objectId(id, 'note id') }).exec()
```

将 decrement 循环替换为：

```ts
await this.noteCounter.decrementForDelete({
  categoryId: note.categoryId?.toString(),
  categoryIds: (note.categoryIds || []).map(cid => cid.toString()),
  tags: (note.tags || []).map(tagId => tagId.toString()),
})
```

- [ ] **步骤 11：运行后端测试和构建**

运行：

```bash
cd notes-backend
npm run test:unit
npm run build
```

预期：单元测试通过，构建退出码为 `0`。

- [ ] **步骤 12：提交 NotesService 拆分**

```bash
git add notes-backend/src/modules/notes notes-backend/test/note-access-counter.test.ts
git commit -m "refactor: split note access and counters"
```

## 任务 6：最终验证

**文件：**
- 只读验证整个项目。

- [ ] **步骤 1：运行前端验证**

```bash
cd notes-frontend
npm run type-check
npm run lint
npm test -- __tests__/editor.tiptap.spec.tsx __tests__/search.console.spec.tsx --runInBand
```

预期：所有命令退出码为 `0`。如果聚焦 Jest 运行因为 coverage threshold 失败，则运行 `npm run ci:test`，并记录准确的 coverage 结果。

- [ ] **步骤 2：运行后端验证**

```bash
cd notes-backend
npm run test:unit
npm run build
```

预期：所有命令退出码为 `0`。

- [ ] **步骤 3：运行契约检查**

```bash
npm run check:api-contract
```

预期：输出 `API contract drift register OK: 12 rows`。

- [ ] **步骤 4：确认 Git 状态**

```bash
git status --short --branch
```

预期：分支包含本次实施提交，且没有未暂存的源码变更。

- [ ] **步骤 5：如果验证过程更新了文档，则提交最终验证记录**

如果验证过程中需要更新文档，提交该文档变更：

```bash
git add docs/api-contract-drift.md docs/superpowers/plans/2026-05-19-stability-refactor-implementation.md
git commit -m "docs: record stability refactor verification"
```

## 自检清单

- Spec 覆盖：
  - WebSocket 鉴权：任务 2。
  - Board/Mindmap 权限：任务 3。
  - API 契约漂移：任务 4。
  - NotesService 拆分：任务 5。
  - 验证：任务 6。
- 项目内 skills 纳入：
  - Hook extraction 和 component splitting 约束任务 2。
  - React state 分类用于避免新增不必要的全局状态。
  - Vercel rules 约束 primitive effect dependencies、stable event handlers、storage safety、async parallelism 和 Set/Map deltas。
- 类型一致性：
  - `NoteAccessService.objectId/readScope/writeScope/ownerScope` 先定义再使用。
  - `NoteCounterService.diffIds/incrementForCreate/updateCategories/updateTags/decrementForDelete` 先定义再使用。
  - Board/Mindmap 的 `update(id, userId, input)` 签名在 plan 中保持一致。
