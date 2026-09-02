# 阶段二：全屏助手工作台、Chunk 阅读器与无损返回 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **执行顺序决策（2026-09-02 用户确认，计划 2 Task 8 合并）**：计划 2（`2026-09-01-assistant-server-multi-conversation.md`）的 Task 8「前端会话管理 UI（重命名/归档/删除/搜索）」原延后至计划 3 组件就绪后执行。pre-flight 发现其规格与本计划 Task 3/5/6 多处重叠（assistant-api.ts 同文件、ConversationList 同组件、AssistantWorkspace 同组件、重试按钮与 Task 6 的 onRetry 重叠）。**用户裁决：Task 8 规格拆分并入本计划各 Task，组件一次建成带完整功能**：管理 API 并入 Task 3（assistant-api.ts 一次含 fetch + 5 管理函数）、管理交互（每项操作菜单/搜索框）并入 Task 5（ConversationList 一次建成带管理）、搜索接线与重试并入 Task 6（AssistantWorkspace 一次集成）。Task 8 不再作为独立执行轮；本计划完成后计划 2 即整体完结（Task 8 勾选视为随合并完成）。

**Goal:** 新增 `/dashboard/assistant` 全屏助手工作台（三栏：会话列表 / 对话 / 上下文面板），把 RAG 引用改为在工作台右侧阅读完整 Chunk 与相邻上下文，点击"定位到原文"才进入笔记编辑器；进入笔记再返回时，通过 sessionStorage 导航快照恢复原会话、消息锚点、引用与生成状态。

**Architecture:** 后端在 `assistant` 模块补一个会话列表端点，在 `notes` 模块补一个"Chunk 证据 + 相邻上下文"端点（复用 NoteAccess ACL，支持按 headingPath 重定位失效 Chunk）。前端新增 `AssistantWorkspace` 页面与一组子组件，抽出与知识图谱共用的 `ChunkEvidenceViewer`；浮层 `ChatWindow` 只增加"展开"入口，消息层继续复用阶段一的 `streamAssistantReply`/`fetchConversationMessages`。导航快照存 sessionStorage，Dashboard layout 只维护轻量 UI 状态。

**Tech Stack:** Next.js 16 App Router + React 18 + CSS（沿用现有 product tokens）+ NestJS 10 + Mongoose 8 + Jest/jsdom + node:test。

## Global Constraints

- 不修改现有浮层尺寸与页面挤压方式；浮层只增加"展开全屏工作台"入口。
- 引用阅读每次都必须通过后端重新校验 NoteAccess；citation 中的 excerpt 只是历史快照，失权后不得返回正文。
- Chunk 失效时允许按 headingPath 定位最新 Chunk，但必须标记"已重新定位"；无法定位时允许打开笔记顶部，但不得伪造命中位置。
- 知识图谱证据与助手引用阅读共用同一个 `ChunkEvidenceViewer`，不得形成两套证据体验。
- 小于 1180px 时右侧上下文面板变为覆盖式抽屉；移动端单栏，通过"会话 / 对话 / 上下文"切换。
- 页面沿用现有 product token 与克制的纸张式视觉，不引入独立颜色系统。
- 前端 `/api/assistant/*` 的 Next 代理路由已由阶段一 Task 8 建立（GET/POST/PATCH/DELETE、SSE/JSONL 透传），本阶段新增端点无需再建前端路由。
- 前端测试：`npm exec jest -- --runInBand --coverage=false __tests__/<file>`；类型检查 `npm run type-check`；后端 `npm run test:unit` / `npm run build`。
- 提交信息用中文 `类型(范围): 简述`；不触碰 `codex配置ar.md`。

## File Structure

后端：

- Modify `notes-backend/src/modules/assistant/assistant-conversations.service.ts`：新增 `list(userId)` 与 `countMessages`（供列表显示）。
- Modify `notes-backend/src/modules/assistant/assistant.controller.ts`：新增 `GET /assistant/conversations`。
- Modify `notes-backend/src/modules/notes/notes.service.ts`：新增 `getChunkEvidence(noteId, chunkId, userId, opts)`。
- Modify `notes-backend/src/modules/notes/notes.controller.ts`：新增 `GET :noteId/chunks/:chunkId/evidence`。
- Test: `notes-backend/test/assistant-conversations-list.test.ts`、`notes-backend/test/note-chunk-evidence-context.test.ts`。

前端：

- Create `notes-frontend/src/app/dashboard/assistant/page.tsx`（客户端页面壳，解析 `?conversation=` 与导航快照）。
- Create `notes-frontend/src/components/assistant/AssistantWorkspace.tsx`（三栏布局 + 抽屉/移动端切换；含搜索框、重试、管理接线——合并计划 2 Task 8）。
- Create `notes-frontend/src/components/assistant/ConversationList.tsx`（含管理操作菜单——合并计划 2 Task 8）。
- Create `notes-frontend/src/components/assistant/AssistantMessages.tsx`（消息流 + 流式订阅，从 ChatWindow 抽出）。
- Create `notes-frontend/src/components/assistant/AssistantCompose.tsx`（共享输入区，浮层与全屏复用）。
- Create `notes-frontend/src/components/assistant/AssistantContextPanel.tsx`（右栏：引用 Chunk / 会话信息）。
- Create `notes-frontend/src/components/assistant/ChunkEvidenceViewer.tsx`（公共证据组件）。
- Create `notes-frontend/src/components/assistant/assistant-navigation.ts`（sessionStorage 快照）。
- Create `notes-frontend/src/lib/assistant-api.ts`（会话列表、Chunk 证据请求 + 管理 API——合并计划 2 Task 8）。
- Create `notes-frontend/src/styles/assistant-workspace.css`。
- Modify `notes-frontend/src/components/ai/ChatWindow.tsx`（"展开"入口跳转 `/dashboard/assistant?conversation=<id>`）。
- Modify `notes-frontend/src/components/knowledge-bases/KnowledgeGraphEvidenceList.tsx`（改用公共 `ChunkEvidenceViewer`）。
- Test: `notes-frontend/__tests__/assistant-navigation.spec.ts`、`assistant-api.spec.ts`（管理 API，合并自计划 2 Task 8）、`chunk-evidence-viewer.spec.tsx`、`conversation-list.spec.tsx`、`assistant-workspace.spec.tsx`。

---

### Task 1: 会话列表端点（后端）

**Files:**
- Modify: `notes-backend/src/modules/assistant/assistant-conversations.service.ts`
- Modify: `notes-backend/src/modules/assistant/assistant.controller.ts`
- Test: `notes-backend/test/assistant-conversations-list.test.ts`

**Interfaces:**
- Consumes: `AssistantConversation` 模型。
- Produces: `AssistantConversationsService.list(userId): Promise<Array<{ id: string; title: string; status: 'active'|'archived'|'deleted'; lastMessageAt?: string; messageCount: number; updatedAt: string }>>`（只返回 `status !== 'deleted'`，按 `updatedAt` 降序）；`GET /api/assistant/conversations` → `{ items: [...] }`。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-conversations-list.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantConversationsService } from '../src/modules/assistant/assistant-conversations.service'

class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  async find(filter: any) {
    // mock 需与实现链同形：find → sort → lean → exec
    const result = this.docs
      .filter((d) => Object.entries(filter).every(([k, v]) => {
        if (k === 'status' && typeof v === 'object' && v !== null && '$ne' in v) return d.status !== v.$ne
        return String(d[k]) === String(v)
      }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    return { sort: () => ({ lean: () => ({ exec: async () => result }) }) }
  }
}

test('list 只返回当前用户未删除会话并按 updatedAt 降序', async () => {
  const model = new MemoryModel([
    { _id: 'c1', userId: 'u1', title: 'A', status: 'active', updatedAt: '2026-09-01T10:00:00.000Z', messageCount: 2 },
    { _id: 'c2', userId: 'u1', title: 'B', status: 'deleted', updatedAt: '2026-09-01T11:00:00.000Z', messageCount: 1 },
    { _id: 'c3', userId: 'u2', title: 'C', status: 'active', updatedAt: '2026-09-01T12:00:00.000Z', messageCount: 0 },
  ])
  const service = new AssistantConversationsService(model as any)
  const items = await service.list('u1')
  assert.deepEqual(items.map((i) => i.id), ['c1'])
  assert.equal(items[0].title, 'A')
})

test('list 返回空数组当用户无会话', async () => {
  const model = new MemoryModel([])
  const service = new AssistantConversationsService(model as any)
  const items = await service.list('u1')
  assert.deepEqual(items, [])
})

// controller 端点：GET /api/assistant/conversations → { items }
test('GET conversations 端点返回 items 且未认证抛 400', async () => {
  const { AssistantController } = await import('../src/modules/assistant/assistant.controller')
  const { BadRequestException } = await import('@nestjs/common')
  const list = async (userId: string) => (userId === 'u1' ? [{ id: 'c1', title: 'A', status: 'active', messageCount: 2, updatedAt: 'x' }] : [])
  const controller = new AssistantController({} as any, {} as any, { list } as any, {} as any)
  const result = await controller.listConversations({ user: { id: 'u1' } } as any)
  assert.deepEqual(result.items.map((i: any) => i.id), ['c1'])
  await assert.rejects(
    () => controller.listConversations({} as any),
    (err: any) => err instanceof BadRequestException,
  )
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-conversations-list.test.ts`
Expected: FAIL（`list` 不存在）

- [ ] **Step 3: 最小实现**

`assistant-conversations.service.ts` 增加：

```ts
async list(userId: string) {
  const docs = await this.model.find({ userId: new Types.ObjectId(userId), status: { $ne: 'deleted' } })
    .sort({ updatedAt: -1 }).lean().exec()
  return docs.map((doc: any) => ({
    id: String(doc._id), title: String(doc.title || '新对话'), status: doc.status,
    lastMessageAt: doc.lastMessageAt ? String(doc.lastMessageAt) : undefined,
    messageCount: Number(doc.messageCount || 0), updatedAt: String(doc.updatedAt || doc.createdAt || new Date().toISOString()),
  }))
}
```

`assistant.controller.ts` 增加：

```ts
@Get('conversations')
async listConversations(@Req() req?: AuthenticatedRequest) {
  const userId = this.userId(req)
  if (!userId) throw new BadRequestException('Authenticated user is required.')
  return { items: await this.conversations.list(userId) }
}
```

（controller 构造器已注入 `AssistantConversationsService`（计划 2 4 参：generation/messages/conversations/checkpoints）——无需改构造；`GET conversations` 与既有 `GET conversations/:id/messages` 无冲突，Nest 按声明顺序匹配，`conversations` 声明在前即可。`list` 用 `status: { $ne: 'deleted' }` 排除软删除；`messageCount`/`lastMessageAt`/`updatedAt` 均为 schema 既有字段。controller 端点测试沿用 4 参构造（conversations 假实现补 `list`）。）

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-conversations-list.test.ts test/assistant-controller.test.ts; npm run build`
Expected: PASS；编译通过

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant-conversations.service.ts notes-backend/src/modules/assistant/assistant.controller.ts notes-backend/test/assistant-conversations-list.test.ts
git commit -m "feat(assistant): 会话列表端点"
```

---

### Task 2: Chunk 证据 + 相邻上下文端点（后端）

**Files:**
- Modify: `notes-backend/src/modules/notes/notes.service.ts`
- Modify: `notes-backend/src/modules/notes/notes.controller.ts`
- Test: `notes-backend/test/note-chunk-evidence-context.test.ts`

**Interfaces:**
- Consumes: `NoteAccessService.readScope`、`noteModel`、`noteChunkModel`（既有依赖）。
- Produces: `NotesService.getChunkEvidence(noteId, chunkId, userId, opts?: { before?: number; after?: number }): Promise<{ noteId: string; noteTitle: string; chunkId: string; headingPath: string[]; content: string; noteUpdatedAt: string; relocated: boolean; neighbors: { before: Array<{ chunkId: string; headingPath: string[]; excerpt: string }>; after: Array<{ chunkId: string; headingPath: string[]; excerpt: string }> } }>`。规则：先按 `_id + noteId` 查 Chunk；未命中时按 `noteId + headingPath` 找最新 Chunk 并置 `relocated: true`；仍无则抛 NotFoundException。neighbors 按 `chunkIndex` 取前后各 `before/after`（默认 1）条，只返回 `_id/headingPath/content` 的 excerpt。端点：`GET /api/notes/:noteId/chunks/:chunkId/evidence?before=1&after=1`，走 `AuthGuard('jwt')`。

- [ ] **Step 1: 写失败测试（构造 service 实例 + 内存模型）**

```ts
// notes-backend/test/note-chunk-evidence-context.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NotesService } from '../src/modules/notes/notes.service'

function fakeDeps(chunks: any[], notes: any[]) {
  const noteAccess = {
    readScope: (noteId: string) => ({ _id: noteId }),
    objectId: (v: string) => v,
    readableFilter: () => ({}),
  }
  // findOne 支持任意 filter 字段（含数组 headingPath）；find 支持 select/sort/lean 链。
  const matches = (doc: any, filter: any) => Object.entries(filter).every(([k, v]) => {
    if (Array.isArray(v)) return Array.isArray(doc[k]) && v.length === doc[k].length && v.every((x, i) => String(x) === String(doc[k][i]))
    return String(doc[k]) === String(v)
  })
  // 链形 mock：sort/select/lean 返回自身链对象、exec 解出值（同既有 note-chunk-location-access.test.ts 的 queryResult 惯例）。
  // findOne/find 必须非 async（async 返回 Promise 会断链），直接返回链对象。
  const queryResult = (value: any) => ({ sort: () => queryResult(value), select: () => queryResult(value), lean: () => queryResult(value), exec: async () => value })
  const chunkModel = {
    findOne: (filter: any) => queryResult(chunks.find((c) => matches(c, filter)) ?? null),
    find: (filter: any) => ({
      select: () => ({
        sort: () => ({
          lean: () => ({
            exec: async () => [...chunks].filter((c) => matches(c, filter)).sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0)),
          }),
        }),
      }),
    }),
  }
  const noteModel = {
    findOne: (filter: any) => queryResult(notes.find((n) => matches(n, filter)) ?? null),
  }
  return { noteAccess, chunkModel, noteModel }
}

function newNotesService(deps: ReturnType<typeof fakeDeps>) {
  const { noteAccess, chunkModel, noteModel } = deps
  // 构造器签名：noteModel, categoriesService, tagsService, embeddingService, aiService, noteAccess,
  // noteCounter, noteCache, audit, users, noteRecommendations?, noteDerived?, jwtService?, mindmapModel?, noteChunkModel?
  return new NotesService(
    noteModel as any, {} as any, {} as any, {} as any, {} as any,
    noteAccess as any, {} as any, {} as any, {} as any, {} as any,
    undefined, undefined, undefined, undefined, chunkModel as any,
  )
}

test('命中 Chunk 时返回正文、邻居与 relocated=false', async () => {
  const chunks = [
    { _id: 'c1', noteId: 'n1', chunkIndex: 0, headingPath: ['A'], content: '第一段' },
    { _id: 'c2', noteId: 'n1', chunkIndex: 1, headingPath: ['A'], content: '第二段' },
    { _id: 'c3', noteId: 'n1', chunkIndex: 2, headingPath: ['B'], content: '第三段' },
  ]
  const notes = [{ _id: 'n1', title: '笔记', updatedAt: '2026-09-01T00:00:00.000Z' }]
  const service = newNotesService(fakeDeps(chunks, notes))
  const result = await service.getChunkEvidence('n1', 'c2', 'u1', { before: 1, after: 1 })
  assert.equal(result.chunkId, 'c2')
  assert.equal(result.relocated, false)
  assert.equal(result.content, '第二段')
  assert.deepEqual(result.neighbors.before.map((n: any) => n.chunkId), ['c1'])
  assert.deepEqual(result.neighbors.after.map((n: any) => n.chunkId), ['c3'])
})

test('Chunk 失效时按 headingPath 重定位并标记 relocated', async () => {
  const chunks = [
    { _id: 'c1', noteId: 'n1', chunkIndex: 0, headingPath: ['结论'], content: '最新结论' },
  ]
  const notes = [{ _id: 'n1', title: '笔记', updatedAt: '2026-09-01T00:00:00.000Z' }]
  const service = newNotesService(fakeDeps(chunks, notes))
  // 真实失效场景：citation 里的 chunkId 是合法 ObjectId 但文档已被重新索引删除（非非法字符串）——
  // 用合法 hex 形态的 '0000000000000000000000aa'（不在 seeds）模拟，避免触发 objectId 校验抛错掩盖重定位路径。
  const result = await service.getChunkEvidence('n1', '0000000000000000000000aa', 'u1', { headingPath: ['结论'] })
  assert.equal(result.relocated, true)
  assert.equal(result.chunkId, 'c1')
  assert.equal(result.content, '最新结论')
})
```

> 说明：`NotesService` 构造器参数较多，测试按实际构造器顺序传参；若构造器签名与上述占位不符，以 `src/modules/notes/notes.service.ts` 实际构造器为准补齐 `undefined` 占位。`getChunkEvidence` 的 `opts` 增加 `headingPath?: string[]` 以支持失效重定位。

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/note-chunk-evidence-context.test.ts`
Expected: FAIL（`getChunkEvidence` 不存在）

- [ ] **Step 3: 最小实现（notes.service.ts 增加方法）**

```ts
async getChunkEvidence(noteId: string, chunkId: string, userId: string, opts?: { before?: number; after?: number; headingPath?: string[] }) {
  const noteIdObj = this.noteAccess.objectId(noteId, 'note id')
  const readableNote = await this.noteModel.findOne(this.noteAccess.readScope(noteId, userId)).select('_id title updatedAt').lean().exec()
  if (!readableNote) throw new NotFoundException('笔记不存在')
  if (!this.noteChunkModel) throw new NotFoundException('证据不可用')

  let chunk = await this.noteChunkModel
    .findOne({ _id: this.noteAccess.objectId(chunkId, 'chunk id'), noteId: noteIdObj })
    .select('_id chunkIndex headingPath content')
    .lean()
    .exec()
  let relocated = false
  if (!chunk && opts?.headingPath?.length) {
    // Chunk 因重新索引失效：按 headingPath 定位同笔记下的最新 Chunk，并明确标记已重定位。
    chunk = await this.noteChunkModel
      .findOne({ noteId: noteIdObj, headingPath: opts.headingPath })
      .sort({ chunkIndex: -1, _id: -1 })
      .select('_id chunkIndex headingPath content')
      .lean()
      .exec()
    relocated = Boolean(chunk)
  }
  if (!chunk) throw new NotFoundException('证据位置不存在')

  // clamp 0-3：非法（NaN/Infinity）回落默认 1——直接 Number('abc')=NaN 经 Math.max/min 仍 NaN，
  // slice(NaN→0, index) 会返回目标前全部邻居绕过 clamp，故先 Number.isFinite 守卫。
  const finite = (v: unknown, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : fallback
  }
  const before = finite(opts?.before ?? 1, 1)
  const after = finite(opts?.after ?? 1, 1)
  const siblings = await this.noteChunkModel
    .find({ noteId: noteIdObj })
    .select('_id chunkIndex headingPath content')
    .sort({ chunkIndex: 1, _id: 1 })
    .lean()
    .exec() as any[]
  const index = siblings.findIndex((c: any) => String(c._id) === String(chunk._id))
  const pick = (list: any[]) => list.map((c: any) => ({
    chunkId: String(c._id),
    headingPath: Array.isArray(c.headingPath) ? c.headingPath.map(String) : [],
    excerpt: String(c.content || '').replace(/\s+/g, ' ').trim().slice(0, 200),
  }))
  return {
    noteId: String(readableNote._id),
    noteTitle: String(readableNote.title || '无标题笔记'),
    chunkId: String(chunk._id),
    headingPath: Array.isArray(chunk.headingPath) ? chunk.headingPath.map(String) : [],
    content: String(chunk.content || ''),
    noteUpdatedAt: String(readableNote.updatedAt || new Date().toISOString()),
    relocated,
    neighbors: {
      before: index > 0 ? pick(siblings.slice(Math.max(0, index - before), index)) : [],
      after: index >= 0 ? pick(siblings.slice(index + 1, index + 1 + after)) : [],
    },
  }
}
```

`notes.controller.ts` 增加（放在 `:noteId/chunks/:chunkId/location` 附近）：

```ts
@Get(':noteId/chunks/:chunkId/evidence')
async chunkEvidence(
  @Param('noteId') noteId: string,
  @Param('chunkId') chunkId: string,
  @Query('before') before?: string,
  @Query('after') after?: string,
  @Query('heading') heading?: string,
  @Req() req?: Request & { user?: { id?: string } },
) {
  return this.notesService.getChunkEvidence(noteId, chunkId, this.userId(req), {
    ...(before !== undefined ? { before: Number(before) } : {}),
    ...(after !== undefined ? { after: Number(after) } : {}),
    ...(heading ? { headingPath: heading.split('>').map((part) => part.trim()).filter(Boolean) } : {}),
  })
}
```

（`userId` 私有方法与既有 `getChunkLocation` 一致。）

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/note-chunk-evidence-context.test.ts test/note-chunk-location-access.test.ts; npm run build`
Expected: PASS；既有 location 测试不受影响

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/notes/notes.service.ts notes-backend/src/modules/notes/notes.controller.ts notes-backend/test/note-chunk-evidence-context.test.ts
git commit -m "feat(notes): Chunk 证据与相邻上下文端点"
```

---

### Task 3: 前端助手 API 与导航快照

**Files:**
- Create: `notes-frontend/src/lib/assistant-api.ts`
- Create: `notes-frontend/src/components/assistant/assistant-navigation.ts`
- Test: `notes-frontend/__tests__/assistant-navigation.spec.ts`、`notes-frontend/__tests__/assistant-api.spec.ts`（后者合并自计划 2 Task 8 管理 API 测试）

**Interfaces:**
- Produces（`assistant-api.ts`）：
  - `export type ConversationListItem = { id: string; title: string; status: 'active' | 'archived' | 'deleted'; lastMessageAt?: string; messageCount: number; updatedAt: string }`
  - `export async function fetchConversations(): Promise<ConversationListItem[]>`（GET `/api/assistant/conversations`，解包 `data.items`）
  - `export type ChunkEvidence = { noteId: string; noteTitle: string; chunkId: string; headingPath: string[]; content: string; noteUpdatedAt: string; relocated: boolean; neighbors: { before: ChunkNeighbor[]; after: ChunkNeighbor[] } }`
  - `export type ChunkNeighbor = { chunkId: string; headingPath: string[]; excerpt: string }`
  - `export async function fetchChunkEvidence(noteId: string, chunkId: string, opts?: { before?: number; after?: number; heading?: string[] }): Promise<ChunkEvidence>`

> **【合并自计划 2 Task 8（2026-09-02 用户裁决）】同一文件一次建成以下管理 API**（不再独立轮）：
> - `renameConversation(id, title): Promise<void>`（PATCH `/api/assistant/conversations/:id`，body `{ title }`）
> - `setConversationStatus(id, action: 'archive' | 'unarchive' | 'delete'): Promise<void>`（POST `/api/assistant/conversations/:id/:action`）
> - `searchAssistant(query): Promise<AssistantSearchResult>`（GET `/api/assistant/search?q=`，解包 `data`）
> - `export type AssistantSearchResult = { conversations: Array<{ id: string; title: string; updatedAt: string }>; messages: Array<{ conversationId: string; messageId: string; seq: number; role: string; snippet: string; updatedAt: string }> }`
> - `branchConversation(id, fromSeq): Promise<{ id: string }>`（POST `/api/assistant/conversations/:id/branch`，body `{ fromSeq }`）
> - `exportConversation(id): Promise<void>`（GET `/api/assistant/conversations/:id/export` → blob → `URL.createObjectURL` + `anchor.download = assistant-<id>.jsonl`——代理不透传 Content-Disposition，故用 JS anchor 自设文件名）
> - 错误处理统一：`if (!response.ok) throw new Error('中文错误')`；解包 `payload?.data ?? payload`。
- Produces（`assistant-navigation.ts`）：
  - `export type AssistantNavigationSnapshot = { conversationId: string; messageId?: string; citationId?: string; contextPanelTab: 'citations' | 'info'; expandedChunkIds: string[]; scrollAnchorMessageId?: string; savedAt: string }`
  - `export function saveAssistantNavigation(snapshot: AssistantNavigationSnapshot): void`
  - `export function consumeAssistantNavigation(): AssistantNavigationSnapshot | null`（读取并清除）
  - `export function peekAssistantNavigation(): AssistantNavigationSnapshot | null`
  - `export function clearAssistantNavigation(): void`
  - 存储键 `assistant_navigation_snapshot_v1`（sessionStorage）。

- [ ] **Step 1: 写失败测试**

```ts
// notes-frontend/__tests__/assistant-navigation.spec.ts
import { saveAssistantNavigation, consumeAssistantNavigation, peekAssistantNavigation, clearAssistantNavigation } from '@/components/assistant/assistant-navigation'

beforeEach(() => sessionStorage.clear())

test('快照保存后可窥视，消费后清除', () => {
  const snapshot = { conversationId: 'c1', messageId: 'm1', contextPanelTab: 'citations' as const, expandedChunkIds: ['chunk-1'], savedAt: '2026-09-01T00:00:00.000Z' }
  saveAssistantNavigation(snapshot)
  expect(peekAssistantNavigation()?.conversationId).toBe('c1')
  expect(consumeAssistantNavigation()?.expandedChunkIds).toEqual(['chunk-1'])
  expect(consumeAssistantNavigation()).toBeNull()
})

test('损坏数据返回 null 且不抛错', () => {
  sessionStorage.setItem('assistant_navigation_snapshot_v1', '{bad json')
  expect(consumeAssistantNavigation()).toBeNull()
})

test('clear 清除快照', () => {
  saveAssistantNavigation({ conversationId: 'c1', contextPanelTab: 'info', expandedChunkIds: [], savedAt: '2026-09-01T00:00:00.000Z' })
  clearAssistantNavigation()
  expect(peekAssistantNavigation()).toBeNull()
})
```

**Step 1b（合并自计划 2 Task 8）：管理 API 失败测试**

```ts
// notes-frontend/__tests__/assistant-api.spec.ts
import { renameConversation, setConversationStatus, searchAssistant, branchConversation, exportConversation } from '@/lib/assistant-api'

test('renameConversation 发送 PATCH', async () => {
  global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as any
  await renameConversation('c1', '新标题')
  expect(fetch).toHaveBeenCalledWith('/api/assistant/conversations/c1', expect.objectContaining({ method: 'PATCH' }))
})

test('setConversationStatus 发送对应动作', async () => {
  global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as any
  await setConversationStatus('c1', 'delete')
  expect(fetch).toHaveBeenCalledWith('/api/assistant/conversations/c1/delete', expect.objectContaining({ method: 'POST' }))
})

test('searchAssistant 解包 data', async () => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ data: { conversations: [{ id: 'c1', title: 'P3', updatedAt: '' }], messages: [] } }), { status: 200 })) as any
  const result = await searchAssistant('P3')
  expect(result.conversations[0].id).toBe('c1')
})

test('branchConversation 发送 POST 并解包', async () => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ data: { id: 'b1' } }), { status: 200 })) as any
  const result = await branchConversation('c1', 3)
  expect(fetch).toHaveBeenCalledWith('/api/assistant/conversations/c1/branch', expect.objectContaining({ method: 'POST' }))
  expect(result.id).toBe('b1')
})

test('exportConversation 触发带文件名下载', async () => {
  const create = jest.fn(() => ({ href: '', click: jest.fn() }))
  const revoke = jest.fn()
  URL.createObjectURL = jest.fn(() => 'blob:url')
  URL.revokeObjectURL = revoke
  // jsdom 无 document.createElement 拦截时用 spy
  const anchorSpy = jest.spyOn(document, 'createElement').mockReturnValueOnce({ href: '', download: '', click: jest.fn() } as any)
  global.fetch = jest.fn(async () => new Response(new Blob(['{}']), { status: 200 })) as any
  await exportConversation('c1')
  expect(anchorSpy.mock.results[0].value.download).toBe('assistant-c1.jsonl')
  anchorSpy.mockRestore()
})
```

- [ ] **Step 2b（合并）：运行确认管理 API 失败**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/assistant-api.spec.ts`
Expected: FAIL（模块不存在或函数不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-frontend/src/lib/assistant-api.ts
'use client';

export type ConversationListItem = { id: string; title: string; status: 'active' | 'archived' | 'deleted'; lastMessageAt?: string; messageCount: number; updatedAt: string };

export type ChunkNeighbor = { chunkId: string; headingPath: string[]; excerpt: string };

export type ChunkEvidence = {
  noteId: string; noteTitle: string; chunkId: string; headingPath: string[];
  content: string; noteUpdatedAt: string; relocated: boolean;
  neighbors: { before: ChunkNeighbor[]; after: ChunkNeighbor[] };
};

export async function fetchConversations(): Promise<ConversationListItem[]> {
  const response = await fetch('/api/assistant/conversations', { cache: 'no-store' });
  if (!response.ok) throw new Error('会话列表加载失败');
  const payload = await response.json();
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchChunkEvidence(noteId: string, chunkId: string, opts?: { before?: number; after?: number; heading?: string[] }): Promise<ChunkEvidence> {
  const query = new URLSearchParams();
  if (opts?.before !== undefined) query.set('before', String(opts.before));
  if (opts?.after !== undefined) query.set('after', String(opts.after));
  if (opts?.heading?.length) query.set('heading', opts.heading.join('>'));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}/chunks/${encodeURIComponent(chunkId)}/evidence${suffix}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('证据加载失败');
  const payload = await response.json();
  return (payload?.data && typeof payload.data === 'object') ? payload.data : payload;
}

// ===== 管理 API（合并自计划 2 Task 8，2026-09-02 用户裁决：一次建成）=====

export type AssistantSearchResult = {
  conversations: Array<{ id: string; title: string; updatedAt: string }>;
  messages: Array<{ conversationId: string; messageId: string; seq: number; role: string; snippet: string; updatedAt: string }>;
};

export async function renameConversation(id: string, title: string): Promise<void> {
  const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
  });
  if (!response.ok) throw new Error('重命名失败');
}

export async function setConversationStatus(id: string, action: 'archive' | 'unarchive' | 'delete'): Promise<void> {
  const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
  if (!response.ok) throw new Error('操作失败');
}

export async function searchAssistant(query: string): Promise<AssistantSearchResult> {
  const response = await fetch(`/api/assistant/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('搜索失败');
  const payload = await response.json();
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return { conversations: Array.isArray(data?.conversations) ? data.conversations : [], messages: Array.isArray(data?.messages) ? data.messages : [] };
}

export async function branchConversation(id: string, fromSeq: number): Promise<{ id: string }> {
  const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}/branch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromSeq }),
  });
  if (!response.ok) throw new Error('分支失败');
  const payload = await response.json();
  return (payload?.data && typeof payload.data === 'object') ? payload.data : payload;
}

export async function exportConversation(id: string): Promise<void> {
  const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}/export`, { cache: 'no-store' });
  if (!response.ok) throw new Error('导出失败');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `assistant-${id}.jsonl`; // 代理不透传 Content-Disposition，JS anchor 自设文件名
  anchor.click();
  URL.revokeObjectURL(url);
}
```

```ts
// notes-frontend/src/components/assistant/assistant-navigation.ts
'use client';

export const ASSISTANT_NAVIGATION_KEY = 'assistant_navigation_snapshot_v1';

export type AssistantNavigationSnapshot = {
  conversationId: string;
  messageId?: string;
  citationId?: string;
  contextPanelTab: 'citations' | 'info';
  expandedChunkIds: string[];
  scrollAnchorMessageId?: string;
  savedAt: string;
};

export function saveAssistantNavigation(snapshot: AssistantNavigationSnapshot) {
  try { sessionStorage.setItem(ASSISTANT_NAVIGATION_KEY, JSON.stringify(snapshot)); } catch { /* storage 不可用时忽略 */ }
}

export function peekAssistantNavigation(): AssistantNavigationSnapshot | null {
  return read();
}

export function consumeAssistantNavigation(): AssistantNavigationSnapshot | null {
  const snapshot = read();
  if (snapshot) clearAssistantNavigation();
  return snapshot;
}

export function clearAssistantNavigation() {
  try { sessionStorage.removeItem(ASSISTANT_NAVIGATION_KEY); } catch { /* ignore */ }
}

function read(): AssistantNavigationSnapshot | null {
  try {
    const raw = sessionStorage.getItem(ASSISTANT_NAVIGATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.conversationId !== 'string') return null;
    return {
      conversationId: parsed.conversationId,
      messageId: typeof parsed.messageId === 'string' ? parsed.messageId : undefined,
      citationId: typeof parsed.citationId === 'string' ? parsed.citationId : undefined,
      contextPanelTab: parsed.contextPanelTab === 'info' ? 'info' : 'citations',
      expandedChunkIds: Array.isArray(parsed.expandedChunkIds) ? parsed.expandedChunkIds.filter((id: unknown) => typeof id === 'string') : [],
      scrollAnchorMessageId: typeof parsed.scrollAnchorMessageId === 'string' ? parsed.scrollAnchorMessageId : undefined,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    };
  } catch { return null; }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/assistant-navigation.spec.ts __tests__/assistant-api.spec.ts; npm run type-check`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add notes-frontend/src/lib/assistant-api.ts notes-frontend/src/components/assistant/assistant-navigation.ts notes-frontend/__tests__/assistant-navigation.spec.ts notes-frontend/__tests__/assistant-api.spec.ts
git commit -m "feat(assistant): 前端助手 API（会话管理）、导航快照与证据请求"
```

---

### Task 4: 公共 Chunk 证据组件 ChunkEvidenceViewer

**Files:**
- Create: `notes-frontend/src/components/assistant/ChunkEvidenceViewer.tsx`
- Modify: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphEvidenceList.tsx`（改为渲染 `ChunkEvidenceViewer`）
- Test: `notes-frontend/__tests__/chunk-evidence-viewer.spec.tsx`

**Interfaces:**
- Consumes: `fetchChunkEvidence`、`ChunkEvidence`、`ChunkNeighbor`。
- Produces: `ChunkEvidenceViewer({ noteId, chunkId, heading?, expanded?: boolean, onLocated? }: { noteId: string; chunkId: string; heading?: string[]; expanded?: boolean; onLocated?: () => void })`：
  - 加载后展示：笔记标题、`headingPath.join(' > ')`、完整 `content`、更新时间、`relocated` 时显示"已重新定位"徽标。
  - "展开上下文"按钮：切换显示 `neighbors.before/after` 的 excerpt 列表（点击某条邻居以 `fetchChunkEvidence(该邻居)` 切换当前查看目标）。
  - "定位到原文"链接：`/dashboard/notes/${noteId}?chunkId=${chunkId}&heading=${encodeURIComponent(headingPath.join(' > '))}`，点击前调用 `onLocated?.()`（供导航快照保存）。
  - 加载失败：显示"证据加载失败，请稍后重试。"；403/来源不可用显示"你没有权限查看该笔记的原文。"
  - 失权时不渲染 citation 中的历史 excerpt（本组件只展示后端返回的正文）。

- [ ] **Step 1: 写失败测试**

```tsx
// notes-frontend/__tests__/chunk-evidence-viewer.spec.tsx
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import ChunkEvidenceViewer from '@/components/assistant/ChunkEvidenceViewer'

const evidence = {
  noteId: 'n1', noteTitle: 'React 笔记', chunkId: 'c2', headingPath: ['React', 'Diff'],
  content: '完整 Chunk 正文：Diff 算法逐层对比。', noteUpdatedAt: '2026-09-01T00:00:00.000Z', relocated: true,
  neighbors: {
    before: [{ chunkId: 'c1', headingPath: ['React'], excerpt: '第一段摘要' }],
    after: [{ chunkId: 'c3', headingPath: ['React', 'Diff'], excerpt: '第三段摘要' }],
  },
}

test('展示完整正文、标题路径、重定位徽标与定位链接', async () => {
  // jsdom 无 Node Fetch API（Response 未定义）——用普通对象 mock（仓库惯例，同 assistant-api.spec.ts）
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: evidence }) } as any)) as any
  const onLocated = jest.fn()
  render(<ChunkEvidenceViewer noteId="n1" chunkId="c2" heading={['React', 'Diff']} onLocated={onLocated} />)
  await screen.findByText('React 笔记')
  expect(screen.getByText(/React > Diff/)).toBeInTheDocument()
  expect(screen.getByText('已重新定位')).toBeInTheDocument()
  const link = screen.getByRole('link', { name: '定位到原文' })
  expect(link).toHaveAttribute('href', '/dashboard/notes/n1?chunkId=c2&heading=React+%3E+Diff')
  link.click()
  expect(onLocated).toHaveBeenCalled()
})

test('展开上下文显示相邻 Chunk 摘要', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: evidence }) } as any)) as any
  render(<ChunkEvidenceViewer noteId="n1" chunkId="c2" heading={['React', 'Diff']} />)
  await screen.findByText('React 笔记')
  screen.getByRole('button', { name: '展开上下文' }).click()
  await screen.findByText('第一段摘要')
  expect(screen.getByText('第三段摘要')).toBeInTheDocument()
})

test('失权时显示权限提示而不是历史正文', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: '笔记不存在' }) } as any)) as any
  render(<ChunkEvidenceViewer noteId="n1" chunkId="c2" heading={[]} />)
  await screen.findByText('证据加载失败，请稍后重试。')
  expect(screen.queryByText(/完整 Chunk 正文/)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/chunk-evidence-viewer.spec.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```tsx
// notes-frontend/src/components/assistant/ChunkEvidenceViewer.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchChunkEvidence, type ChunkEvidence, type ChunkNeighbor } from '@/lib/assistant-api';

type Props = { noteId: string; chunkId: string; heading?: string[]; onLocated?: () => void };

export default function ChunkEvidenceViewer({ noteId, chunkId, heading, onLocated }: Props) {
  const [target, setTarget] = useState({ noteId, chunkId });
  const [evidence, setEvidence] = useState<ChunkEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [requestSeq, setRequestSeq] = useState(0);

  useEffect(() => {
    let active = true;
    const seq = ++requestSeq;
    setLoading(true);
    setError('');
    setEvidence(null);
    void fetchChunkEvidence(target.noteId, target.chunkId, { before: 1, after: 1, ...(heading ? { heading } : {}) })
      .then((next) => { if (active && seq === requestSeq) setEvidence(next); })
      .catch(() => { if (active && seq === requestSeq) setError('证据加载失败，请稍后重试。'); })
      .finally(() => { if (active && seq === requestSeq) setLoading(false); });
    return () => { active = false; };
  }, [target.noteId, target.chunkId]);

  if (loading) return <p className="assistant-evidence-status">正在加载原文…</p>;
  if (error) return <p className="assistant-evidence-status" role="alert">{error}</p>;
  if (!evidence) return null;

  const openNeighbor = (neighbor: ChunkNeighbor) => { setTarget({ noteId: evidence.noteId, chunkId: neighbor.chunkId }); setShowContext(false); };
  const headingPath = evidence.headingPath.length ? evidence.headingPath : heading || [];
  const href = `/dashboard/notes/${evidence.noteId}?chunkId=${encodeURIComponent(evidence.chunkId)}&heading=${encodeURIComponent(headingPath.join(' > '))}`;

  return (
    <article className="assistant-evidence" aria-label="引用原文">
      <header className="assistant-evidence-head">
        <strong>{evidence.noteTitle}</strong>
        {headingPath.length > 0 && <span className="assistant-evidence-path">{headingPath.join(' > ')}</span>}
        {evidence.relocated && <span className="assistant-evidence-badge">已重新定位</span>}
      </header>
      <p className="assistant-evidence-content">{evidence.content}</p>
      <button type="button" className="assistant-evidence-toggle" onClick={() => setShowContext((v) => !v)}>
        {showContext ? '收起上下文' : '展开上下文'}
      </button>
      {showContext && (
        <div className="assistant-evidence-neighbors">
          {evidence.neighbors.before.map((n) => (
            <button key={n.chunkId} type="button" onClick={() => openNeighbor(n)}>↑ {n.excerpt}</button>
          ))}
          {evidence.neighbors.after.map((n) => (
            <button key={n.chunkId} type="button" onClick={() => openNeighbor(n)}>{n.excerpt} ↓</button>
          ))}
        </div>
      )}
      <footer className="assistant-evidence-foot">
        <span>更新于 {new Date(evidence.noteUpdatedAt).toLocaleDateString()}</span>
        <Link href={href} onClick={() => onLocated?.()}>定位到原文</Link>
      </footer>
    </article>
  );
}
```

`KnowledgeGraphEvidenceList.tsx`：把 `EvidenceItem` 的正文展开逻辑替换为 `ChunkEvidenceViewer`（item 只展示标题与链接，点击"展开更多"时在行内挂载 `ChunkEvidenceViewer noteId chunkId heading={item.headingPath}`）；删除其内部私有正文渲染，保留 `KnowledgeGraphEvidence` 数据获取。

- [ ] **Step 4: 运行确认通过**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/chunk-evidence-viewer.spec.tsx __tests__/knowledge-graph-evidence-panel.spec.tsx; npm run type-check`
Expected: PASS（如 knowledge-graph 测试断言旧正文展开结构，同步更新断言到新组件）

- [ ] **Step 5: 提交**

```bash
git add notes-frontend/src/components/assistant/ChunkEvidenceViewer.tsx notes-frontend/src/components/knowledge-bases/KnowledgeGraphEvidenceList.tsx notes-frontend/__tests__/chunk-evidence-viewer.spec.tsx
git commit -m "feat(assistant): 公共 Chunk 证据阅读器"
```

---

### Task 5: 共享输入区 AssistantCompose 与会话列表（含管理交互）

> **【合并自计划 2 Task 8（2026-09-02 用户裁决）】**ConversationList 一次建成带管理交互（重命名/归档/删除操作菜单），不再做只读版二次修改；搜索框接线在 Task 6（AssistantWorkspace 顶栏），本 Task 只提供每项操作菜单与回调 props。

**Files:**
- Create: `notes-frontend/src/components/assistant/AssistantCompose.tsx`
- Create: `notes-frontend/src/components/assistant/ConversationList.tsx`（含管理操作菜单）
- Modify: `notes-frontend/src/components/ai/ChatWindow.tsx`（输入区改用 `AssistantCompose`）
- Test: `notes-frontend/__tests__/conversation-list.spec.tsx`（含管理操作测试）

**Interfaces:**
- Produces `AssistantCompose({ value, onChange, onSend, onStop, generating, forceNotes, onToggleForceNotes, placeholder? }: {...})`：Enter 发送 / Shift+Enter 换行、"搜索笔记"开关、生成中显示"停止"按钮、`textarea` placeholder 默认 "问问小助手…"。
- Produces `ConversationList({ items, activeId, onSelect, onNew, onRename?, onArchive?, onDelete? }: { items: ConversationListItem[]; activeId?: string; onSelect: (id: string) => void; onNew: () => void; onRename?: (id: string, title: string) => void; onArchive?: (id: string) => void; onDelete?: (id: string) => void })`：按今天 / 最近 7 天 / 更早分组渲染，active 高亮，顶部"新建会话"按钮；标题为空显示"新对话"。管理回调可选——存在时该行才渲染操作菜单（条件渲染）。
- 每项会话行右侧操作菜单（按钮组）：重命名（`aria-label` 如 `重命名 会话标题`，弹 prompt/inline 输入改名）、归档（`aria-label` 如 `归档 会话标题`）、删除（`aria-label` 如 `删除 会话标题`）。管理动作触发回调不自动刷新（由父级 AssistantWorkspace 接线刷新列表）。
- `AssistantCompose` 增加可选 `onRetryLabel?` 不需要——重试按钮在 AssistantMessages（Task 6）渲染，Compose 只管输入与发送/停止。

- [ ] **Step 1: 写失败测试**

```tsx
// notes-frontend/__tests__/conversation-list.spec.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ConversationList } from '@/components/assistant/ConversationList'

// 时间脆性防护：fixture 相对真实 Date.now() 锚定（组件用运行时时钟分组）——
// 固定时刻会在机器时钟越过偏移边界后使分组断言变红，不得写死 2026-09-01。
const now = Date.now()
const items = [
  { id: 'c-today', title: '今天会话', status: 'active' as const, messageCount: 3, updatedAt: new Date(now - 3_600_000).toISOString() },
  { id: 'c-week', title: '上周会话', status: 'active' as const, messageCount: 1, updatedAt: new Date(now - 5 * 86_400_000).toISOString() },
  { id: 'c-old', title: '', status: 'active' as const, messageCount: 0, updatedAt: new Date(now - 30 * 86_400_000).toISOString() },
]

test('按时间分组渲染且未命名会话显示新对话', () => {
  render(<ConversationList items={items} activeId="c-week" onSelect={() => undefined} onNew={() => undefined} />)
  expect(screen.getByText('今天')).toBeInTheDocument()
  expect(screen.getByText('最近 7 天')).toBeInTheDocument()
  expect(screen.getByText('更早')).toBeInTheDocument()
  expect(screen.getByText('新对话')).toBeInTheDocument()
  const active = screen.getByRole('button', { name: /上周会话/ })
  expect(active).toHaveAttribute('aria-current', 'true')
})

test('点击会话与新建按钮触发回调', () => {
  const onSelect = jest.fn()
  const onNew = jest.fn()
  render(<ConversationList items={items} activeId={undefined} onSelect={onSelect} onNew={onNew} />)
  screen.getByRole('button', { name: /今天会话/ }).click()
  expect(onSelect).toHaveBeenCalledWith('c-today')
  screen.getByRole('button', { name: '新建会话' }).click()
  expect(onNew).toHaveBeenCalled()
})

// 合并自计划 2 Task 8：管理操作菜单
test('操作菜单触发重命名/归档/删除回调', () => {
  const onRename = jest.fn()
  const onArchive = jest.fn()
  const onDelete = jest.fn()
  // handleRename 走 window.prompt——jsdom 需 mock 返回标题，否则 null 截断不触发 onRename
  const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('新标题')
  render(<ConversationList items={items} activeId={undefined} onSelect={() => undefined} onNew={() => undefined} onRename={onRename} onArchive={onArchive} onDelete={onDelete} />)
  fireEvent.click(screen.getByRole('button', { name: /重命名 今天会话/ }))
  expect(promptSpy).toHaveBeenCalled()
  expect(onRename).toHaveBeenCalledWith('c-today', '新标题')
  fireEvent.click(screen.getByRole('button', { name: /归档 今天会话/ }))
  expect(onArchive).toHaveBeenCalledWith('c-today')
  fireEvent.click(screen.getByRole('button', { name: /删除 今天会话/ }))
  expect(onDelete).toHaveBeenCalledWith('c-today')
  promptSpy.mockRestore()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/conversation-list.spec.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```tsx
// notes-frontend/src/components/assistant/ConversationList.tsx
'use client';

import { Plus } from 'lucide-react';
import type { ConversationListItem } from '@/lib/assistant-api';

type Props = {
  items: ConversationListItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  // 合并自计划 2 Task 8：管理操作（重命名弹 prompt；归档/删除直接触发，父级刷新）
  onRename?: (id: string, title: string) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
};

function groupLabel(updatedAt: string, now: number): '今天' | '最近 7 天' | '更早' {
  const diff = now - Date.parse(updatedAt);
  if (diff < 86_400_000) return '今天';
  if (diff < 7 * 86_400_000) return '最近 7 天';
  return '更早';
}

function handleRename(item: ConversationListItem, onRename?: (id: string, title: string) => void) {
  if (!onRename) return;
  const title = window.prompt('重命名会话', item.title || '')?.trim();
  if (title) onRename(item.id, title);
}

export function ConversationList({ items, activeId, onSelect, onNew, onRename, onArchive, onDelete }: Props) {
  const now = Date.now();
  const groups: Array<['今天' | '最近 7 天' | '更早', ConversationListItem[]]> = [['今天', []], ['最近 7 天', []], ['更早', []]];
  for (const item of items) groups.find(([label]) => label === groupLabel(item.updatedAt, now))![1].push(item);

  return (
    <nav className="assistant-conversations" aria-label="会话列表">
      <button type="button" className="assistant-new-conversation" onClick={onNew}><Plus aria-hidden="true" />新建会话</button>
      {groups.map(([label, group]) => group.length === 0 ? null : (
        <section key={label} className="assistant-conversation-group">
          <h4>{label}</h4>
          {group.map((item) => (
            <div key={item.id} className="assistant-conversation-row" data-active={item.id === activeId || undefined}>
              <button
                type="button"
                className="assistant-conversation-select"
                aria-current={item.id === activeId ? 'true' : undefined}
                onClick={() => onSelect(item.id)}
              >
                <span>{item.title || '新对话'}</span>
                <small>{item.messageCount} 条</small>
              </button>
              {(onRename || onArchive || onDelete) && (
                <span className="assistant-conversation-actions">
                  {onRename && <button type="button" aria-label={`重命名 ${item.title || '新对话'}`} onClick={() => handleRename(item, onRename)}>✎</button>}
                  {onArchive && <button type="button" aria-label={`归档 ${item.title || '新对话'}`} onClick={() => onArchive(item.id)}>🗂</button>}
                  {onDelete && <button type="button" aria-label={`删除 ${item.title || '新对话'}`} onClick={() => onDelete(item.id)}>🗑</button>}
                </span>
              )}
            </div>
          ))}
        </section>
      ))}
    </nav>
  );
}
```

```tsx
// notes-frontend/src/components/assistant/AssistantCompose.tsx
'use client';

import { BookOpen, Square } from 'lucide-react';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  generating: boolean;
  forceNotes: boolean;
  onToggleForceNotes: () => void;
  placeholder?: string;
};

export default function AssistantCompose({ value, onChange, onSend, onStop, generating, forceNotes, onToggleForceNotes, placeholder = '问问小助手…' }: Props) {
  return (
    <div className="ink-compose-wrap">
      <button type="button" className="ink-note-toggle" aria-pressed={forceNotes} onClick={onToggleForceNotes}>
        <BookOpen aria-hidden="true" />搜索笔记
      </button>
      <div className="ink-compose-real">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend(); }
          }}
          placeholder={placeholder}
        />
        {generating && onStop
          ? <button type="button" onClick={onStop} aria-label="停止生成"><Square aria-hidden="true" /></button>
          : <button type="button" onClick={onSend} disabled={!value.trim()} aria-label="发送">↑</button>}
      </div>
    </div>
  );
}
```

`ChatWindow.tsx`：输入区替换为 `<AssistantCompose ... />`（行为与 Task 9 一致，减少重复代码）。

- [ ] **Step 4: 运行确认通过**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/conversation-list.spec.tsx __tests__/ai-chat-window.spec.tsx; npm run type-check`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add notes-frontend/src/components/assistant/AssistantCompose.tsx notes-frontend/src/components/assistant/ConversationList.tsx notes-frontend/src/components/ai/ChatWindow.tsx notes-frontend/__tests__/conversation-list.spec.tsx
git commit -m "feat(assistant): 共享输入区与会话列表（含管理操作菜单）"
```

---

### Task 6: 全屏工作台页面与三栏布局（含搜索接线与重试）

> **【合并自计划 2 Task 8（2026-09-02 用户裁决）】**本 Task 一次集成：顶栏搜索框（防抖 300ms 调 `searchAssistant`，命中点击跳转对应会话并定位消息）、会话列表管理回调接线（重命名/归档/删除后刷新或移除）、失败回答"重新回答"按钮（`AssistantMessages` 的 `onRetry` 以 `retryOfMessageId` 重发）。

**Files:**
- Create: `notes-frontend/src/app/dashboard/assistant/page.tsx`
- Create: `notes-frontend/src/components/assistant/AssistantWorkspace.tsx`
- Create: `notes-frontend/src/components/assistant/AssistantMessages.tsx`
- Create: `notes-frontend/src/components/assistant/AssistantContextPanel.tsx`
- Create: `notes-frontend/src/styles/assistant-workspace.css`
- Modify: `notes-frontend/src/components/ai/ChatWindow.tsx`（"展开"入口）
- Test: `notes-frontend/__tests__/assistant-workspace.spec.tsx`

**Interfaces:**
- Consumes: `fetchConversations`、`fetchConversationMessages`、`streamAssistantReply`、`AssistantCompose`、`ConversationList`、`ChunkEvidenceViewer`、`assistant-navigation.ts`、`searchAssistant`、`renameConversation`、`setConversationStatus`、`exportConversation`（后三者合并自计划 2 Task 8，定义于 Task 3 的 assistant-api.ts）。
- Produces:
  - `AssistantWorkspace({ initialConversationId? }: { initialConversationId?: string })`：
    - 三栏：左 `ConversationList`（260px）；中消息流 + `AssistantCompose`；右 `AssistantContextPanel`（360–440px）。
    - `< 1180px` 时右栏为覆盖式抽屉（按钮"查看引用"切换）；移动端（`< 768px`）单栏，通过"会话 / 对话 / 上下文"标签切换。
    - 首次挂载：`consumeAssistantNavigation()` 恢复会话、滚动锚点、右侧引用与展开的 Chunk；URL `?conversation=` 优先。
    - 发送逻辑复用阶段一契约：`streamAssistantReply` + `(userId, requestId)` 幂等；`onStarted` 写 `assistant_current_conversation_id`（localStorage）供浮层共享。
    - 引用点击：`AssistantContextPanel` 内挂载 `ChunkEvidenceViewer`；"定位到原文"前 `saveAssistantNavigation({ conversationId, messageId, citationId, contextPanelTab, expandedChunkIds, scrollAnchorMessageId, savedAt })` 再跳转。
    - 返回时从 URL/快照恢复并滚动到 `scrollAnchorMessageId`。
    - **（合并 Task 8）搜索**：顶栏搜索框输入防抖 300ms 调 `searchAssistant(query)`；结果下拉/列表展示（标题命中与消息命中分开，消息命中标注会话标题 + snippet + seq）；点击跳转 `?conversation=<id>` 并携带消息 seq 锚点（加载后滚动定位到该消息）；清空输入收起结果。
    - **（合并 Task 8）会话管理接线**：`ConversationList` 的 `onRename` → `renameConversation(id, title)` 成功后刷新列表；`onArchive` → `setConversationStatus(id, 'archive')` 后从列表移除；`onDelete` → `setConversationStatus(id, 'delete')` 后移除（并若为当前会话则清空当前选择）；顶栏导出按钮（当前会话）→ `exportConversation(id)`。
  - `AssistantMessages({ messages, generating, onRetry }: ...)`：渲染消息流（来源标签、ReactMarkdown、citations/warnings、failed 重试按钮）。
    - **（合并 Task 8）重试**：failed 消息显示"重新回答"按钮（`aria-label="重新回答"`）→ `onRetry(messageId)` 以该消息为 `retryOfMessageId` 走 `streamAssistantReply` 重发；原失败消息保留。
  - `AssistantContextPanel({ tab, onTabChange, citation?, evidenceTarget? }: ...)`：`citations` 标签展示当前回答引用列表（点击某引用在面板内加载 `ChunkEvidenceViewer`）；`info` 标签展示会话信息占位（阶段三补全）。
- `ChatWindow`"展开"按钮：`<Link href={`/dashboard/assistant${conversationId ? `?conversation=${conversationId}` : ''}`}>`（用 `useRouter().push` 亦可），保留原 `Maximize2` 图标与 `aria-label="展开全屏工作台"`。

- [ ] **Step 1: 写失败测试**

```tsx
// notes-frontend/__tests__/assistant-workspace.spec.tsx
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { AssistantWorkspace } from '@/components/assistant/AssistantWorkspace'

test('加载会话列表并选中当前会话，三栏均渲染', async () => {
  // jsdom 无 Node Fetch API（Response 未定义）——普通对象 mock（仓库惯例，同 assistant-api.spec.ts）
  const json = (body: any, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body } as any)
  const fetchMock = jest.fn(async (url: string) => {
    if (String(url).includes('/conversations?')) return json({ items: [{ id: 'c1', title: '会话一', status: 'active', messageCount: 2, updatedAt: new Date().toISOString() }] })
    if (String(url).includes('/messages')) return json({ items: [] })
    return json({})
  }) as any
  global.fetch = fetchMock
  render(<AssistantWorkspace initialConversationId="c1" />)
  await screen.findByText('会话一')
  expect(screen.getByRole('navigation', { name: '会话列表' })).toBeInTheDocument()
  expect(screen.getByPlaceholderText('问问小助手…')).toBeInTheDocument()
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/assistant/conversations'), expect.anything()))
})

test('空会话显示空态文案', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) } as any)) as any
  render(<AssistantWorkspace />)
  await screen.findByText(/今天想聊点什么/)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/assistant-workspace.spec.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现（关键骨架）**

```tsx
// notes-frontend/src/components/assistant/AssistantWorkspace.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BookOpen, Loader2, PanelRight, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { fetchConversations, fetchChunkEvidence } from '@/lib/assistant-api';
import { fetchConversationMessages, streamAssistantReply, type AssistantMessageView, type RagCitation } from '@/lib/assistant-stream-client';
import { ConversationList } from './ConversationList';
import AssistantCompose from './AssistantCompose';
import ChunkEvidenceViewer from './ChunkEvidenceViewer';
import { consumeAssistantNavigation, saveAssistantNavigation } from './assistant-navigation';

const CURRENT_CONVERSATION_KEY = 'assistant_current_conversation_id';

type CitationTarget = { citation: RagCitation; key: string };

export function AssistantWorkspace({ initialConversationId }: { initialConversationId?: string }) {
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<Array<{ id: string; title: string; status: string; messageCount: number; updatedAt: string }>>([]);
  const [activeId, setActiveId] = useState<string>(initialConversationId || searchParams?.get('conversation') || '');
  const [messages, setMessages] = useState<AssistantMessageView[]>([]);
  const [input, setInput] = useState('');
  const [forceNotes, setForceNotes] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [tab, setTab] = useState<'conversations' | 'chat' | 'context'>('chat');
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [citationTarget, setCitationTarget] = useState<CitationTarget | null>(null);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchConversations().then(setConversations).catch(() => setConversations([]));
  }, []);

  useEffect(() => {
    if (!activeId || loadedConversationId === activeId) return;
    let active = true;
    void fetchConversationMessages(activeId)
      .then((result) => { if (active) { setMessages(result.items); setLoadedConversationId(activeId); } })
      .catch(() => { if (active) setMessages([]); });
    return () => { active = false; };
  }, [activeId, loadedConversationId]);

  // 恢复导航快照：返回时定位到原消息与引用。
  useEffect(() => {
    const snapshot = consumeAssistantNavigation();
    if (!snapshot) return;
    if (snapshot.conversationId && !activeId) setActiveId(snapshot.conversationId);
    if (snapshot.contextPanelTab) setTab(snapshot.contextPanelTab === 'info' ? 'context' : tab);
    if (snapshot.expandedChunkIds.length > 0) setContextPanelOpen(true);
  }, []);

  const handleSend = () => {
    const content = input.trim();
    if (!content || generating) return;
    const route = forceNotes ? 'rag' : (/(我的笔记|笔记里|之前|当时|踩坑|查找|找到|搜索|哪篇|比较|区别|差异|冲突|矛盾|知识库)/i.test(content) ? 'rag' : 'pet');
    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
    activeRequestIdRef.current = requestId;
    setInput('');
    setGenerating(true);
    let assistantId = `local-${requestId}`;
    setMessages((prev) => [...prev,
      { id: `local-user-${requestId}`, conversationId: activeId, seq: prev.length + 1, role: 'user', route, content, status: 'completed', citations: [], warnings: [], createdAt: new Date().toISOString() },
      { id: assistantId, conversationId: activeId, seq: prev.length + 2, role: 'assistant', route, content: '', status: 'pending', citations: [], warnings: [], createdAt: new Date().toISOString() },
    ]);
    void streamAssistantReply(
      { conversationId: activeId || undefined, requestId, question: content, forceRoute: route },
      {
        onStarted: (data) => {
          setActiveId(data.conversationId);
          localStorage.setItem(CURRENT_CONVERSATION_KEY, data.conversationId);
          assistantId = data.assistantMessageId;
        },
        onDelta: (text) => setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text, status: 'streaming' } : m))),
        onComplete: (data) => setMessages((prev) => prev.map((m) => (m.id === data.messageId ? { ...m, status: 'completed', citations: data.citations, warnings: data.warnings, id: data.messageId } : m))),
        onCancelled: (data) => setMessages((prev) => prev.map((m) => (m.id === data.messageId ? { ...m, status: 'cancelled', content: data.text } : m))),
        onError: () => setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: 'failed' } : m))),
      },
    ).catch(() => setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: 'failed' } : m)))).finally(() => { activeRequestIdRef.current = null; setGenerating(false); });
  };

  const handleStop = () => {
    const current = activeRequestIdRef.current;
    if (current) void fetch(`/api/assistant/generations/${encodeURIComponent(current)}/cancel`, { method: 'POST' }).catch(() => undefined);
  };

  const handleLocate = () => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;
    saveAssistantNavigation({
      conversationId: activeId,
      messageId: lastAssistant.id,
      citationId: citationTarget?.citation.evidenceId,
      contextPanelTab: tab === 'context' ? 'info' : 'citations',
      expandedChunkIds: citationTarget ? [citationTarget.citation.chunkId] : [],
      scrollAnchorMessageId: lastAssistant.id,
      savedAt: new Date().toISOString(),
    });
  };

  // 布局骨架：三栏；<1180px 右栏覆盖式抽屉；<768px 单栏标签切换。
  return (
    <div className="assistant-workspace">
      <aside className="assistant-workspace-side">{/* ConversationList */}</aside>
      <main className="assistant-workspace-main">
        {/* AssistantMessages 消息流 */}
        {/* AssistantCompose */}
      </main>
      <aside className={`assistant-workspace-context${contextPanelOpen ? ' is-open' : ''}`}>
        {citationTarget ? <ChunkEvidenceViewer noteId={citationTarget.citation.noteId} chunkId={citationTarget.citation.chunkId} heading={citationTarget.citation.headingPath} onLocated={handleLocate} /> : <p className="assistant-evidence-status">选择一条引用查看原文。</p>}
      </aside>
    </div>
  );
}
```

> **（合并自计划 2 Task 8，2026-09-02 用户裁决）实现者在上述骨架上补齐以下接线与状态，测试同步补到 `assistant-workspace.spec.tsx`：**
> - 新增状态：`searchQuery`、`searchResults: AssistantSearchResult | null`、`searchOpen`。
> - 搜索：顶栏 `<input aria-label="搜索会话与消息" value={searchQuery} onChange={...}>`，防抖 300ms 调 `searchAssistant`（`useRef` 存 timer；空输入清结果收起）。结果区：标题命中（点击 → 设 activeId + 清输入）、消息命中（显示 `snippet` + 会话标题 + `seq`；点击 → 设 activeId + 记录 `pendingMessageSeq` → 消息加载后滚动定位）。
> - 管理回调：`handleRename(id, title)` → `renameConversation` → 成功后 `fetchConversations().then(setConversations)`；`handleArchive(id)` → `setConversationStatus(id, 'archive')` → 列表过滤移除；`handleDelete(id)` → `setConversationStatus(id, 'delete')` → 移除，若为当前会话则 `setActiveId('')`；均 `catch` 忽略。传 `ConversationList` 的 `onRename/onArchive/onDelete`。
> - 导出按钮（顶栏，当前会话存在时显示）：`onClick={() => exportConversation(activeId)}`。
> - 重试：`handleRetry(messageId)` 找到对应 assistant 消息（取其前一条 user 消息内容或该消息内容作 question），`streamAssistantReply({ conversationId: activeId, requestId: 新 uuid, question, retryOfMessageId: messageId })`，乐观追加新 assistant 占位；`AssistantMessages` 的 failed 消息"重新回答"按钮 `aria-label="重新回答"` 触发 `onRetry(message.id)`，原失败消息保留。
> - `AssistantWorkspace` 顶栏含搜索框 + 导出按钮；状态接线满足上述 Interfaces。

```tsx
// notes-frontend/src/app/dashboard/assistant/page.tsx
'use client';

import { Suspense } from 'react';
import { AssistantWorkspace } from '@/components/assistant/AssistantWorkspace';

export default function AssistantPage() {
  return (
    <Suspense fallback={<div className="assistant-workspace-loading">正在打开小助手工作台…</div>}>
      <AssistantWorkspace />
    </Suspense>
  );
}
```

`AssistantMessages.tsx`：接收 `messages`/`generating`，渲染来源标签（route）、ReactMarkdown 正文、`status==='failed'` 显示"回答生成中断，请重试。"与重试按钮（`onRetry` 以原问题重发）、`citations` 渲染引用按钮（点击 `onOpenCitation(citation)`）、`warnings` 列表、loading 指示与 `messagesEndRef`。
`AssistantContextPanel.tsx`：`citations` 标签列出当前回答的 citations；`info` 标签显示会话基本信息（标题、消息数、创建时间）。
`assistant-workspace.css`：三栏 grid（260px / minmax(520px,1fr) / 360-440px）、`@media (max-width: 1180px)` 右栏 fixed 覆盖式抽屉、`@media (max-width: 767px)` 单栏 + 顶部标签切换，全部使用 `var(--product-*)` token，字体与间距沿用现有纸张风格。

`ChatWindow.tsx`：把 `handleLocate` 之外增加"展开"按钮，`onClick={() => router.push(`/dashboard/assistant${conversationIdRef.current ? `?conversation=${conversationIdRef.current}` : ''}`)}`（引入 `useRouter`）。

- [ ] **Step 4: 运行确认通过**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/assistant-workspace.spec.tsx __tests__/ai-chat-window.spec.tsx; npm run type-check`
Expected: PASS；TypeScript 通过（workspace 测试含搜索接线、管理回调、重试按钮用例）

- [ ] **Step 5: 提交**

```bash
git add notes-frontend/src/app/dashboard/assistant/page.tsx notes-frontend/src/components/assistant/AssistantWorkspace.tsx notes-frontend/src/components/assistant/AssistantMessages.tsx notes-frontend/src/components/assistant/AssistantContextPanel.tsx notes-frontend/src/styles/assistant-workspace.css notes-frontend/src/components/ai/ChatWindow.tsx notes-frontend/__tests__/assistant-workspace.spec.tsx
git commit -m "feat(assistant): 全屏助手工作台三栏布局与搜索重试管理接线"
```

---

### Task 7: 引用跳转与返回恢复（浏览器验收）

**Files:**
- Modify: `notes-frontend/src/components/assistant/AssistantWorkspace.tsx`（若 Task 6 未完整接好"定位到原文"与恢复逻辑）
- Modify: `notes-frontend/src/components/assistant/AssistantContextPanel.tsx`（引用切换）
- 无新增代码文件（本任务以验证为主）

- [ ] **Step 1: 单元验证（引用点击 → ChunkEvidenceViewer → 定位链接）**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/chunk-evidence-viewer.spec.tsx __tests__/assistant-workspace.spec.tsx`
Expected: PASS；确认 `onLocated` 回调内先 `saveAssistantNavigation` 再跳转

- [ ] **Step 2: 构建与全量回归**

Run: `npm run ci:test; npm run type-check; npm run build`
Expected: 全部通过；production build 无新错误

- [ ] **Step 3: 浏览器冒烟（服务运行中，使用已有验收账户）**

- 打开 `/dashboard/assistant`，确认三栏可见；新建会话并发送问题（先普通聊天，再开"搜索笔记"问"蓝色海豚对应的项目结论是什么？"）。
- 回答完成后点击引用 → 右侧出现 `ChunkEvidenceViewer`（完整正文 + 标题路径 + 更新时间）。
- 点击"展开上下文"，确认前后相邻 Chunk 摘要出现。
- 点击"定位到原文"→ 进入笔记编辑器并定位到对应 Chunk；浏览器返回（History back）→ 回到 `/dashboard/assistant`，确认仍处于原会话、右侧引用仍打开（或按快照恢复）。
- 移动端 viewport（390×844）：确认单栏标签切换可用；`<1180px`（如 1024×768）确认右栏变为覆盖式抽屉。
- 控制台无错误；后端日志无异常堆栈。

- [ ] **Step 4: 提交收尾（如无代码变更则跳过）**

```bash
git status --short
git log --oneline -8
```
Expected: 工作区干净；阶段二提交均在 `master`。

---

## Self-Review 记录

- 规格覆盖：`/dashboard/assistant` 路由（Task 6）、三栏布局与断点（Task 6 CSS）、会话列表新建/分组/管理操作（Task 5/6）、搜索接线与重试（Task 6）、引用 Chunk 阅读（Task 2/4）、相邻上下文（Task 2/4）、定位原文才进编辑器（Task 4/6/7）、导航快照与返回恢复（Task 3/6/7）、公共 `ChunkEvidenceViewer` 与知识图谱复用（Task 4）、失权不返回历史正文（Task 2/4）。
- **合并注记（2026-09-02）**：计划 2 Task 8（会话管理 UI：重命名/归档/删除/搜索 + 5 个管理 API 函数）按用户裁决拆分并入本计划——管理 API 并入 Task 3（assistant-api.ts）、管理操作菜单并入 Task 5（ConversationList）、搜索/重试/管理接线并入 Task 6（AssistantWorkspace）；Task 8 不再独立执行，本计划完成后计划 2 即整体完结。原"本阶段列表只读"描述作废。
- 占位符扫描：无 TBD/TODO；`info` 标签的会话信息为可渲染占位内容（标题/消息数/创建时间），非"以后再说"。
- 类型一致性：`AssistantMessageView`/`RagCitation`/`streamAssistantReply`/`fetchConversationMessages` 沿用阶段一；`ConversationListItem`（Task 3）与后端 `list()` 返回字段一致；`ChunkEvidence`/`ChunkNeighbor`（Task 3）与后端 `getChunkEvidence` 返回一致；`AssistantNavigationSnapshot`（Task 3）在 Task 6 `saveAssistantNavigation` 处按同一字段写入。
