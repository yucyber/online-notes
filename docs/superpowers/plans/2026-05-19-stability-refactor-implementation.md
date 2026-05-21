# 稳定性与重构实施计划

> **给 agentic workers：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项实施本计划。步骤使用 checkbox（`- [ ]`）语法，便于执行过程中跟踪状态。

**目标：** 实现 `docs/superpowers/specs/2026-05-19-stability-refactor-design.md` 中已批准的第一阶段稳定性与可维护性修复。

**架构：** 按风险优先顺序推进：先修复 WebSocket 协作鉴权一致性并覆盖 token 失效路径，再收紧 Board/Mindmap 资源归属边界且保留共享笔记嵌入资源的只读访问，随后建立可自动 diff 的 API 契约漂移清单，最后拆分 `NotesService`。实施过程中保持公开 Controller 路径、统一响应 envelope、前端 API 函数名稳定。

**技术栈：** Next.js App Router、React 18、Jest/ts-jest、NestJS 10、Mongoose、Redis、Yjs/y-websocket、Node 内置 test runner 与 `ts-node/register`。

---

## 文件地图

- 修改：`notes-frontend/src/components/editor/TiptapEditor.tsx`
  - 增加携带 token 的 `WebsocketProvider` 创建逻辑，监听 token 变更/过期，并稳定表达鉴权/降级状态。
- 修改：`notes-frontend/src/lib/auth.ts`
  - 在同标签页登录/退出时派发 auth changed 事件，驱动协作 provider 重建。
- 修改：`notes-frontend/__tests__/editor.tiptap.spec.tsx`
  - 增加 provider 参数、缺 token、缺 URL、token 中途过期、可读状态文案和组件清理相关测试。
- 修改：`notes-backend/package.json`
  - 使用 Node test runner 和现有 `ts-node` 增加最小 `test:unit` 脚本。
- 新建：`notes-backend/test/boards-mindmaps-access.test.ts`
  - 覆盖 Board/Mindmap service 的 owner 正常访问、跨用户拒绝、非法 ID、同 ID 创建冲突行为。
- 修改：`notes-backend/src/modules/boards/boards.controller.ts`
- 修改：`notes-backend/src/modules/boards/boards.module.ts`
- 修改：`notes-backend/src/modules/boards/boards.service.ts`
- 修改：`notes-backend/src/modules/mindmaps/mindmaps.controller.ts`
- 修改：`notes-backend/src/modules/mindmaps/mindmaps.module.ts`
- 修改：`notes-backend/src/modules/mindmaps/mindmaps.service.ts`
  - 将用户 ID 传入 get/update；get 允许 owner 或来源 note 可读，update/create 冲突仍按 owner-only/409 处理。
- 修改：`notes-frontend/src/app/dashboard/boards/[id]/page.tsx`
- 修改：`notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx`
  - 401/403 不自动创建资源；只有确认 404 时才自动创建。
- 新建：`docs/api-contract-drift.md`
  - 面向人工审查的 API 契约漂移登记表。
- 新建：`scripts/check-api-contract.mjs`
  - 从 `api.ts` 与 `openapi.yaml` 自动抽取路径并 diff，确保每条漂移都有登记决策。
- 修改：`package.json`
  - 只增加 `check:api-contract`，不在根目录新增 `yjs/y-websocket/ws/ts-node` 依赖。
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
- 修改：`notes-frontend/src/lib/auth.ts`
- 修改：`notes-frontend/__tests__/editor.tiptap.spec.tsx`

**执行修订：**
- `connection-error` 是 401 upgrade 拒绝的主信号；`connection-close` 的 `1008/4401` 只作为兼容兜底，不作为唯一判断。
- 新增状态必须通过中文 label 和颜色映射展示，不能直接把 `config-missing/auth-missing/auth-expired/auth-failed` 枚举渲染到 UI。
- token 不只在 effect 启动时检查一次：必须把当前 token 纳入依赖，并基于 `exp` 设置过期定时器，过期时主动 `destroy()` provider 并切到 `auth-expired`。
- 同标签页登录、退出、换号必须触发协作重连；用 `notes:auth-changed` 自定义事件配合 `storage/focus` 事件刷新 token。

- [ ] **步骤 1：先写 provider token 行为的失败测试**

将以下测试追加到 `notes-frontend/__tests__/editor.tiptap.spec.tsx`：

如果文件仍从 `vitest` 导入 `describe/it/expect/vi`，先移除该导入并改用 Jest 全局对象；同时把 Testing Library import 调整为包含 `act`：

```tsx
import { act, render, screen, fireEvent } from '@testing-library/react'
```

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
    jest.useFakeTimers()
    localStorage.clear()
    process.env.NEXT_PUBLIC_YWS_URL = 'ws://localhost:1234'
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  function jwtWithExp(expMs: number) {
    const payload = btoa(JSON.stringify({ sub: 'u1', exp: Math.floor(expMs / 1000) }))
    return `header.${payload}.signature`
  }

  test('passes access_token to WebsocketProvider when token exists', async () => {
    const token = jwtWithExp(Date.now() + 60_000)
    localStorage.setItem('notes_token', token)
    const { default: TiptapEditor } = await import('@/components/editor/TiptapEditor')
    const { WebsocketProvider } = await import('y-websocket')

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => {}} user={user} />)

    expect((WebsocketProvider as any).instances[0].options.params.access_token).toBe(token)
  })

  test('does not create provider when token is missing', async () => {
    const { default: TiptapEditor } = await import('@/components/editor/TiptapEditor')
    const { WebsocketProvider } = await import('y-websocket')

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => {}} user={user} />)

    expect((WebsocketProvider as any).instances).toHaveLength(0)
    expect(screen.getByText('协作需要登录')).toBeInTheDocument()
  })

  test('renders readable status when websocket url is missing', async () => {
    localStorage.setItem('notes_token', jwtWithExp(Date.now() + 60_000))
    delete process.env.NEXT_PUBLIC_YWS_URL
    const { default: TiptapEditor } = await import('@/components/editor/TiptapEditor')

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => {}} user={user} />)

    expect(screen.getByText('协作配置缺失')).toBeInTheDocument()
  })

  test('destroys provider and degrades when token expires during an active session', async () => {
    localStorage.setItem('notes_token', jwtWithExp(Date.now() + 1_000))
    const { default: TiptapEditor } = await import('@/components/editor/TiptapEditor')
    const { WebsocketProvider } = await import('y-websocket')

    render(<TiptapEditor noteId="n1" initialHTML="<p>x</p>" onSave={async () => {}} user={user} />)
    const instance = (WebsocketProvider as any).instances[0]

    act(() => {
      jest.advanceTimersByTime(1_100)
    })

    expect(instance.destroy).toHaveBeenCalled()
    expect(screen.getByText('登录已过期，协作已暂停')).toBeInTheDocument()
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

- [ ] **步骤 3：让 auth helper 派发同标签页 token 变更事件**

在 `notes-frontend/src/lib/auth.ts` 中增加事件常量和派发函数：

```ts
export const AUTH_CHANGED_EVENT = 'notes:auth-changed'

const emitAuthChanged = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT))
  }
}
```

在 `setToken` 和 `removeToken` 末尾调用：

```ts
emitAuthChanged()
```

- [ ] **步骤 4：引入 token helper**

在 `notes-frontend/src/components/editor/TiptapEditor.tsx` 中增加：

```tsx
import { AUTH_CHANGED_EVENT, getToken, getTokenExpiration } from '@/lib/auth'
```

- [ ] **步骤 5：扩展连接状态类型和 UI 元信息**

将：

```tsx
const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
```

替换为：

```tsx
type CollabStatus = 'config-missing' | 'auth-missing' | 'auth-expired' | 'auth-failed' | 'connecting' | 'connected' | 'disconnected'
const [connStatus, setConnStatus] = useState<CollabStatus>('connecting')

const COLLAB_STATUS_META: Record<CollabStatus, { label: string; className: string; detail?: string }> = {
  'config-missing': { label: '协作配置缺失', className: 'text-red-600', detail: '已本地降级' },
  'auth-missing': { label: '协作需要登录', className: 'text-red-600', detail: '已本地降级' },
  'auth-expired': { label: '登录已过期，协作已暂停', className: 'text-red-600', detail: '请重新登录后重连' },
  'auth-failed': { label: '协作鉴权失败', className: 'text-red-600', detail: '请重新登录后重连' },
  connecting: { label: '连接中', className: 'text-yellow-600' },
  connected: { label: '已连接', className: 'text-green-600' },
  disconnected: { label: '已断开', className: 'text-red-600' },
}
```

- [ ] **步骤 6：把当前 token 纳入 effect 依赖**

在 `TiptapEditor` 中增加 token state 和刷新监听：

```tsx
const [authToken, setAuthToken] = useState<string | null>(() => getToken())

useEffect(() => {
  const refreshToken = () => setAuthToken(getToken())
  window.addEventListener(AUTH_CHANGED_EVENT, refreshToken)
  window.addEventListener('storage', refreshToken)
  window.addEventListener('focus', refreshToken)
  return () => {
    window.removeEventListener(AUTH_CHANGED_EVENT, refreshToken)
    window.removeEventListener('storage', refreshToken)
    window.removeEventListener('focus', refreshToken)
  }
}, [])
```

将 WebSocket provider effect 的依赖从：

```tsx
}, [noteId, versionKey, ydoc])
```

改为：

```tsx
}, [noteId, versionKey, ydoc, authToken])
```

- [ ] **步骤 7：在创建 provider 前增加 token 检查和过期定时器**

在 WebSocket 相关 `useEffect` 内、`let p: WebsocketProvider | null = null` 之前插入：

```tsx
const token = authToken
const expiresAt = token ? getTokenExpiration(token) : null

if (!token) {
  setLocalMode(true)
  setCollabEnabled(false)
  setProvider(null)
  setConnStatus('auth-missing')
  return
}

if (!expiresAt || expiresAt <= Date.now()) {
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

在 provider 创建成功后增加过期定时器：

```tsx
let tokenExpiryTimer: ReturnType<typeof setTimeout> | null = null

if (expiresAt) {
  tokenExpiryTimer = setTimeout(() => {
    try { p?.destroy() } catch { }
    setProvider(null)
    setLocalMode(true)
    setCollabEnabled(false)
    setConnStatus('auth-expired')
  }, Math.max(0, Math.min(expiresAt - Date.now(), 2_147_483_647)))
}
```

并在 cleanup 中增加：

```tsx
if (tokenExpiryTimer) clearTimeout(tokenExpiryTimer)
```

- [ ] **步骤 8：向 WebsocketProvider 传入 token 参数**

将 provider 创建逻辑替换为：

```tsx
p = new WebsocketProvider(yws, room, ydoc, {
  connect: true,
  maxBackoffTime: 10000,
  disableBc: true,
  params: { access_token: token },
})
```

- [ ] **步骤 9：在 WebSocket close/error 时标记鉴权失败**

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
const message = String(e?.message || e || '')
if (message.includes('401') || message.toLowerCase().includes('unauthorized')) {
  setConnStatus('auth-failed')
  setLocalMode(true)
  setCollabEnabled(false)
}
```

- [ ] **步骤 10：使用状态元信息渲染连接状态**

在 JSX return 前增加：

```tsx
const connMeta = COLLAB_STATUS_META[connStatus]
```

将连接状态 JSX 替换为：

```tsx
连接状态：<span className={connMeta.className}>{connMeta.label}</span>
{connMeta.detail && <span className="ml-2 text-xs text-gray-500">{connMeta.detail}</span>}
```

保留 `ws[...] sync[...]` debug 行，但不要再直接渲染枚举值。

- [ ] **步骤 11：运行前端聚焦测试**

运行：

```bash
cd notes-frontend
npm test -- __tests__/editor.tiptap.spec.tsx --runInBand
```

预期：`editor.tiptap.spec.tsx` 内所有测试通过。

- [ ] **步骤 12：提交协作鉴权修复**

```bash
git add notes-frontend/src/lib/auth.ts notes-frontend/src/components/editor/TiptapEditor.tsx notes-frontend/__tests__/editor.tiptap.spec.tsx
git commit -m "fix: pass auth token to collaboration websocket"
```

## 任务 3：收紧 Board/Mindmap 资源归属权限

**文件：**
- 新建：`notes-backend/test/boards-mindmaps-access.test.ts`
- 修改：`notes-backend/src/modules/boards/boards.controller.ts`
- 修改：`notes-backend/src/modules/boards/boards.module.ts`
- 修改：`notes-backend/src/modules/boards/boards.service.ts`
- 修改：`notes-backend/src/modules/mindmaps/mindmaps.controller.ts`
- 修改：`notes-backend/src/modules/mindmaps/mindmaps.module.ts`
- 修改：`notes-backend/src/modules/mindmaps/mindmaps.service.ts`
- 修改：`notes-frontend/src/app/dashboard/boards/[id]/page.tsx`
- 修改：`notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx`

**执行修订：**
- `GET /v1/boards/:id` 和 `GET /v1/mindmaps/:id` 不是纯 owner-only：资源 owner 可读；如果资源有 `noteId`，来源 note 的 owner、ACL 协作者或 public 读者也可读，避免共享笔记里的嵌入资源回归成 404。
- `PUT /v1/boards/:id` 和 `PUT /v1/mindmaps/:id` 仍 owner-only，不允许 note 协作者直接修改附属资源。
- `POST` 带 `_id` 自动创建时，如果 `_id` 已存在，后端捕获 Mongo duplicate key 并返回 `409 Conflict`；前端把该场景显示为“资源已存在或无权限”，不要显示“创建失败”。

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
            (query.userId === undefined || String(row.userId) === String(query.userId))
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

function createNoteModel(seed: any[] = []) {
  const rows = [...seed]
  return {
    findOne(query: any) {
      return {
        select: () => ({
          lean: () => ({
            exec: async () => rows.find(row =>
              String(row._id) === String(query._id) &&
              (
                String(row.userId) === String(query.$or?.[0]?.userId) ||
                row.acl?.some((entry: any) => String(entry.userId) === String(query.$or?.[1]?.acl?.$elemMatch?.userId)) ||
                row.visibility === query.$or?.[2]?.visibility
              )
            ) || null,
          }),
        }),
      }
    },
  }
}

test('boards service denies cross-user read', async () => {
  const ownerId = new Types.ObjectId()
  const otherId = new Types.ObjectId()
  const boardId = new Types.ObjectId()
  const service = new BoardsService(
    createModel([{ _id: boardId, userId: ownerId, title: 'A', content: {} }]) as any,
    createNoteModel() as any,
  )

  await assert.rejects(() => service.getById(String(boardId), String(otherId)), /Board not found/)
})

test('boards service allows read through source note acl', async () => {
  const ownerId = new Types.ObjectId()
  const collaboratorId = new Types.ObjectId()
  const boardId = new Types.ObjectId()
  const noteId = new Types.ObjectId()
  const service = new BoardsService(
    createModel([{ _id: boardId, userId: ownerId, noteId, title: 'A', content: {} }]) as any,
    createNoteModel([{ _id: noteId, userId: ownerId, acl: [{ userId: collaboratorId, role: 'viewer' }], visibility: 'private' }]) as any,
  )

  const board = await service.getById(String(boardId), String(collaboratorId))

  assert.equal(board.id, String(boardId))
})

test('mindmaps service denies cross-user update', async () => {
  const ownerId = new Types.ObjectId()
  const otherId = new Types.ObjectId()
  const mapId = new Types.ObjectId()
  const service = new MindmapsService(
    createModel([{ _id: mapId, userId: ownerId, title: 'M', content: {} }]) as any,
    createNoteModel() as any,
  )

  await assert.rejects(() => service.update(String(mapId), String(otherId), { title: 'Changed' }), /Mindmap not found/)
})

test('boards service returns conflict on duplicate client supplied id', async () => {
  const ownerId = new Types.ObjectId()
  const boardId = new Types.ObjectId()
  const model = createModel()
  model.create = async () => {
    const error: any = new Error('duplicate key')
    error.code = 11000
    throw error
  }
  const service = new BoardsService(model as any, createNoteModel() as any)

  await assert.rejects(
    () => service.create({ _id: String(boardId), userId: String(ownerId), title: 'A' }),
    /Board already exists/,
  )
})
```

- [ ] **步骤 2：运行后端测试，确认失败**

运行：

```bash
cd notes-backend
npm run test:unit
```

预期：出现 TypeScript 或运行时失败，因为 `getById/update` 还没有接收 `userId` 参数，service constructor 也还没有注入来源 note model。

- [ ] **步骤 3：更新 Board module 注入来源 Note model**

在 `notes-backend/src/modules/boards/boards.module.ts` 中引入 note schema：

```ts
import { Note, NoteSchema } from '../notes/schemas/note.schema'
```

将 `MongooseModule.forFeature` 更新为：

```ts
MongooseModule.forFeature([
  { name: Board.name, schema: BoardSchema },
  { name: Note.name, schema: NoteSchema },
])
```

- [ ] **步骤 4：更新 Board service 签名、共享读范围和 ID 校验**

在 `notes-backend/src/modules/boards/boards.service.ts` 中，先更新 imports：

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Note } from '../notes/schemas/note.schema'
```

再将 constructor、`create`、`getById` 和 `update` 替换为：

```ts
constructor(
  @InjectModel(Board.name) private readonly model: Model<Board>,
  @InjectModel(Note.name) private readonly noteModel: Model<Note>,
) {}

private parseObjectId(id: string | Types.ObjectId, label: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new BadRequestException(`${label} is invalid`)
  }
  return new Types.ObjectId(id)
}

private serialize(doc: any) {
  return {
    id: String(doc.id || doc._id),
    title: String(doc.title || ''),
    content: doc.content,
  }
}

private async canReadSourceNote(noteId: Types.ObjectId | undefined, userObjectId: Types.ObjectId) {
  if (!noteId) return false
  const note = await this.noteModel.findOne({
    _id: noteId,
    $or: [
      { userId: userObjectId },
      { acl: { $elemMatch: { userId: userObjectId } } },
      { visibility: 'public' },
    ],
  }).select('_id').lean().exec()
  return Boolean(note)
}

async create(input: { title: string; noteId?: string; userId: string; content?: any; _id?: string }) {
  const data: any = {
    title: String(input.title || ''),
    noteId: input.noteId ? this.parseObjectId(input.noteId, 'Note id') : undefined,
    userId: this.parseObjectId(input.userId, 'User id'),
    content: input.content,
  }
  if (input._id) data._id = this.parseObjectId(input._id, 'Board id')

  try {
    const doc = await this.model.create(data)
    return this.serialize(doc)
  } catch (error: any) {
    if (error?.code === 11000) throw new ConflictException('Board already exists')
    throw error
  }
}

async getById(id: string, userId: string) {
  const boardId = this.parseObjectId(id, 'Board id')
  const userObjectId = this.parseObjectId(userId, 'User id')
  const doc = await this.model.findOne({ _id: boardId }).lean().exec()
  if (!doc) throw new NotFoundException('Board not found')
  if (String((doc as any).userId) === String(userObjectId)) return this.serialize(doc)
  if (await this.canReadSourceNote((doc as any).noteId, userObjectId)) return this.serialize(doc)
  throw new NotFoundException('Board not found')
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
  return this.serialize(doc)
}
```

- [ ] **步骤 5：更新 Mindmap module 与 service**

在 `notes-backend/src/modules/mindmaps/mindmaps.module.ts` 中同样注入 `Note/NoteSchema`。在 `mindmaps.service.ts` 中应用 Board service 的同样结构，并做以下精确替换：

- `Board` → `Mindmap`
- `Board id` → `Mindmap id`
- `Board not found` → `Mindmap not found`
- `Board already exists` → `Mindmap already exists`

- [ ] **步骤 6：从 controller 传入用户 ID**

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

- [ ] **步骤 7：避免前端在权限和冲突错误时误导用户**

在 `dashboard/boards/[id]/page.tsx` 和 `dashboard/mindmaps/[id]/page.tsx` 中，将 catch 分支替换为：

```tsx
const status = e.response?.status
if (status === 404) {
  try {
    const created = await createBoard({ _id: id, title: '未命名画板' })
    setBoard(created)
    setError('')
  } catch (createError: any) {
    if (createError.response?.status === 409) {
      setError('画板已存在或无权限访问')
    } else {
      setError('创建画板失败')
    }
  }
} else if (status === 401 || status === 403) {
  setError('无权限访问该画板')
} else {
  setError('加载画板失败')
}
```

Mindmap 页面使用 `createMindMap`、`setMap`，并使用文案 `未命名思维导图` / `思维导图已存在或无权限访问` / `无权限访问该思维导图` / `加载思维导图失败`。

- [ ] **步骤 8：运行后端测试、后端构建和前端类型检查**

运行：

```bash
cd notes-backend
npm run test:unit
npm run build
cd ../notes-frontend
npm run type-check
```

预期：后端测试通过，后端构建和前端类型检查退出码均为 `0`。

- [ ] **步骤 9：提交 Board/Mindmap 权限修复**

```bash
git add notes-backend/test/boards-mindmaps-access.test.ts notes-backend/src/modules/boards notes-backend/src/modules/mindmaps notes-frontend/src/app/dashboard/boards/[id]/page.tsx notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx
git commit -m "fix: enforce board and mindmap ownership"
```

## 任务 4：增加可自动 diff 的 API 契约漂移登记表

**文件：**
- 新建：`docs/api-contract-drift.md`
- 新建：`scripts/check-api-contract.mjs`
- 修改：`package.json`

**执行修订：**
- 这个任务不能只做静态 Markdown 格式校验；脚本必须从 `notes-frontend/src/lib/api.ts` 抽取实际调用路径、从 `notes-backend/openapi.yaml` 抽取契约路径，并校验两边 symmetric diff 全部出现在登记表里。
- 根目录 `package.json` 只增加 `scripts.check:api-contract`。不要把 `y-websocket`、`yjs`、`ws`、`@types/ws`、`ts-node` 放进根依赖；这些分别属于前端、后端或已在子包存在。
- 不要用固定 `rows.length < 10` 或“12 rows”断言；只校验登记表非空，并输出当前实际 drift 数。

- [ ] **步骤 1：创建契约漂移登记表**

创建 `docs/api-contract-drift.md`：

```markdown
# API 契约漂移登记表

| 路径 | 消费者 | 后端状态 | OpenAPI 状态 | 决策 | 验证方式 |
| --- | --- | --- | --- | --- | --- |
| `/api/audit/logs` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | 补齐或明确移除前端审计日志入口。 |
| `/api/auth/login` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖登录请求和 envelope 响应。 |
| `/api/auth/me` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖当前用户读取契约。 |
| `/api/auth/register` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖注册请求和错误码。 |
| `/api/categories` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖分类列表和创建契约。 |
| `/api/categories/:id` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖分类详情、更新和删除契约。 |
| `/api/comments/:id` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖评论删除契约。 |
| `/api/comments/:id/replies` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖评论回复创建契约。 |
| `/api/dashboard/overview` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖仪表盘概览契约。 |
| `/api/invitations/:id` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖邀请预览契约。 |
| `/api/invitations/:id/accept` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖邀请接受契约。 |
| `/api/invitations/mine` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖我的邀请列表契约。 |
| `/api/invitations/notes/:id` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖笔记邀请创建契约。 |
| `/api/notes/:id` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖笔记详情、更新和删除契约。 |
| `/api/notes/:id/acl` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖 ACL 读取和创建契约。 |
| `/api/notes/:id/acl/:id` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖 ACL 更新和删除契约。 |
| `/api/notes/:id/comments` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖笔记评论列表和创建契约。 |
| `/api/notes/:id/lock` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖笔记锁定与解锁契约。 |
| `/api/notes/:id/versions` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖版本列表契约。 |
| `/api/notes/:id/versions/:id/restore` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖版本恢复契约。 |
| `/api/notes/recommendations` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖推荐笔记契约。 |
| `/api/saved-filters` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖保存筛选器列表和创建契约。 |
| `/api/saved-filters/:id` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖保存筛选器删除契约。 |
| `/api/tags` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖标签列表和创建契约。 |
| `/api/tags/:id` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖标签更新和删除契约。 |
| `/api/tags/bulk` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖批量创建标签契约。 |
| `/api/tags/merge` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖标签合并契约。 |
| `/api/tags/sync` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖标签计数同步契约。 |
| `/api/v1/assets/:id` | `notes-frontend/src/lib/api.ts` `assetsAPI.getById` | 缺失 | 缺失 | `hide-client-entry` | 不把直接资产读取宣传为当前可用能力。 |
| `/api/v1/assets/base64` | `notes-frontend/src/lib/api.ts` `assetsAPI.uploadBase64` | 缺失 | 缺失 | `hide-client-entry` | 附件 UI 显示明确的“暂不可用”提示。 |
| `/api/v1/boards` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖画板创建契约和 409 冲突。 |
| `/api/v1/boards/:id` | Board 页面与资源嵌入 | 存在 | 缺失 | `implement-now` | 归属权限测试通过，并补充 OpenAPI 条目。 |
| `/api/v1/embeds` | `notes-frontend/src/lib/api.ts` `embedsAPI.create` | 缺失 | 缺失 | `hide-client-entry` | Embed 创建路径返回明确不可用提示，而不是静默失败。 |
| `/api/v1/mindmaps` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖思维导图创建契约和 409 冲突。 |
| `/api/v1/mindmaps/:id` | Mindmap 页面与资源嵌入 | 存在 | 缺失 | `implement-now` | 归属权限测试通过，并补充 OpenAPI 条目。 |
| `/api/v1/semantic/topics` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖主题列表契约。 |
| `/api/v1/semantic/topics/convert` | `notes-frontend/src/lib/api.ts` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖主题转标签契约。 |
| `/api/v1/drafts/auto-save` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/drafts/sync` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/network/diagnostics` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/network/status` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/semantic/search` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 对齐现有 semantic routes，或补前端调用。 |
| `/api/v1/vector/batch-upsert` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/vector/upsert` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
```

- [ ] **步骤 2：创建自动 diff 登记表校验脚本**

创建 `scripts/check-api-contract.mjs`：

```js
import { readFileSync } from 'node:fs'

const file = 'docs/api-contract-drift.md'
const text = readFileSync(file, 'utf8')
const rows = text.split('\n').filter(line => line.startsWith('| `/api/'))
const allowed = new Set(['implement-now', 'hide-client-entry', 'mark-planned-or-remove', 'document-openapi'])

function normalizePath(path) {
  const withoutQuery = path.split('?')[0].replace(/\$\{[^}]+\}/g, ':id')
  if (withoutQuery.startsWith('/v1/')) return `/api${withoutQuery}`
  if (withoutQuery.startsWith('/')) return `/api${withoutQuery}`
  return withoutQuery
}

function extractClientPaths() {
  const apiText = readFileSync('notes-frontend/src/lib/api.ts', 'utf8')
  const regex = /api\.(?:get|post|put|patch|delete)\s*(?:<[^>]+>)?\s*\(\s*([`'"])([^`'"]+)\1/g
  const paths = new Set()
  for (const match of apiText.matchAll(regex)) {
    paths.add(normalizePath(match[2]))
  }
  return paths
}

function extractOpenApiPaths() {
  const yaml = readFileSync('notes-backend/openapi.yaml', 'utf8')
  const regex = /^  (\/api[^:]+):\s*$/gm
  return new Set([...yaml.matchAll(regex)].map(match => match[1]))
}

let failures = 0
const registered = new Set()
for (const row of rows) {
  const cells = row.split('|').map(cell => cell.trim()).filter(Boolean)
  const path = cells[0]
  const decision = cells[4]?.replace(/`/g, '')
  const verification = cells[5]
  registered.add(path.replace(/`/g, ''))
  if (!allowed.has(decision)) {
    console.error(`Invalid decision for ${path}: ${decision}`)
    failures++
  }
  if (!verification || verification.length < 8) {
    console.error(`Missing verification for ${path}`)
    failures++
  }
}

const clientPaths = extractClientPaths()
const openApiPaths = extractOpenApiPaths()
const drift = [...new Set([...clientPaths, ...openApiPaths])]
  .filter(path => clientPaths.has(path) !== openApiPaths.has(path))
  .sort()

for (const path of drift) {
  if (!registered.has(path)) {
    console.error(`Unregistered API contract drift: ${path}`)
    failures++
  }
}

for (const path of registered) {
  if (!drift.includes(path)) {
    console.error(`Stale API contract drift registration: ${path}`)
    failures++
  }
}

if (registered.size === 0) {
  console.error('Expected at least one drift row')
  failures++
}

if (failures > 0) process.exit(1)
console.log(`API contract drift register OK: ${drift.length} drift rows`)
```

- [ ] **步骤 3：增加根目录脚本**

在根目录 `package.json` 中增加：

```json
{
  "scripts": {
    "check:api-contract": "node scripts/check-api-contract.mjs"
  }
}
```

- [ ] **步骤 4：运行契约检查**

运行：

```bash
npm run check:api-contract
```

预期：输出 `API contract drift register OK: 44 drift rows`。如果执行时 `api.ts` 或 `openapi.yaml` 已变化，以脚本实际 diff 数为准，不写死行数断言。

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

**执行修订：**
- 计数更新保持顺序 `for await` 风格，不用 `Promise.all`；当前分类/标签 service 是 Mongo `$inc`，并发理论安全，但顺序实现更贴近原行为，降低未来实现改成读-改-写后的丢更新风险。
- 单值 `categoryId` 和数组 `categoryIds` 都统一走 `NoteCounterService.updateCategories(prev, next)`，避免两套差量语义。
- `remove` 的实际 `deleteOne` 使用 `ownerScope(id, userId)`，和前置 owner 权限校验保持一致；不再退回到只按 `_id` 删除，也不保留旧的纯 `userId` 二次过滤。

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
  assert.equal(String(query.$or[0].userId), String(userId))
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
    for (const id of categoryIds) await this.categoriesService.incrementNoteCount(id)
    for (const id of input.tags || []) await this.tagsService.incrementNoteCount(id)
  }

  async updateCategories(prev: string[], next: string[]) {
    const delta = this.diffIds(prev, next)
    for (const id of delta.add) await this.categoriesService.incrementNoteCount(id)
    for (const id of delta.remove) await this.categoriesService.decrementNoteCount(id)
  }

  async updateTags(prev: string[], next: string[]) {
    const delta = this.diffIds(prev, next)
    for (const id of delta.add) await this.tagsService.incrementNoteCount(id)
    for (const id of delta.remove) await this.tagsService.decrementNoteCount(id)
  }

  async decrementForDelete(input: { categoryId?: string; categoryIds?: string[]; tags?: string[] }) {
    const categoryIds = new Set<string>()
    if (input.categoryId) categoryIds.add(input.categoryId)
    for (const id of input.categoryIds || []) categoryIds.add(id)
    for (const id of categoryIds) await this.categoriesService.decrementNoteCount(id)
    for (const id of input.tags || []) await this.tagsService.decrementNoteCount(id)
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
if (updateNoteDto.categoryId !== undefined) {
  await this.noteCounter.updateCategories(
    originalNote.categoryId ? [originalNote.categoryId.toString()] : [],
    updateNoteDto.categoryId ? [updateNoteDto.categoryId] : [],
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
const result = await this.noteModel.deleteOne(this.noteAccess.ownerScope(id, userId)).exec()
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

预期：输出 `API contract drift register OK: <N> drift rows`，且没有未登记或过期登记项。

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
  - WebSocket 鉴权、可读状态文案、401 upgrade error、token 中途过期和换号重连：任务 2。
  - Board/Mindmap 权限、共享笔记嵌入资源只读、重复 `_id` 创建 409 和前端冲突文案：任务 3。
  - API 契约漂移自动 diff 和根依赖边界：任务 4。
  - NotesService 拆分、顺序计数、单/多分类统一差量和 ownerScope 删除：任务 5。
  - 验证：任务 6。
- 项目内 skills 纳入：
  - Hook extraction 和 component splitting 约束任务 2。
  - React state 分类用于避免新增不必要的全局状态。
  - Vercel rules 约束 primitive effect dependencies、stable event handlers、storage safety、async parallelism 和 Set/Map deltas。
- 类型一致性：
  - `NoteAccessService.objectId/readScope/writeScope/ownerScope` 先定义再使用。
  - `NoteCounterService.diffIds/incrementForCreate/updateCategories/updateTags/decrementForDelete` 先定义再使用。
  - Board/Mindmap 的 `update(id, userId, input)` 签名在 plan 中保持一致。
  - Board/Mindmap 的 `getById(id, userId)` 保留 owner 与来源 note read scope 两类读路径。
