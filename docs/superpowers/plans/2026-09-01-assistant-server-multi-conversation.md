# 阶段三：服务端多会话、上下文压缩、搜索与分支 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在阶段一/二的基础上补全服务端多会话管理：重命名、归档、软删除、搜索、分支、重试追溯，以及基于 Token 预算的上下文组装与可重建 Checkpoint 压缩，并支持 JSONL 导出。会话与消息严格按 `userId` 隔离。

**Architecture:** 后端在 `assistant` 模块扩展会话/消息服务与控制器（PATCH/archive/delete/search/branch/export/checkpoint/manual-summary），新增 `assistant_context_checkpoints` 集合与 `AssistantContextService`（Token 预算分节组装）、`AssistantCheckpointService`（异步压缩）。重试复用阶段一 SSE 协议，通过 `retryOfMessageId` 关联。前端会话列表补充重命名/归档/删除/搜索交互，消息流支持分页拉取。

**Tech Stack:** NestJS 10 + Mongoose 8 + MongoDB + BullMQ（复用既有 Redis 队列模式，仅 checkpoint 异步化使用，也可退化为 fire-and-forget）+ Next.js 16 + Jest/jsdom + node:test。

## Global Constraints

- 所有会话、消息、搜索、checkpoint 查询必须同时约束 `userId`。
- 删除会话为软删除（`status: 'deleted'` + `deletedAt`），并停止该会话运行中的 generation。
- 编辑历史用户问题的语义是"从这里创建分支"，不就地改写原消息。
- 重试创建新的 assistant 消息并通过 `retryOfMessageId` 指向旧回答，不覆盖历史。
- Checkpoint 只总结目标、已明确结论、未解决问题、术语关系和必须延续的限制；不得把推测写成事实，不得自动进入认知轨迹（阶段四）。
- 中文检索第一阶段使用正则包含匹配（`$regex` 转义后），比 Mongo 默认分词对 CJK 更可预测；消息正文同时建立 text index 供后续语义召回演进。
- `[已确认认知]` 分节由可选注入的 `MemoryRecallService` 提供；阶段三未实现时该节为空，不得影响既有 pet/rag 行为。
- RAG 场景在预算冲突时优先保留笔记证据，不为聊天历史牺牲关键引用。
- 前端 `/api/assistant/*` 的 Next 代理路由已由阶段一 Task 8 建立（GET/POST/PATCH/DELETE、SSE/JSONL 透传），本阶段新端点（PATCH rename、archive/delete、search、branch、checkpoint、export）自动透传，无需新增前端路由。
- 前后端测试命令同前两个阶段；不触碰 `codex配置ar.md`。

## File Structure

后端 `notes-backend/src/modules/assistant/`：

- Modify `schemas/assistant-conversation.schema.ts`：增加 `activeRequestId?`、`parentConversationId?`、`forkedFromSeq?`。
- Create `schemas/assistant-checkpoint.schema.ts`：`assistant_context_checkpoints`。
- Modify `assistant-conversations.service.ts`：`rename` / `setStatus` / `search` / `branch`。
- Modify `assistant-messages.service.ts`：`searchMessages` / `page`（复用 `list`）。
- Create `assistant.constants.ts`：`MEMORY_RECALL_SERVICE` symbol 与 `MemoryRecallServiceLike` 接口（阶段四扩展其余记忆类型）。
- Create `assistant-context.service.ts`：`assemble`（Token 预算分节）。
- Create `assistant-checkpoint.service.ts`：`build` / `getLatest` / `invalidateAfter`。
- Modify `assistant-generation.service.ts`：`activeRequestId` 维护、`retryOfMessageId`、pet 分支接入上下文、完成时触发 checkpoint 与标题。
- Modify `assistant.controller.ts`：`PATCH conversations/:id`、`POST conversations/:id/archive|unarchive|delete`、`GET search`、`POST conversations/:id/branch`、`GET conversations/:id/export`、`POST conversations/:id/checkpoint`。
- Modify `assistant.module.ts`：注册 checkpoint schema、`AssistantContextService`、`AssistantCheckpointService`。
- Modify `notes-backend/src/modules/ai/ai-gateway.types.ts`：`AiTask` 增加 `'context_summary'`。
- Test: `assistant-conversation-management.test.ts`、`assistant-search.test.ts`、`assistant-branch.test.ts`、`assistant-context-assembly.test.ts`、`assistant-checkpoint.test.ts`。

前端：

- Modify `notes-frontend/src/components/assistant/ConversationList.tsx`：重命名/归档/删除/搜索。
- Modify `notes-frontend/src/lib/assistant-api.ts`：`renameConversation` / `setConversationStatus` / `searchAssistant` / `branchConversation` / `exportConversation`。
- Modify `notes-frontend/src/components/assistant/AssistantWorkspace.tsx`：搜索框与结果跳转、会话操作回调、重试按钮（`retryOfMessageId`）。
- Test: `conversation-list.spec.tsx` 扩展、`assistant-api.spec.ts`。

---

### Task 1: 会话管理端点（重命名 / 归档 / 删除）

**Files:**
- Modify: `notes-backend/src/modules/assistant/schemas/assistant-conversation.schema.ts`
- Modify: `notes-backend/src/modules/assistant/assistant-conversations.service.ts`
- Modify: `notes-backend/src/modules/assistant/assistant-generation.service.ts`（`cancelByConversation` + `activeRequestId` 维护）
- Modify: `notes-backend/src/modules/assistant/assistant.controller.ts`
- Test: `notes-backend/test/assistant-conversation-management.test.ts`

**Interfaces:**
- Consumes: `AssistantConversation` 模型。
- Produces:
  - `AssistantConversationsService.rename(userId, id, title): Promise<{ id: string; title: string }>`
  - `AssistantConversationsService.setStatus(userId, id, status: 'active' | 'archived' | 'deleted'): Promise<{ id: string; status: string }>`（deleted 同时写 `deletedAt`）。
  - `AssistantConversationsService.setActiveRequest(userId, id, requestId: string | null)`。
  - `AssistantConversationsService.getActiveRequest(userId, id): Promise<string | null>`。
  - `AssistantGenerationService.cancelByConversation(userId, conversationId)`：读 `getActiveRequest`，有则 `cancel(requestId, userId)`。
  - `AssistantGenerationService.start` 在占位消息创建后 `setActiveRequest(userId, conversation.id, requestId)`，`runGeneration` 的 `finally` 中清空（`setActiveRequest(userId, conversation.id, null)`）。
  - 端点：`PATCH /api/assistant/conversations/:id`（body `{ title }`）；`POST /api/assistant/conversations/:id/archive` / `unarchive` / `delete`；delete 时先 `generation.cancelByConversation(userId, id)`。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-conversation-management.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantConversationsService } from '../src/modules/assistant/assistant-conversations.service'
import { AssistantGenerationService } from '../src/modules/assistant/assistant-generation.service'

class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  async findOne(filter: any) { return this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) ?? null }
  async updateOne(filter: any, update: any) {
    const doc = this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v)))
    if (doc) Object.assign(doc, update.$set)
  }
}

test('rename 只能改自己的会话', async () => {
  const model = new MemoryModel([{ _id: 'c1', userId: 'u1', title: '旧标题', status: 'active' }])
  const service = new AssistantConversationsService(model as any)
  const renamed = await service.rename('u1', 'c1', '新标题')
  assert.equal(renamed.title, '新标题')
  await assert.rejects(() => service.rename('u2', 'c1', 'x'), /not found/i)
})

test('setStatus 删除时写入 deletedAt', async () => {
  const model = new MemoryModel([{ _id: 'c1', userId: 'u1', title: 't', status: 'active' }])
  const service = new AssistantConversationsService(model as any)
  const result = await service.setStatus('u1', 'c1', 'deleted')
  assert.equal(result.status, 'deleted')
  assert.ok(model.docs[0].deletedAt)
})

test('activeRequest 读写', async () => {
  const model = new MemoryModel([{ _id: 'c1', userId: 'u1', title: 't', status: 'active' }])
  const service = new AssistantConversationsService(model as any)
  await service.setActiveRequest('u1', 'c1', 'req-1')
  assert.equal(await service.getActiveRequest('u1', 'c1'), 'req-1')
  await service.setActiveRequest('u1', 'c1', null)
  assert.equal(await service.getActiveRequest('u1', 'c1'), null)
})

test('cancelByConversation 取消该会话正在运行的生成', async () => {
  const conversations = { getActiveRequest: async () => 'req-9' }
  const service = new AssistantGenerationService(conversations as any, {} as any, {} as any, {} as any, undefined as any)
  let cancelled = ''
  // 用实例方法覆写观测 cancel 调用（cancel 内部依赖私有 cancelKeys/emitters）。
  service.cancel = async (requestId: string) => { cancelled = requestId }
  await service.cancelByConversation('u1', 'c1')
  assert.equal(cancelled, 'req-9')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-conversation-management.test.ts`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 最小实现**

schema 增加：

```ts
@Prop()
activeRequestId?: string

@Prop({ type: Types.ObjectId })
parentConversationId?: Types.ObjectId

@Prop()
forkedFromSeq?: number
```

service 增加：

```ts
async rename(userId: string, id: string, title: string) {
  const doc = await this.model.findOneAndUpdate(
    { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
    { $set: { title: String(title || '').trim().slice(0, 80) || '新对话' } },
    { new: true },
  ).lean().exec()
  if (!doc) throw new Error('conversation not found')
  return { id: String(doc._id), title: String(doc.title) }
}

async setStatus(userId: string, id: string, status: 'active' | 'archived' | 'deleted') {
  const update: any = { $set: { status } }
  if (status === 'deleted') update.$set.deletedAt = new Date()
  if (status === 'active') update.$set.deletedAt = null
  const doc = await this.model.findOneAndUpdate(
    { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
    update,
    { new: true },
  ).lean().exec()
  if (!doc) throw new Error('conversation not found')
  return { id: String(doc._id), status: doc.status }
}

async setActiveRequest(userId: string, id: string, requestId: string | null) {
  // 显式写 null 清空（$set: undefined 在 Mongoose 中不更新字段，会残留旧 requestId）
  await this.model.updateOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) }, { $set: { activeRequestId: requestId } }).exec()
}

async getActiveRequest(userId: string, id: string) {
  const doc = await this.model.findOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) }).select('activeRequestId').lean().exec()
  return doc?.activeRequestId ?? null
}
```

controller 增加（注入 `AssistantConversationsService` 与 `AssistantGenerationService`）：

```ts
@Patch('conversations/:id')
async renameConversation(@Param('id') id: string, @Body('title') title: string, @Req() req?: AuthenticatedRequest) {
  return this.conversations.rename(this.userId(req) || '', id, String(title || ''))
}

@Post('conversations/:id/archive')
async archive(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
  return this.conversations.setStatus(this.userId(req) || '', id, 'archived')
}

@Post('conversations/:id/unarchive')
async unarchive(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
  return this.conversations.setStatus(this.userId(req) || '', id, 'active')
}

@Post('conversations/:id/delete')
async deleteConversation(@Param('id') id: string, @Req() req?: AuthenticatedRequest) {
  const userId = this.userId(req) || ''
  await this.generation.cancelByConversation(userId, id)
  return this.conversations.setStatus(userId, id, 'deleted')
}
```

`assistant-generation.service.ts` 增加：

```ts
async cancelByConversation(userId: string, conversationId: string) {
  const requestId = await this.conversations.getActiveRequest(userId, conversationId)
  if (requestId) await this.cancel(requestId, userId)
}
```

`activeRequestId` 维护（`start` 中占位消息创建后、`runGeneration` 的 `finally` 中）：

```ts
await this.conversations.setActiveRequest(userId, conversation.id, requestId)
// ... runGeneration 的 finally 中：
await this.conversations.setActiveRequest(userId, conversation.id, null).catch(() => undefined)
```

> 说明：同步更新 `test/assistant-generation.test.ts` 的 `fakeStore().conversations` 增加 `setActiveRequest: async () => undefined`（无操作），保持阶段一生成测试通过（fakeStore 无该方法时 `start` 会抛错）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-conversation-management.test.ts test/assistant-generation.test.ts; npm run build`
Expected: PASS；编译通过

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/schemas/assistant-conversation.schema.ts notes-backend/src/modules/assistant/assistant-conversations.service.ts notes-backend/src/modules/assistant/assistant-generation.service.ts notes-backend/src/modules/assistant/assistant.controller.ts notes-backend/test/assistant-conversation-management.test.ts notes-backend/test/assistant-generation.test.ts
git commit -m "feat(assistant): 会话重命名归档与软删除"
```

---

### Task 2: 消息搜索与命中定位

**Files:**
- Modify: `notes-backend/src/modules/assistant/schemas/assistant-message.schema.ts`（正文 text index）
- Modify: `notes-backend/src/modules/assistant/assistant-messages.service.ts`（`searchMessages`）
- Modify: `notes-backend/src/modules/assistant/assistant-conversations.service.ts`（`searchByTitle`）
- Modify: `notes-backend/src/modules/assistant/assistant.controller.ts`（`GET search`）
- Test: `notes-backend/test/assistant-search.test.ts`

**Interfaces:**
- Produces:
  - `AssistantMessagesService.searchMessages(userId, query, opts?: { limit?: number }): Promise<Array<{ conversationId: string; messageId: string; seq: number; role: 'user'|'assistant'; snippet: string; updatedAt: string }>>`（按 `userId` 约束 + `content` 正则包含匹配，转义 query；限制每个会话最多 3 条，总上限 20）。
  - `AssistantConversationsService.searchByTitle(userId, query): Promise<Array<{ id: string; title: string; updatedAt: string }>>`。
  - `GET /api/assistant/search?q=` → `{ conversations: [...], messages: [...] }`。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-search.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantMessagesService } from '../src/modules/assistant/assistant-messages.service'

class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  async find(filter: any) {
    return { sort: () => ({ limit: (n: number) => ({ lean: async () => this.docs.filter((d) => Object.entries(filter).every(([k, v]) => {
      if (typeof v === 'object' && v?.$regex) return new RegExp(v.$regex, 'i').test(String(d[k] || ''))
      if (typeof v === 'object' && v?.$in) return v.$in.some((x: any) => String(x) === String(d[k]))
      return String(d[k]) === String(v)
    })).slice(0, n) }) }) }
}

test('按用户与关键词命中消息并返回摘要', async () => {
  const model = new MemoryModel([
    { _id: 'm1', conversationId: 'c1', userId: 'u1', seq: 1, role: 'user', content: '蓝色海豚的项目结论是什么', updatedAt: '2026-09-01T00:00:00.000Z' },
    { _id: 'm2', conversationId: 'c2', userId: 'u2', seq: 1, role: 'user', content: '蓝色海豚', updatedAt: '2026-09-01T00:00:00.000Z' },
  ])
  const service = new AssistantMessagesService(model as any)
  const hits = await service.searchMessages('u1', '蓝色海豚')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].conversationId, 'c1')
  assert.ok(hits[0].snippet.includes('蓝色海豚'))
})

test('正则元字符被转义，不会误匹配', async () => {
  const model = new MemoryModel([{ _id: 'm1', conversationId: 'c1', userId: 'u1', seq: 1, role: 'user', content: 'a.b', updatedAt: '2026-09-01T00:00:00.000Z' }])
  const service = new AssistantMessagesService(model as any)
  const hits = await service.searchMessages('u1', 'a.b')
  assert.equal(hits.length, 1)
  const none = await service.searchMessages('u1', 'aXb')
  assert.equal(none.length, 0)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-search.test.ts`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 最小实现**

schema 追加：

```ts
AssistantMessageSchema.index({ content: 'text' }, { name: 'idx_assistant_msg_content_text' })
```

service 增加：

```ts
async searchMessages(userId: string, query: string, opts?: { limit?: number }) {
  const q = String(query || '').trim()
  if (!q) return []
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const limit = Math.min(20, opts?.limit ?? 20)
  const docs = await this.model.find({
    userId: new Types.ObjectId(userId),
    content: { $regex: escaped, $options: 'i' },
  }).sort({ createdAt: -1 }).limit(limit).lean().exec() as any[]
  // 同一会话最多保留 3 条命中，避免长会话刷屏。
  const perConversation = new Map<string, number>()
  const filtered: any[] = []
  for (const doc of docs) {
    const key = String(doc.conversationId)
    const used = perConversation.get(key) || 0
    if (used >= 3) continue
    perConversation.set(key, used + 1)
    filtered.push(doc)
  }
  return filtered.map((doc) => {
    const text = String(doc.content || '').replace(/\s+/g, ' ').trim()
    const index = text.indexOf(q)
    const start = Math.max(0, index - 20)
    return {
      conversationId: String(doc.conversationId), messageId: String(doc._id), seq: Number(doc.seq),
      role: doc.role, snippet: (start > 0 ? '…' : '') + text.slice(start, start + 80) + (text.length > start + 80 ? '…' : ''),
      updatedAt: String(doc.updatedAt || doc.createdAt || new Date().toISOString()),
    }
  })
}
```

`assistant-conversations.service.ts` 增加：

```ts
async searchByTitle(userId: string, query: string) {
  const q = String(query || '').trim()
  if (!q) return []
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const docs = await this.model.find({ userId: new Types.ObjectId(userId), status: { $ne: 'deleted' }, title: { $regex: escaped, $options: 'i' } })
    .sort({ updatedAt: -1 }).limit(20).lean().exec() as any[]
  return docs.map((doc) => ({ id: String(doc._id), title: String(doc.title || ''), updatedAt: String(doc.updatedAt || new Date().toISOString()) }))
}
```

controller 增加：

```ts
@Get('search')
async search(@Query('q') q: string, @Req() req?: AuthenticatedRequest) {
  const userId = this.userId(req)
  if (!userId) throw new BadRequestException('Authenticated user is required.')
  return {
    conversations: await this.conversations.searchByTitle(userId, String(q || '')),
    messages: await this.messages.searchMessages(userId, String(q || '')),
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-search.test.ts; npm run build`
Expected: PASS；编译通过

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/schemas/assistant-message.schema.ts notes-backend/src/modules/assistant/assistant-messages.service.ts notes-backend/src/modules/assistant/assistant-conversations.service.ts notes-backend/src/modules/assistant/assistant.controller.ts notes-backend/test/assistant-search.test.ts
git commit -m "feat(assistant): 会话与消息搜索"
```

---

### Task 3: 重试追溯（retryOfMessageId）

**Files:**
- Modify: `notes-backend/src/modules/assistant/assistant.controller.ts`（DTO 增加 `retryOfMessageId`）
- Modify: `notes-backend/src/modules/assistant/assistant-generation.service.ts`（占位消息带 `retryOfMessageId`，标题生成）
- Test: `notes-backend/test/assistant-retry.test.ts`

**Interfaces:**
- Consumes: `AssistantMessagesService.createPlaceholder`（阶段一已支持 `retryOfMessageId`）。
- Produces: `AssistantChatDto.retryOfMessageId?: string`；`AssistantGenerationService.start` 输入增加 `retryOfMessageId?`，占位消息写入该字段；生成完成后若会话 `messageCount === 1`（仅问题）则用问题前 24 字生成标题并 `rename`。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-retry.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantGenerationService } from '../src/modules/assistant/assistant-generation.service'

test('retry 占位消息携带 retryOfMessageId', async () => {
  const calls: any[] = []
  const store = {
    conversations: { ensure: async () => ({ id: 'c1', isNew: false }), touch: async () => undefined, rename: async (u: string, id: string, title: string) => { calls.push({ type: 'rename', title }) } },
    messages: {
      appendUser: async () => ({ messageId: 'um1', seq: 1 }),
      createPlaceholder: async (u: string, cid: string, route: string, requestId?: string, retryOf?: string) => { calls.push({ type: 'placeholder', retryOf }); return { messageId: 'am2', seq: 3 } },
      appendDelta: async () => undefined,
      finalize: async () => undefined,
      markCancelled: async () => undefined,
      markFailed: async () => undefined,
      list: async () => [],
      getByRequestId: async () => null,
    },
  }
  const service = new AssistantGenerationService(store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => ({ route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }) } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  await service.start({ userId: 'u1', conversationId: 'c1', requestId: 'req-2', question: '再问一次', forceRoute: 'rag', retryOfMessageId: 'am1' }, () => undefined)
  assert.equal(calls.some((c) => c.type === 'placeholder' && c.retryOf === 'am1'), true)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-retry.test.ts`
Expected: FAIL（start 未透传 retryOfMessageId）

- [ ] **Step 3: 最小实现**

`assistant-generation.service.ts`：`start` 输入类型增加 `retryOfMessageId?: string`；`createPlaceholder(userId, conversation.id, route, requestId, input.retryOfMessageId)`；`runGeneration` 成功后若 `conversation.messageCount`（来自 `touch` 前计数）很小且会话无标题（`title === '新对话'` 时）调用 `rename(userId, conversationId, question.slice(0, 24))`——具体为：在 `start` 中 `ensure` 返回 `isNew` 时，生成完成后用问题前缀重命名。

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-retry.test.ts test/assistant-generation.test.ts`
Expected: PASS（既有 generation 测试同步通过）

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant.controller.ts notes-backend/src/modules/assistant/assistant-generation.service.ts notes-backend/test/assistant-retry.test.ts
git commit -m "feat(assistant): 重试追溯与自动标题"
```

---

### Task 4: 分支会话（从历史消息续写）

**Files:**
- Modify: `notes-backend/src/modules/assistant/assistant-conversations.service.ts`（`branch`）
- Modify: `notes-backend/src/modules/assistant/assistant-messages.service.ts`（`copyPrefix`）
- Modify: `notes-backend/src/modules/assistant/assistant.controller.ts`（`POST conversations/:id/branch`）
- Test: `notes-backend/test/assistant-branch.test.ts`

**Interfaces:**
- Produces:
  - `AssistantMessagesService.copyPrefix(userId, sourceConversationId, throughSeq): Promise<Array<{ role; route; content; status; citations; warnings; createdAt }>>`（seq ≤ throughSeq 且 `status: 'completed'` 的消息副本——**分支只继承有效对话，失败/取消/未完成的回答（含 pending/streaming 占位）一律排除**，避免"幽灵气泡"或把失败伪装成成功；产品决策 2026-09-02 用户确认）。
  - `AssistantConversationsService.branch(userId, sourceId, throughSeq): Promise<{ id: string; parentConversationId: string; forkedFromSeq: number }>`：创建新会话（`status: 'active'`，标题 `原标题 · 分支`，`parentConversationId`/`forkedFromSeq`），复制前缀消息，`seq` 重排。
  - `POST /api/assistant/conversations/:id/branch` body `{ fromSeq: number }`。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-branch.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantConversationsService } from '../src/modules/assistant/assistant-conversations.service'
import { AssistantMessagesService } from '../src/modules/assistant/assistant-messages.service'

test('branch 复制前缀消息并记录来源', async () => {
  let created: any = null
  let copied: any = null
  const convModel = {
    docs: [{ _id: 'c1', userId: 'u1', title: 'P3 设计', status: 'active' }],
    async findOne(filter: any) { return this.docs.find((d: any) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) ?? null },
    async create(data: any) { const doc = { _id: 'c2', ...data }; this.docs.push(doc); created = doc; return doc },
  }
  const msgModel = {
    async find(filter: any) {
      return { sort: () => ({ lean: async () => ([
        { role: 'user', route: 'rag', content: 'q1', status: 'completed', citations: [], warnings: [], createdAt: '2026-09-01T00:00:00.000Z' },
        { role: 'assistant', route: 'rag', content: 'a1', status: 'completed', citations: [], warnings: [], createdAt: '2026-09-01T00:01:00.000Z' },
      ]) }) }
    },
    async create(data: any) { copied = data },
  }
  const conversations = new AssistantConversationsService(convModel as any)
  const messages = new AssistantMessagesService(msgModel as any)
  const result = await conversations.branch('u1', 'c1', 2, messages as any)
  assert.equal(result.parentConversationId, 'c1')
  assert.equal(result.forkedFromSeq, 2)
  assert.ok(created.title.includes('分支'))
  assert.ok(copied)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-branch.test.ts`
Expected: FAIL（`branch` 不存在）

- [ ] **Step 3: 最小实现**

`assistant-messages.service.ts`：

```ts
async copyPrefix(userId: string, sourceConversationId: string, throughSeq: number) {
  const docs = await this.model.find({
    userId: new Types.ObjectId(userId),
    conversationId: new Types.ObjectId(sourceConversationId),
    seq: { $lte: throughSeq },
    status: 'completed', // 只复制成功回答：失败/取消/未完成（pending/streaming）不进入分支会话
  }).sort({ seq: 1 }).lean().exec() as any[]
  return docs.map((doc) => ({
    role: doc.role, route: doc.route, content: String(doc.content || ''),
    status: 'completed' as const, citations: Array.isArray(doc.citations) ? doc.citations : [],
    warnings: Array.isArray(doc.warnings) ? doc.warnings : [], createdAt: doc.createdAt ? new Date(doc.createdAt) : new Date(),
  }))
}
```

`assistant-conversations.service.ts`：

```ts
async branch(userId: string, sourceId: string, throughSeq: number, messages: AssistantMessagesService) {
  const source = await this.model.findOne({ _id: new Types.ObjectId(sourceId), userId: new Types.ObjectId(userId) }).lean().exec() as any
  if (!source) throw new Error('conversation not found')
  const prefix = await messages.copyPrefix(userId, sourceId, throughSeq)
  const created = await this.model.create({
    userId: new Types.ObjectId(userId),
    title: `${String(source.title || '新对话')} · 分支`,
    status: 'active',
    defaultRoute: source.defaultRoute || 'auto',
    parentConversationId: source._id,
    forkedFromSeq: throughSeq,
  })
  for (const [index, message] of prefix.entries()) {
    await messages.appendBranchMessage(userId, String(created._id), index + 1, message)
  }
  return { id: String(created._id), parentConversationId: sourceId, forkedFromSeq: throughSeq }
}
```

`assistant-messages.service.ts` 补 `appendBranchMessage`（复用 create 逻辑，`seq` 由调用方指定）：

```ts
async appendBranchMessage(userId: string, conversationId: string, seq: number, message: { role: 'user' | 'assistant'; route: 'pet' | 'rag'; content: string; status: 'completed'; citations: RagCitation[]; warnings: string[]; createdAt: Date }) {
  await this.model.create({ userId: new Types.ObjectId(userId), conversationId: new Types.ObjectId(conversationId), seq, role: message.role, route: message.route, content: message.content, status: 'completed', citations: message.citations, warnings: message.warnings, createdAt: message.createdAt })
}
```

controller 增加：

```ts
@Post('conversations/:id/branch')
async branch(@Param('id') id: string, @Body('fromSeq') fromSeq: number, @Req() req?: AuthenticatedRequest) {
  const userId = this.userId(req) || ''
  const seq = Math.max(1, Number(fromSeq) || 0)
  return this.conversations.branch(userId, id, seq, this.messages)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-branch.test.ts; npm run build`
Expected: PASS；编译通过

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant-messages.service.ts notes-backend/src/modules/assistant/assistant-conversations.service.ts notes-backend/src/modules/assistant/assistant.controller.ts notes-backend/test/assistant-branch.test.ts
git commit -m "feat(assistant): 分支会话复制前缀消息"
```

---

### Task 5: Checkpoint 压缩（schema + 构建 + 触发）

**Files:**
- Create: `notes-backend/src/modules/assistant/schemas/assistant-checkpoint.schema.ts`
- Create: `notes-backend/src/modules/assistant/assistant-checkpoint.service.ts`
- Modify: `notes-backend/src/modules/assistant/assistant.module.ts`
- Modify: `notes-backend/src/modules/assistant/assistant-generation.service.ts`（完成后触发）
- Modify: `notes-backend/src/modules/assistant/assistant.controller.ts`（手动 `POST conversations/:id/checkpoint`）
- Modify: `notes-backend/src/modules/ai/ai-gateway.types.ts`（`AiTask` 增加 `'context_summary'`）
- Test: `notes-backend/test/assistant-checkpoint.test.ts`

**Interfaces:**
- Produces:
  - `AssistantContextCheckpoint` schema：`{ conversationId, userId, throughSeq, summary, decisions: string[], openQuestions: string[], referencedEntities: string[], sourceMessageIds: string[], createdAt }`，`(conversationId, throughSeq)` 唯一。
  - `AssistantCheckpointService.getLatest(userId, conversationId): Promise<AssistantCheckpointView | null>`。
  - `AssistantCheckpointService.build(userId, conversationId): Promise<AssistantCheckpointView>`（取 `throughSeq` 之后到当前的消息原文，调用 `gateway.chatTask({ task: 'context_summary', responseFormat: json_object })` 解析 `{ summary, decisions, openQuestions, referencedEntities }`；失败抛错由调用方降级）。
  - `AssistantCheckpointService.schedule(userId, conversationId, throughSeq)`：满足触发条件（距上一 checkpoint ≥ 10 条消息）时 fire-and-forget `build`，失败只记日志，不阻塞聊天。
  - `AssistantGenerationService` 在 `finalize` 后调用 `checkpoint.schedule(userId, conversationId, seq)`。
  - `POST /api/assistant/conversations/:id/checkpoint`：手动整理，返回最新 checkpoint。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-checkpoint.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantCheckpointService } from '../src/modules/assistant/assistant-checkpoint.service'

class MemoryModel {
  docs: any[] = []
  async findOne(filter: any) { return this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) ?? null }
  async findOneAndUpdate(_filter: any, update: any, _opts: any) {
    const existing = this.docs.find((d) => d.conversationId === update.$set.conversationId)
    if (existing) Object.assign(existing, update.$set)
    else this.docs.push({ _id: 'cp1', ...update.$set })
    return this.docs[this.docs.length - 1]
  }
}

test('build 解析模型 JSON 并写入最新 checkpoint', async () => {
  const model = new MemoryModel()
  const gateway = { chatTask: async () => ({ content: JSON.stringify({ summary: '讨论了界面方案', decisions: ['保留浮层'], openQuestions: ['是否扩大'], referencedEntities: ['小助手'] }) }) }
  const messages = {
    list: async () => [
      { id: 'm1', seq: 1, role: 'user', route: 'rag', content: '浮层够用吗', status: 'completed', citations: [], warnings: [], createdAt: '' },
      { id: 'm2', seq: 2, role: 'assistant', route: 'rag', content: '建议新增全屏', status: 'completed', citations: [], warnings: [], createdAt: '' },
    ],
  }
  const service = new AssistantCheckpointService(model as any, gateway as any, messages as any)
  const result = await service.build('u1', 'c1')
  assert.equal(result.summary, '讨论了界面方案')
  assert.deepEqual(result.decisions, ['保留浮层'])
  assert.equal(result.throughSeq, 2)
  assert.deepEqual(result.sourceMessageIds, ['m1', 'm2'])
})

test('getLatest 返回该会话最新 checkpoint', async () => {
  const model = new MemoryModel()
  model.docs.push({ conversationId: 'c1', userId: 'u1', throughSeq: 10, summary: 's', decisions: [], openQuestions: [], referencedEntities: [], sourceMessageIds: [] })
  const service = new AssistantCheckpointService(model as any, {} as any, {} as any)
  const latest = await service.getLatest('u1', 'c1')
  assert.equal(latest?.throughSeq, 10)
  assert.equal(await service.getLatest('u2', 'c1'), null)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-checkpoint.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/assistant/schemas/assistant-checkpoint.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type AssistantCheckpointDocument = AssistantContextCheckpoint & Document

@Schema({ collection: 'assistant_context_checkpoints', timestamps: true })
export class AssistantContextCheckpoint {
  @Prop({ required: true, type: Types.ObjectId, ref: 'AssistantConversation', index: true })
  conversationId: Types.ObjectId

  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId

  @Prop({ required: true })
  throughSeq: number

  @Prop({ required: true, default: '' })
  summary: string

  @Prop({ type: [String], default: [] })
  decisions: string[]

  @Prop({ type: [String], default: [] })
  openQuestions: string[]

  @Prop({ type: [String], default: [] })
  referencedEntities: string[]

  @Prop({ type: [Types.ObjectId], default: [] })
  sourceMessageIds: Types.ObjectId[]
}

export const AssistantCheckpointSchema = SchemaFactory.createForClass(AssistantContextCheckpoint)
AssistantCheckpointSchema.index({ conversationId: 1, throughSeq: 1 }, { name: 'idx_assistant_cp_conv_seq', unique: true })
```

```ts
// notes-backend/src/modules/assistant/assistant-checkpoint.service.ts
import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { AiGatewayClient } from '../ai/ai-gateway.client'
import { AssistantMessagesService } from './assistant-messages.service'
import { AssistantContextCheckpoint, AssistantCheckpointDocument } from './schemas/assistant-checkpoint.schema'

export type AssistantCheckpointView = {
  conversationId: string; throughSeq: number; summary: string; decisions: string[]; openQuestions: string[]; referencedEntities: string[]; sourceMessageIds: string[]; createdAt: string
}

@Injectable()
export class AssistantCheckpointService {
  private readonly logger = new Logger(AssistantCheckpointService.name)
  constructor(
    @InjectModel(AssistantContextCheckpoint.name) private readonly model: Model<AssistantCheckpointDocument>,
    private readonly gateway: AiGatewayClient,
    private readonly messages: AssistantMessagesService,
  ) {}

  async getLatest(userId: string, conversationId: string): Promise<AssistantCheckpointView | null> {
    const doc = await this.model.findOne({ userId: new Types.ObjectId(userId), conversationId: new Types.ObjectId(conversationId) })
      .sort({ throughSeq: -1 }).lean().exec()
    if (!doc) return null
    return this.toView(doc)
  }

  async build(userId: string, conversationId: string): Promise<AssistantCheckpointView> {
    const latest = await this.getLatest(userId, conversationId)
    const afterSeq = latest?.throughSeq ?? 0
    const recent = await this.messages.list(userId, conversationId, { afterSeq })
    if (recent.length === 0) {
      // 没有新消息时保留现有 checkpoint；不存在则返回空摘要，避免无谓的模型调用。
      return latest ?? { conversationId, throughSeq: 0, summary: '', decisions: [], openQuestions: [], referencedEntities: [], sourceMessageIds: [], createdAt: new Date().toISOString() }
    }
    const transcript = recent.map((m) => `${m.role}: ${m.content}`).join('\n')
    const result = await this.gateway.chatTask({
      task: 'context_summary', responseFormat: { type: 'json_object' }, maxTokens: 512, temperature: 0,
      system: 'Summarize a conversation for continuity. Return JSON only: {"summary":"...","decisions":["..."],"openQuestions":["..."],"referencedEntities":["..."]}. Only state what was explicitly agreed; do not invent facts.',
      prompt: transcript.slice(0, 12000),
    })
    const value = JSON.parse(result.content)
    const throughSeq = recent[recent.length - 1].seq
    const doc = await this.model.findOneAndUpdate(
      { conversationId: new Types.ObjectId(conversationId), userId: new Types.ObjectId(userId) },
      {
        $set: {
          conversationId: new Types.ObjectId(conversationId), userId: new Types.ObjectId(userId), throughSeq,
          summary: String(value?.summary || '').trim(),
          decisions: Array.isArray(value?.decisions) ? value.decisions.map(String).slice(0, 20) : [],
          openQuestions: Array.isArray(value?.openQuestions) ? value.openQuestions.map(String).slice(0, 20) : [],
          referencedEntities: Array.isArray(value?.referencedEntities) ? value.referencedEntities.map(String).slice(0, 20) : [],
          sourceMessageIds: recent.map((m) => new Types.ObjectId(m.id)),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().exec()
    return this.toView(doc)
  }

  async schedule(userId: string, conversationId: string, latestSeq: number) {
    const latest = await this.getLatest(userId, conversationId)
    // 距上一 checkpoint 至少 10 条新消息才压缩，避免频繁模型调用。
    if (latest && latestSeq - latest.throughSeq < 10) return
    void this.build(userId, conversationId).catch((error) => this.logger.warn(`checkpoint build failed: ${error?.message}`))
  }

  private toView(doc: any): AssistantCheckpointView {
    return {
      conversationId: String(doc.conversationId), throughSeq: Number(doc.throughSeq),
      summary: String(doc.summary || ''), decisions: Array.isArray(doc.decisions) ? doc.decisions.map(String) : [],
      openQuestions: Array.isArray(doc.openQuestions) ? doc.openQuestions.map(String) : [],
      referencedEntities: Array.isArray(doc.referencedEntities) ? doc.referencedEntities.map(String) : [],
      sourceMessageIds: Array.isArray(doc.sourceMessageIds) ? doc.sourceMessageIds.map(String) : [],
      createdAt: String(doc.createdAt || new Date().toISOString()),
    }
  }
}
```

`assistant.module.ts`：`MongooseModule.forFeature` 增加 checkpoint schema；`providers` 增加 `AssistantCheckpointService`（**注意：`AssistantContextService` 由 Task 6 创建文件后在 Task 6 再注册，Task 5 注册它会因文件不存在导致编译失败**）。
`ai-gateway.types.ts`：`AiTask` union 增加 `| 'context_summary'`。
`assistant-generation.service.ts`：构造器末尾追加 `@Optional() private readonly checkpoints?: AssistantCheckpointService`（TS 可选参数，阶段一的 5 参构造测试无需改动），`finalize` 后调用 `checkpoint.schedule(userId, conversationId, assistantSeq)`（try/catch）。
controller：`POST conversations/:id/checkpoint` → `return this.checkpoints.build(userId, id)`（controller 构造器追加 `AssistantCheckpointService`，并同步更新既有 `assistant-controller.test.ts` 构造调用，追加 `{} as any` 占位）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-checkpoint.test.ts test/assistant-generation.test.ts; npm run build`
Expected: PASS；编译通过

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/schemas/assistant-checkpoint.schema.ts notes-backend/src/modules/assistant/assistant-checkpoint.service.ts notes-backend/src/modules/assistant/assistant.module.ts notes-backend/src/modules/assistant/assistant-generation.service.ts notes-backend/src/modules/assistant/assistant.controller.ts notes-backend/src/modules/ai/ai-gateway.types.ts notes-backend/test/assistant-checkpoint.test.ts
git commit -m "feat(assistant): 会话 checkpoint 异步压缩"
```

---

### Task 6: 上下文组装（Token 预算 + 分区标签）

**Files:**
- Create: `notes-backend/src/modules/assistant/assistant.constants.ts`
- Create: `notes-backend/src/modules/assistant/assistant-context.service.ts`
- Modify: `notes-backend/src/modules/assistant/assistant-generation.service.ts`（pet 分支接入）
- Test: `notes-backend/test/assistant-context-assembly.test.ts`

**Interfaces:**
- Consumes: `AssistantMessagesService.list`、`AssistantCheckpointService.getLatest`、`MEMORY_RECALL_SERVICE` 可选注入（阶段四实现，此处只提供 symbol 与接口）。
- Produces: `assistant.constants.ts`：

```ts
export const MEMORY_RECALL_SERVICE = Symbol('MEMORY_RECALL_SERVICE')

export interface MemoryRecallServiceLike {
  recall(userId: string, question: string, opts?: { conversationId?: string; knowledgeBaseId?: string; noteId?: string; limit?: number }): Promise<Array<{ label: string; text: string }>>
}
```

- 以下接口沿用（见本计划开头契约）：
  - `AssistantContextService.assemble(input: { userId; conversationId; question; memoryRecall? })`
  - 分区顺序固定：`[会话摘要]`（checkpoint summary + decisions/openQuestions 精简）→ `[近期对话]`（checkpoint 之后最近 12 条）→ `[历史对话召回]`（question 分词命中旧消息，最多 4 条，从 `afterSeq` 之前检索）→ `[已确认认知]`（`memoryRecall` 提供，缺省为空）。
  - 每节带 `label` 与 `content`；`[已确认认知]` 为空时整节省略。
  - 预算常量：摘要节 ≤ 800 字、近期对话 ≤ 3000 字、历史召回 ≤ 1200 字、认知 ≤ 800 字。
  - `buildPrompt(question, sections)`：把分区拼成模型 prompt（供 pet 与阶段四 rag 复用）。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-context-assembly.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantContextService } from '../src/modules/assistant/assistant-context.service'

test('按固定顺序组装分区并省略空认知节', async () => {
  const messages = {
    list: async (_u: string, _c: string, opts?: any) => opts?.afterSeq === 8
      ? [
          { id: 'm9', seq: 9, role: 'user', route: 'rag', content: '继续', status: 'completed', citations: [], warnings: [], createdAt: '' },
          { id: 'm10', seq: 10, role: 'assistant', route: 'rag', content: '好的', status: 'completed', citations: [], warnings: [], createdAt: '' },
        ]
      : [
          { id: 'm2', seq: 2, role: 'assistant', route: 'rag', content: '结论：保留浮层', status: 'completed', citations: [], warnings: [], createdAt: '' },
        ],
  }
  const checkpoints = {
    getLatest: async () => ({ throughSeq: 8, summary: '讨论界面形态', decisions: ['保留浮层'], openQuestions: ['全屏尺寸'], referencedEntities: ['小助手'], sourceMessageIds: [], createdAt: '' }),
  }
  const service = new AssistantContextService(messages as any, checkpoints as any)
  const result = await service.assemble({ userId: 'u1', conversationId: 'c1', question: '全屏尺寸多少合适' })
  const labels = result.sections.map((s) => s.label)
  assert.deepEqual(labels, ['会话摘要', '近期对话', '历史对话召回'])
  const summary = result.sections[0]
  assert.ok(summary.content.includes('讨论界面形态'))
  assert.ok(summary.content.includes('保留浮层'))
  assert.equal(result.recentMessages.length, 2)
})

test('提供认知召回时加入已确认认知分区', async () => {
  const service = new AssistantContextService(
    { list: async () => [] } as any,
    { getLatest: async () => null } as any,
  )
  const result = await service.assemble({
    userId: 'u1', conversationId: 'c1', question: '界面怎么改',
    memoryRecall: { recall: async () => [{ label: '已确认决策', text: '保留现有浮层，新增全屏工作台' }] } as any,
  })
  const labels = result.sections.map((s) => s.label)
  assert.ok(labels.includes('已确认认知'))
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-context-assembly.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/assistant/assistant-context.service.ts
import { Inject, Injectable, Optional } from '@nestjs/common'
import { AssistantMessagesService } from './assistant-messages.service'
import { AssistantCheckpointService } from './assistant-checkpoint.service'
import { MEMORY_RECALL_SERVICE, MemoryRecallServiceLike } from './assistant.constants'

const BUDGETS = { summary: 800, recent: 3000, recall: 1200, memory: 800 }

@Injectable()
export class AssistantContextService {
  constructor(
    private readonly messages: AssistantMessagesService,
    private readonly checkpoints: AssistantCheckpointService,
    @Optional() @Inject(MEMORY_RECALL_SERVICE) private readonly memoryRecall?: MemoryRecallServiceLike,
  ) {}

  async assemble(input: { userId: string; conversationId: string; question: string; memoryRecall?: MemoryRecallServiceLike }) {
    const recall = input.memoryRecall ?? this.memoryRecall
    const checkpoint = await this.checkpoints.getLatest(input.userId, input.conversationId)
    const throughSeq = checkpoint?.throughSeq ?? 0

    const recent = await this.messages.list(input.userId, input.conversationId, { afterSeq: throughSeq })
    const recentMessages = recent.slice(-12).map((m) => ({ seq: m.seq, role: m.role, content: m.content }))

    const sections: Array<{ label: string; content: string }> = []
    if (checkpoint) {
      const decisions = checkpoint.decisions.length ? `决定：${checkpoint.decisions.join('；')}` : ''
      const open = checkpoint.openQuestions.length ? `待解决：${checkpoint.openQuestions.join('；')}` : ''
      sections.push({ label: '会话摘要', content: [checkpoint.summary, decisions, open].filter(Boolean).join('\n').slice(0, BUDGETS.summary) })
    }
    const recentText = recentMessages.map((m) => `${m.role}: ${m.content}`).join('\n').slice(0, BUDGETS.recent)
    if (recentText) sections.push({ label: '近期对话', content: recentText })

    // 历史召回：checkpoint 之前的消息里按问题关键词命中，最多 4 条。
    const hits = await this.recallHistorical(input.userId, input.conversationId, input.question, throughSeq)
    if (hits.length > 0) sections.push({ label: '历史对话召回', content: hits.join('\n').slice(0, BUDGETS.recall) })

    if (recall) {
      const memories = await recall.recall(input.userId, input.question, { conversationId: input.conversationId })
      if (memories.length > 0) {
        sections.push({ label: '已确认认知', content: memories.map((m) => `[M] ${m.label}：${m.text}`).join('\n').slice(0, BUDGETS.memory) })
      }
    }
    return { sections, recentMessages }
  }

  buildPrompt(question: string, sections: Array<{ label: string; content: string }>) {
    return [question, '', ...sections.map((s) => `[${s.label}]\n${s.content}`)].join('\n\n')
  }

  private async recallHistorical(userId: string, conversationId: string, question: string, throughSeq: number) {
    const tokens = question.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2).slice(0, 3)
    if (tokens.length === 0) return []
    const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const all = await this.messages.list(userId, conversationId, {})
    return all
      .filter((m) => m.seq <= throughSeq && new RegExp(pattern, 'i').test(m.content))
      .slice(-4)
      .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
  }
}
```

> 说明：`MEMORY_RECALL_SERVICE` 在 `assistant.constants.ts` 声明；阶段三不注册 provider，注入为 undefined，阶段四注册 `MemoryRecallService` 实现。`assistant-generation.service.ts` pet 分支：

```ts
const context = await this.context.assemble({ userId, conversationId: input.conversationId, question: input.question })
const prompt = this.context.buildPrompt(input.question, context.sections)
const stream = await this.aiService.chatPet({ message: prompt }, { userId })
```

（`AssistantContextService` 以构造器末尾 `@Optional() private readonly context?: AssistantContextService` 注入，TS 可选参数保证阶段一的 5 参构造测试无需改动；阶段三未注册 provider 时注入为 undefined。）

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-context-assembly.test.ts test/assistant-generation.test.ts; npm run build`
Expected: PASS；编译通过

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant.constants.ts notes-backend/src/modules/assistant/assistant-context.service.ts notes-backend/src/modules/assistant/assistant-generation.service.ts notes-backend/src/modules/assistant/assistant.module.ts notes-backend/test/assistant-context-assembly.test.ts
git commit -m "feat(assistant): 分区上下文组装与预算控制"
```

---

### Task 7: JSONL 导出

**Files:**
- Modify: `notes-backend/src/modules/assistant/assistant-messages.service.ts`（`listAll`）
- Modify: `notes-backend/src/modules/assistant/assistant.controller.ts`（`GET conversations/:id/export`）
- Test: `notes-backend/test/assistant-export.test.ts`

**Interfaces:**
- Produces: `GET /api/assistant/conversations/:id/export` → `Content-Type: application/x-ndjson`，逐行输出：
  - `{"type":"conversation","id":"...","title":"...","createdAt":"..."}`
  - `{"type":"message","seq":1,"role":"user","route":"rag","content":"...","status":"completed","createdAt":"..."}`
  - `{"type":"citation","messageSeq":2,"evidenceId":"E1","noteId":"...","chunkId":"..."}`
- 导出只允许本人访问；输出前校验会话归属。

- [ ] **Step 1: 写失败测试（纯序列化函数）**

```ts
// notes-backend/test/assistant-export.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { buildExportLines } from '../src/modules/assistant/assistant-export'

test('导出按会话、消息、引用顺序生成 JSONL 行', () => {
  const lines = buildExportLines(
    { id: 'c1', title: 'P3 设计', createdAt: '2026-09-01T00:00:00.000Z' },
    [
      { seq: 1, role: 'user', route: 'rag', content: '结论？', status: 'completed', citations: [], createdAt: '2026-09-01T00:00:00.000Z' },
      { seq: 2, role: 'assistant', route: 'rag', content: '统一入口 [E1]', status: 'completed', citations: [{ evidenceId: 'E1', noteId: 'n1', noteTitle: 't', chunkId: 'c1', headingPath: [], excerpt: 'x' }], createdAt: '2026-09-01T00:01:00.000Z' },
    ],
  )
  assert.equal(lines.length, 4)
  assert.ok(lines[0].startsWith('{"type":"conversation"'))
  assert.ok(lines[1].startsWith('{"type":"message"'))
  assert.ok(lines[2].startsWith('{"type":"message"'))
  assert.ok(lines[3].startsWith('{"type":"citation"'))
  assert.ok(lines[3].includes('"messageSeq":2'))
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-export.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/assistant/assistant-export.ts
import { RagCitation } from '../ai/rag/rag.types'

export function buildExportLines(conversation: { id: string; title: string; createdAt: string }, messages: Array<{ seq: number; role: string; route: string; content: string; status: string; citations: RagCitation[]; createdAt: string }>): string[] {
  const lines: string[] = []
  lines.push(JSON.stringify({ type: 'conversation', id: conversation.id, title: conversation.title, createdAt: conversation.createdAt }))
  for (const message of messages) {
    lines.push(JSON.stringify({ type: 'message', seq: message.seq, role: message.role, route: message.route, content: message.content, status: message.status, createdAt: message.createdAt }))
    for (const citation of message.citations) {
      lines.push(JSON.stringify({ type: 'citation', messageSeq: message.seq, evidenceId: citation.evidenceId, noteId: citation.noteId, chunkId: citation.chunkId, headingPath: citation.headingPath }))
    }
  }
  return lines
}
```

`assistant-messages.service.ts` 增加 `listAll(userId, conversationId)`（复用 `list` 无 limit 限制，上限 5000）。controller：

> 说明：阶段一 `get(userId, id)` 返回 `{ id, title, status }`，本任务把返回扩展为 `{ id, title, status, updatedAt }`（实现只改 lean 选择，不回退既有调用）。

```ts
@Get('conversations/:id/export')
async exportConversation(@Param('id') id: string, @Res() res: Response, @Req() req?: AuthenticatedRequest) {
  const userId = this.userId(req)
  if (!userId) throw new BadRequestException('Authenticated user is required.')
  const conversation = await this.conversations.get(userId, id)
  if (!conversation) throw new NotFoundException('会话不存在')
  const messages = await this.messages.listAll(userId, id)
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="assistant-${id}.jsonl"`)
  res.write(buildExportLines({ id, title: conversation.title, createdAt: conversation.updatedAt }, messages).join('\n'))
  res.end()
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-export.test.ts; npm run build`
Expected: PASS；编译通过

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant-export.ts notes-backend/src/modules/assistant/assistant-messages.service.ts notes-backend/src/modules/assistant/assistant.controller.ts notes-backend/test/assistant-export.test.ts
git commit -m "feat(assistant): JSONL 会话导出"
```

---

### Task 8: 前端会话管理 UI（重命名 / 归档 / 删除 / 搜索）【延后至计划 3 组件就绪后执行】

> **执行顺序决策（2026-09-02 用户确认）**：Task 8 引用的 `ConversationList`/`AssistantWorkspace` 组件由计划 3（全屏工作台）创建，本 Task 依赖计划 3 组件。决定：计划 2 先执行 Task 1-7 + Task 9（纯后端），Task 8 延后到计划 3 组件就绪后合并执行（届时按本 Task 规格在 `ConversationList`/`AssistantWorkspace` 上补齐管理交互）。

**Files:**
- Modify: `notes-frontend/src/lib/assistant-api.ts`（管理 API）
- Modify: `notes-frontend/src/components/assistant/ConversationList.tsx`（搜索 + 操作菜单）
- Modify: `notes-frontend/src/components/assistant/AssistantWorkspace.tsx`（搜索框、重试按钮、操作回调）
- Test: `notes-frontend/__tests__/conversation-list.spec.tsx`（扩展）、`notes-frontend/__tests__/assistant-api.spec.ts`

**Interfaces:**
- Produces（`assistant-api.ts`）：
  - `renameConversation(id, title): Promise<void>`（PATCH）
  - `setConversationStatus(id, status: 'archive' | 'unarchive' | 'delete'): Promise<void>`
  - `searchAssistant(query): Promise<{ conversations: Array<{ id; title; updatedAt }>; messages: Array<{ conversationId; messageId; seq; role; snippet; updatedAt }> }>`
  - `branchConversation(id, fromSeq): Promise<{ id: string }>`
  - `exportConversation(id): Promise<void>`（触发浏览器下载）
- `ConversationList` 增加 props：`onRename(id, title)`、`onArchive(id)`、`onDelete(id)`、`searchQuery`/`onSearchChange`、`searchResults`；操作通过每项右侧菜单按钮（重命名/归档/删除）触发，aria-label 明确（如 `重命名 会话标题`）。
- `AssistantWorkspace`：顶栏搜索框输入防抖 300ms 调 `searchAssistant`，结果点击跳转 `?conversation=<id>` 并 `afterSeq` 定位到命中消息 seq；失败回答显示"重新回答"按钮（以 `retryOfMessageId` 重发）。

- [ ] **Step 1: 写失败测试**

```ts
// notes-frontend/__tests__/assistant-api.spec.ts
import { renameConversation, setConversationStatus, searchAssistant } from '@/lib/assistant-api'

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

test('searchAssistant 解包 items', async () => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ data: { conversations: [{ id: 'c1', title: 'P3', updatedAt: '' }], messages: [] } }), { status: 200 })) as any
  const result = await searchAssistant('P3')
  expect(result.conversations[0].id).toBe('c1')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/assistant-api.spec.ts`
Expected: FAIL（函数不存在）

- [ ] **Step 3: 最小实现**

`assistant-api.ts` 增加：

```ts
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

export type AssistantSearchResult = {
  conversations: Array<{ id: string; title: string; updatedAt: string }>;
  messages: Array<{ conversationId: string; messageId: string; seq: number; role: string; snippet: string; updatedAt: string }>;
};

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
  anchor.download = `assistant-${id}.jsonl`;
  anchor.click();
  URL.revokeObjectURL(url);
}
```

`ConversationList.tsx` 增加搜索输入（顶部）与每项操作菜单；`AssistantWorkspace.tsx` 接线（搜索防抖、命中跳转、重试按钮、删除后刷新列表、归档后从列表移除）。

- [ ] **Step 4: 运行确认通过**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/assistant-api.spec.ts __tests__/conversation-list.spec.tsx __tests__/assistant-workspace.spec.tsx; npm run type-check`
Expected: PASS；TypeScript 通过

- [ ] **Step 5: 提交**

```bash
git add notes-frontend/src/lib/assistant-api.ts notes-frontend/src/components/assistant/ConversationList.tsx notes-frontend/src/components/assistant/AssistantWorkspace.tsx notes-frontend/__tests__/assistant-api.spec.ts notes-frontend/__tests__/conversation-list.spec.tsx
git commit -m "feat(assistant): 前端会话管理与搜索交互"
```

---

### Task 9: 阶段三全量验证

**Files:**
- 无新增

- [ ] **Step 1: 后端全量单测与编译**

Run: `npm run test:unit; npm run build`
Expected: 全部通过

- [ ] **Step 2: 前端全量测试与类型检查**

Run: `npm run ci:test; npm run type-check; npm run build`
Expected: 全部通过

- [ ] **Step 3: 浏览器冒烟**

- 全屏工作台：新建两个会话，各发一条消息；在会话列表重命名、归档、取消归档、删除（删除后从列表消失且停止运行中生成）。
- 搜索：输入唯一关键词，确认标题命中与消息命中出现在结果中，点击跳转到对应会话并定位到消息 seq。
- 重试：强制失败场景（可临时断网模拟）后点"重新回答"，确认新回答出现且原失败消息保留。
- 分支：从某条消息"从这里继续"，确认新会话包含前缀消息且标题带"分支"。
- 导出：点击导出，确认下载 `assistant-<id>.jsonl`，内容含 conversation/message/citation 行。
- 长会话：连续发送 20+ 条消息，确认 checkpoint 自动生成（`assistant_context_checkpoints` 集合出现记录），`[会话摘要]` 在后续 pet 回答中生效（可从后端日志或新会话上下文观察）。
- 控制台与后端日志无异常。

- [ ] **Step 4: 提交收尾（如无代码变更则跳过）**

```bash
git status --short
git log --oneline -10
```

---

## Self-Review 记录

- 规格覆盖：重命名/归档/删除（Task 1）、停止运行中生成（Task 1 delete + Task 3 activeRequestId）、搜索标题与正文并定位消息（Task 2 + Task 8 跳转）、游标分页（阶段一 `afterSeq` 沿用，Task 8 用于定位）、Checkpoint 触发条件与内容边界（Task 5）、分区上下文与预算（Task 6）、`[已确认认知]` 接口预留（Task 6 `MemoryRecallServiceLike`，阶段四注册）、编辑=分支语义与重试追溯（Task 3/4）、软删除与恢复（Task 1）、JSONL 导出（Task 7）。语义搜索（message embedding）按规格明确为后续演进，不在第一阶段。
- 占位符扫描：无 TBD/TODO；所有代码步骤均给出可运行测试与实现。
- 类型一致性：`AssistantMessageView` 沿用阶段一；`ConversationListItem` 与后端 `list()` 一致；`MemoryRecallServiceLike.recall` 返回 `{ label, text }` 与阶段四 `MemoryRecallService` 输出契约一致（阶段四 Task 将按此签名实现）；`retryOfMessageId` 在阶段一 schema、阶段三 DTO/start 输入/占位消息中命名一致；checkpoint 视图字段与 schema 一致。
