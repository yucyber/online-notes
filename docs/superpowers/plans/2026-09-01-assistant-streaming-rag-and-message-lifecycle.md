# 阶段一：结构化流式 RAG 与统一消息生命周期 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 RAG 回答从一次性 JSON 改为结构化 SSE 流式输出，并把普通聊天迁移到同一事件协议；引入服务端会话/消息生命周期（pending → streaming → completed/failed/cancelled），支持幂等、取消、断线后继续生成与重新打开恢复。

**Architecture:** 后端新增 `assistant` 模块，负责会话与消息存储、SSE 事件序列化和生成编排；AI 模块新增 `RagStreamService` 复用现有 QueryPlanner/RagRetrieval，用 `AiGatewayClient.streamTask` 流式生成，并通过共享纯函数做引用标记清洗。前端新增统一流式客户端，`ChatWindow` 从 localStorage 迁移到服务端消息，本地只保存"当前会话 ID"。

**Tech Stack:** NestJS 10 + Mongoose 8 + MongoDB + Redis（ioredis）+ SSE（text/event-stream）+ Next.js 16 App Router + React 18 + Jest/jsdom 前端测试 + node:test 后端测试。

## Global Constraints

- 现有 `POST /api/ai/rag/answer` 与 `POST /api/ai/pet` 保留不动（仍由旧测试覆盖），前端迁移后不再调用；旧前端一次性客户端 `getRagAnswer` 删除。
- RAG 继续执行 NoteAccess、knowledgeBase、Chunk 可见性、引用清洗与 warning 规则，不得因流式化绕过任何 ACL。
- 普通聊天（pet）不得读取 Chunk 或伪造笔记引用。
- 服务端对 `(userId, requestId)` 幂等：同一请求重放不得生成两份回答。
- 正文增量按时间/字符批量写 MongoDB（每 500ms 或新增 200 字符一次），不得为每个 token 单独写库；完成/失败/取消时强制写最终状态。
- 客户端只展示稳定错误文案，不暴露 provider、模型密钥或内部堆栈。
- 所有会话/消息查询必须同时约束 `userId`。
- 前端测试命令：`npm exec jest -- --runInBand --coverage=false __tests__/<file>`；前端类型检查：`npm run type-check`。
- 后端单测命令：`npm run test:file -- test/<file>.test.ts` 不存在时用 `node --test -r ts-node/register -r tsconfig-paths/register test/<file>.test.ts`；全量：`npm run test:unit`。
- 提交信息用中文，格式 `类型(范围): 简述`；中文 commit 用 `git commit -F <utf8文件>`。
- 不修改用户未跟踪文件 `codex配置ar.md`。

## File Structure

后端（新增 `notes-backend/src/modules/assistant/`）：

- `schemas/assistant-conversation.schema.ts`：会话 schema + `(userId, updatedAt)` 索引。
- `schemas/assistant-message.schema.ts`：消息 schema + `(conversationId, seq)` 唯一索引 + `(userId, requestId)` 部分唯一索引。
- `assistant-stream-format.ts`：纯函数，把 `AssistantStreamEvent` 序列化为 SSE 行（可单测）。
- `assistant-conversations.service.ts`：`ensure` / `get` / `touch`。
- `assistant-messages.service.ts`：`appendUser` / `createPlaceholder` / `appendDelta` / `finalize` / `markCancelled` / `markFailed` / `list` / `getByRequestId`。
- `assistant-generation.service.ts`：生成编排（幂等、取消、断线续跑、事件订阅）。
- `assistant.controller.ts`：`POST /assistant/chat`（SSE）、`POST /assistant/generations/:requestId/cancel`、`GET /assistant/conversations/:id/messages`。
- `assistant.module.ts`：注册 schema 与 provider，导入 RedisModule、forwardRef(AiModule)。

后端 AI 模块修改（`notes-backend/src/modules/ai/`）：

- 新增 `rag/rag-citation-sanitize.ts`：共享纯函数 `createRagCitationSanitizer(allowed)`，流式剔除无效 `[E\d+]` 标记并收集有效引用。
- 新增 `rag/rag-stream.service.ts`：`streamRagAnswer(...)`，复用 planner/retrieval/gateway。
- `rag-answer.service.ts`：改为复用 `rag-citation-sanitize.ts` 的同步版，删除内部私有 `sanitizeCitations`（行为不变，现有测试必须保持通过）。
- `ai.module.ts`：导出 `RagStreamService`。

前端（`notes-frontend/`）：

- 新增 `src/lib/assistant-stream-client.ts`：`streamAssistantReply()` + 事件类型 + SSE 解析。
- 新增 `src/app/api/assistant/[...path]/route.ts`：`/api/assistant/*` → 后端 `/api/assistant/*` 的通用代理（GET/POST/PATCH/DELETE、SSE/JSONL 透传、JSON 解包信封；现有 `_proxy.ts` 只覆盖 `/api/ai/*`）。
- 修改 `src/components/ai/ChatWindow.tsx`：pet/rag 都走新客户端，消息来自服务端，支持停止与重试。
- 新增 `__tests__/assistant-stream-client.spec.ts`。
- 修改 `__tests__/ai-chat-window.spec.tsx`、`__tests__/rag-chat-answer.spec.tsx` 以匹配新行为。
- 删除 `src/lib/ai-client.ts` 中 `getRagAnswer` 与 `RagAnswer` 相关导出（`RagCitation` 迁移到 `assistant-stream-client.ts`）。

---

### Task 1: 会话与消息 Schema（含唯一索引）

**Files:**
- Create: `notes-backend/src/modules/assistant/schemas/assistant-conversation.schema.ts`
- Create: `notes-backend/src/modules/assistant/schemas/assistant-message.schema.ts`
- Test: `notes-backend/test/assistant-schema.test.ts`

**Interfaces:**
- Produces: `AssistantConversation`（`_id`, `userId: Types.ObjectId`, `title: string`, `status: 'active'|'archived'|'deleted'`, `defaultRoute: 'auto'|'pet'|'rag'`, `knowledgeBaseId?: Types.ObjectId`, `lastMessageAt?: Date`, `messageCount: number`, `createdAt`, `updatedAt`, `deletedAt?`）、`AssistantMessageStatus = 'pending'|'streaming'|'completed'|'failed'|'cancelled'`、`AssistantMessage`（`_id`, `conversationId`, `userId`, `seq`, `role: 'user'|'assistant'`, `route: 'pet'|'rag'`, `content: string`, `status`, `requestId?`, `retryOfMessageId?`, `citations: RagCitation[]`, `warnings: string[]`, `tokenUsage?: {input:number;output:number}`, `createdAt`, `completedAt?`）。
- Consumes: `RagCitation`（来自 `../ai/rag/rag.types`）。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-schema.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { AssistantConversationSchema } from '../src/modules/assistant/schemas/assistant-conversation.schema'
import { AssistantMessageSchema } from '../src/modules/assistant/schemas/assistant-message.schema'

test('会话 schema 声明 userId/status 等关键字段与默认值', () => {
  assert.equal(AssistantConversationSchema.path('userId').instance, 'ObjectId')
  assert.equal(AssistantConversationSchema.path('status').options.default, 'active')
  assert.equal(AssistantConversationSchema.path('messageCount').options.default, 0)
  assert.equal(AssistantConversationSchema.path('defaultRoute').options.default, 'auto')
})

test('消息 schema 的 seq/requestId 唯一索引与状态枚举', () => {
  assert.equal(AssistantMessageSchema.path('seq').options.required, true)
  assert.equal(AssistantMessageSchema.path('status').options.enum.includes('cancelled'), true)
  const index = AssistantMessageSchema.indexes()
  assert.ok(index.some(([fields]) => fields.conversationId === 1 && fields.seq === 1))
  assert.ok(index.some(([fields]) => fields.userId === 1 && fields.requestId === 1))
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-schema.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/assistant/schemas/assistant-conversation.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type AssistantConversationStatus = 'active' | 'archived' | 'deleted'
export type AssistantRoute = 'auto' | 'pet' | 'rag'

export type AssistantConversationDocument = AssistantConversation & Document

@Schema({ collection: 'assistant_conversations', timestamps: true })
export class AssistantConversation {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId

  @Prop({ required: true, default: '新对话' })
  title: string

  @Prop({ required: true, enum: ['active', 'archived', 'deleted'], default: 'active', index: true })
  status: AssistantConversationStatus

  @Prop({ required: true, enum: ['auto', 'pet', 'rag'], default: 'auto' })
  defaultRoute: AssistantRoute

  @Prop({ type: Types.ObjectId, ref: 'KnowledgeBase' })
  knowledgeBaseId?: Types.ObjectId

  @Prop({ type: Date })
  lastMessageAt?: Date

  @Prop({ required: true, default: 0 })
  messageCount: number

  @Prop({ type: Date })
  deletedAt?: Date
}

export const AssistantConversationSchema = SchemaFactory.createForClass(AssistantConversation)
AssistantConversationSchema.index({ userId: 1, updatedAt: -1 }, { name: 'idx_assistant_conv_user_updated' })
```

```ts
// notes-backend/src/modules/assistant/schemas/assistant-message.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { RagCitation } from '../../ai/rag/rag.types'

export type AssistantMessageStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled'
export type AssistantMessageRole = 'user' | 'assistant'

export type AssistantMessageDocument = AssistantMessage & Document

@Schema({ collection: 'assistant_messages', timestamps: true })
export class AssistantMessage {
  @Prop({ required: true, type: Types.ObjectId, ref: 'AssistantConversation', index: true })
  conversationId: Types.ObjectId

  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId

  @Prop({ required: true })
  seq: number

  @Prop({ required: true, enum: ['user', 'assistant'] })
  role: AssistantMessageRole

  @Prop({ required: true, enum: ['pet', 'rag'] })
  route: 'pet' | 'rag'

  @Prop({ required: true, default: '' })
  content: string

  @Prop({ required: true, enum: ['pending', 'streaming', 'completed', 'failed', 'cancelled'], default: 'pending', index: true })
  status: AssistantMessageStatus

  @Prop()
  requestId?: string

  @Prop({ type: Types.ObjectId })
  retryOfMessageId?: Types.ObjectId

  @Prop({ type: [{ _id: false, evidenceId: String, noteId: String, noteTitle: String, chunkId: String, headingPath: [String], excerpt: String, score: Number }], default: [] })
  citations: RagCitation[]

  @Prop({ type: [String], default: [] })
  warnings: string[]

  @Prop({ type: { input: Number, output: Number }, default: undefined })
  tokenUsage?: { input: number; output: number }

  @Prop({ type: Date })
  completedAt?: Date
}

export const AssistantMessageSchema = SchemaFactory.createForClass(AssistantMessage)
AssistantMessageSchema.index({ conversationId: 1, seq: 1 }, { name: 'idx_assistant_msg_conv_seq', unique: true })
AssistantMessageSchema.index({ userId: 1, requestId: 1 }, { name: 'idx_assistant_msg_user_request', unique: true, partialFilterExpression: { requestId: { $type: 'string' } } })
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-schema.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/schemas/assistant-conversation.schema.ts notes-backend/src/modules/assistant/schemas/assistant-message.schema.ts notes-backend/test/assistant-schema.test.ts
git commit -m "feat(assistant): 新增会话与消息存储模型"
```

---

### Task 2: SSE 事件序列化纯函数

**Files:**
- Create: `notes-backend/src/modules/assistant/assistant-stream-format.ts`
- Test: `notes-backend/test/assistant-stream-format.test.ts`

**Interfaces:**
- Consumes: `RagCitation`、`RagPlanSummary`（来自 `../ai/rag/rag.types`）。
- Produces: `AssistantStreamEvent`（discriminated union）、`formatSseEvent(event): string`（返回以 `event: <name>\ndata: <json>\n\n` 结尾的完整 SSE 块）、`formatSseError(code, message, retryable)`、`parseSseEvent(line)`（前端复用同一协议，供测试断言；后端实现用它做自检）。

```ts
export type AssistantStreamEvent =
  | { event: 'started'; data: { conversationId: string; userMessageId: string; assistantMessageId: string; requestId: string } }
  | { event: 'status'; data: { stage: 'routing' | 'retrieving' | 'answering'; message: string } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'complete'; data: { messageId: string; route: 'pet' | 'rag'; citations: RagCitation[]; warnings: string[]; planSummary?: RagPlanSummary; runId?: string } }
  | { event: 'cancelled'; data: { messageId: string; text: string; reason: 'user_stopped' } }
  | { event: 'error'; data: { code: string; message: string; retryable: boolean } }
```

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-stream-format.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { formatSseEvent, parseSseEvent } from '../src/modules/assistant/assistant-stream-format'

test('delta 事件序列化为标准 SSE 块且可回读', () => {
  const block = formatSseEvent({ event: 'delta', data: { text: '你好' } })
  assert.equal(block, 'event: delta\ndata: {"text":"你好"}\n\n')
  const parsed = parseSseEvent(block)
  assert.deepEqual(parsed, { event: 'delta', data: { text: '你好' } })
})

test('complete 事件携带引用与警告', () => {
  const event = { event: 'complete' as const, data: { messageId: 'm1', route: 'rag' as const, citations: [{ evidenceId: 'E1', noteId: 'n1', noteTitle: 't', chunkId: 'c1', headingPath: [], excerpt: 'x' }], warnings: [], runId: 'r1' } }
  const parsed = parseSseEvent(formatSseEvent(event))
  assert.equal(parsed.event, 'complete')
  assert.equal((parsed as any).data.citations[0].evidenceId, 'E1')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-stream-format.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/assistant/assistant-stream-format.ts
import { RagCitation, RagPlanSummary } from '../ai/rag/rag.types'

export type AssistantStreamEvent =
  | { event: 'started'; data: { conversationId: string; userMessageId: string; assistantMessageId: string; requestId: string } }
  | { event: 'status'; data: { stage: 'routing' | 'retrieving' | 'answering'; message: string } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'complete'; data: { messageId: string; route: 'pet' | 'rag'; citations: RagCitation[]; warnings: string[]; planSummary?: RagPlanSummary; runId?: string } }
  | { event: 'cancelled'; data: { messageId: string; text: string; reason: 'user_stopped' } }
  | { event: 'error'; data: { code: string; message: string; retryable: boolean } }

export function formatSseEvent(event: AssistantStreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`
}

export function parseSseEvent(block: string): AssistantStreamEvent | null {
  const lines = block.split('\n')
  let eventName = ''
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (!eventName || dataLines.length === 0) return null
  return { event: eventName as AssistantStreamEvent['event'], data: JSON.parse(dataLines.join('\n')) }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-stream-format.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant-stream-format.ts notes-backend/test/assistant-stream-format.test.ts
git commit -m "feat(assistant): 定义结构化 SSE 事件协议"
```

---

### Task 3: 流式引用标记清洗器（共享纯函数）

**Files:**
- Create: `notes-backend/src/modules/ai/rag/rag-citation-sanitize.ts`
- Modify: `notes-backend/src/modules/ai/rag/rag-answer.service.ts`（改用共享同步版）
- Test: `notes-backend/test/rag-citation-sanitize.test.ts`

**Interfaces:**
- Consumes: `RagEvidence`、`RagCitation`（`../rag.types`）。
- Produces: `createRagCitationSanitizer(allowed: RagEvidence[]): { push(chunk: string): string; flush(): string; citations: RagCitation[]; invalidReferenceFound: boolean }`；`sanitizeCitationText(answer: string, allowed: RagEvidence[]): { answer: string; citations: RagCitation[]; invalidReferenceFound: boolean }`（同步版，`rag-answer.service.ts` 复用，行为与现有一致：未知标记删除、双空格折叠、trim）。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/rag-citation-sanitize.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { createRagCitationSanitizer, sanitizeCitationText } from '../src/modules/ai/rag/rag-citation-sanitize'

const allowed = [
  { noteId: 'n1', noteTitle: 'React', chunkId: 'c1', headingPath: ['前端'], content: 'Diff', excerpt: 'Diff', score: 0.9, source: 'chunk_vector' as const },
]

test('同步版剔除伪造引用并保留有效引用', () => {
  const result = sanitizeCitationText('结论 [E1]，另见 [E999]', allowed)
  assert.equal(result.answer, '结论 [E1]，另见')
  assert.equal(result.citations.length, 1)
  assert.equal(result.invalidReferenceFound, true)
})

test('流式版跨 chunk 拆分也能识别完整标记', () => {
  const sanitizer = createRagCitationSanitizer(allowed)
  const out1 = sanitizer.push('结论 [E')
  const out2 = sanitizer.push('1]，错误 [E99')
  const out3 = sanitizer.push('9] 结束')
  assert.equal(out1, '结论 ')
  assert.equal(out2, '[E1]，错误 ')
  assert.equal(out3, ' 结束')
  assert.equal(sanitizer.flush(), '')
  assert.equal(sanitizer.citations[0].evidenceId, 'E1')
  assert.equal(sanitizer.invalidReferenceFound, true)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/rag-citation-sanitize.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/ai/rag/rag-citation-sanitize.ts
import { RagCitation, RagEvidence } from './rag.types'

export interface RagCitationSanitizer {
  push(chunk: string): string
  flush(): string
  readonly citations: RagCitation[]
  readonly invalidReferenceFound: boolean
}

// 流式处理：缓冲可能被拆分的 `[E...` 前缀，闭合后再判定是否属于 allowed。
export function createRagCitationSanitizer(allowed: RagEvidence[]): RagCitationSanitizer {
  const byId = new Map(allowed.map((item) => [`E${allowed.indexOf(item) + 1}`, item]))
  const seen = new Set<string>()
  const citations: RagCitation[] = []
  let invalidReferenceFound = false
  let buffer = ''

  const emit = (text: string): string => {
    const cleaned = text.replace(/\[(E\d+)\]/g, (marker, id: string) => {
      const item = byId.get(id)
      if (!item) { invalidReferenceFound = true; return '' }
      if (!seen.has(id)) {
        seen.add(id)
        citations.push({ evidenceId: id, noteId: item.noteId, noteTitle: item.noteTitle, chunkId: item.chunkId, headingPath: item.headingPath, excerpt: item.excerpt, score: item.score })
      }
      return marker
    })
    return cleaned
  }

  return {
    push(chunk: string): string {
      const combined = buffer + chunk
      const lastOpen = combined.lastIndexOf('[')
      if (lastOpen === -1) { buffer = ''; return emit(combined) }
      const tail = combined.slice(lastOpen)
      if (/^\[E\d*$/.test(tail)) { buffer = tail; return emit(combined.slice(0, lastOpen)) }
      buffer = ''
      return emit(combined)
    },
    flush(): string { const rest = buffer; buffer = ''; return emit(rest) },
    get citations() { return citations },
    get invalidReferenceFound() { return invalidReferenceFound },
  }
}

// 同步版：供一次性 answer 路径复用；行为与历史 sanitizeCitations 一致。
export function sanitizeCitationText(answer: string, allowed: RagEvidence[]): { answer: string; citations: RagCitation[]; invalidReferenceFound: boolean } {
  const sanitizer = createRagCitationSanitizer(allowed)
  const cleaned = sanitizer.push(answer) + sanitizer.flush()
  return { answer: cleaned.replace(/[ \t]{2,}/g, ' ').trim(), citations: sanitizer.citations, invalidReferenceFound: sanitizer.invalidReferenceFound }
}
```

修改 `rag-answer.service.ts`：删除私有 `sanitizeCitations`，在 `answer()` 内改调 `sanitizeCitationText(response.content, allowed)`（`allowed` 现在直接是 `RagEvidence[]`，不再包 `{id,item}`；同时把第 32 行的 `allowed` 构造与第 37 行 prompt 使用改为 `result.evidence.map((item, index) => ...)` 保留 `[E${index+1}]` 编号，编号规则必须与 sanitizer 一致）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/rag-citation-sanitize.test.ts test/rag-answer-grounding.test.ts`
Expected: PASS（含既有 grounding 回归）

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/ai/rag/rag-citation-sanitize.ts notes-backend/src/modules/ai/rag/rag-answer.service.ts notes-backend/test/rag-citation-sanitize.test.ts
git commit -m "refactor(ai): 抽取可复用的流式引用清洗器"
```

---

### Task 4: 会话与消息仓储服务

**Files:**
- Create: `notes-backend/src/modules/assistant/assistant-conversations.service.ts`
- Create: `notes-backend/src/modules/assistant/assistant-messages.service.ts`
- Test: `notes-backend/test/assistant-store.test.ts`

**Interfaces:**
- Consumes: `AssistantConversation`/`AssistantMessage` 模型（Task 1）、`RagCitation`。
- Produces:
  - `AssistantConversationsService.ensure(userId, opts?: { knowledgeBaseId?, title? }): Promise<{ id: string; isNew: boolean }>`（复用 `active` 状态最近会话；无则创建）。
  - `AssistantConversationsService.get(userId, id): Promise<{ id: string; title: string; status: string } | null>`。
  - `AssistantConversationsService.touch(userId, id, delta: { lastMessageAt: Date; messageCount: number; knowledgeBaseId?: string | null })`。
  - `AssistantMessagesService.appendUser(userId, conversationId, route, content, requestId): Promise<{ messageId: string; seq: number }>`。
  - `AssistantMessagesService.createPlaceholder(userId, conversationId, route, requestId?, retryOfMessageId?): Promise<{ messageId: string; seq: number }>`。
  - `AssistantMessagesService.appendDelta(userId, messageId, content, tokenUsage?)`（`$set content + status:'streaming'`）。
  - `AssistantMessagesService.finalize(userId, messageId, payload: { content; citations; warnings; runId?; tokenUsage? })`（`status:'completed'`, `completedAt`）。
  - `AssistantMessagesService.markCancelled(userId, messageId, content)`。
  - `AssistantMessagesService.markFailed(userId, messageId, content)`（`status:'failed'`, `completedAt`）。
  - `AssistantMessagesService.list(userId, conversationId, opts?: { afterSeq?: number; limit?: number }): Promise<AssistantMessageView[]>`（按 seq 升序）。
  - `AssistantMessagesService.getByRequestId(userId, requestId): Promise<AssistantMessageView | null>`。
  - `AssistantMessageView = { id; conversationId; seq; role; route; content; status; requestId?; retryOfMessageId?; citations; warnings; tokenUsage?; createdAt; completedAt? }`（id 为字符串，citations 快照）。

- [ ] **Step 1: 写失败测试（用内存假模型驱动服务逻辑）**

```ts
// notes-backend/test/assistant-store.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantMessagesService } from '../src/modules/assistant/assistant-messages.service'

// 最小内存模型：支持 findOne/find/create/findOneAndUpdate；findOne 支持 .sort().select().lean().exec()、find 支持 .sort().limit().lean().exec()；过滤器支持 $gt 运算符（afterSeq 游标）。updateOne 未实现（本任务测试未覆盖更新路径）。
function matches(d: any, filter: any): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$gt' in v) return Number(d[k]) > (v as { $gt: number }).$gt
    return String(d[k]) === String(v)
  })
}
class MemoryModel {
  docs: any[] = []
  constructor(private readonly seed: any[] = []) { this.docs = seed.map((d) => ({ ...d, _id: d._id || `id-${Math.random()}` })) }
  findOne(filter: any) {
    const doc = this.docs.find((d) => matches(d, filter)) ?? null
    const exec = async () => doc
    return {
      sort: () => ({ select: () => ({ lean: () => ({ exec }) }) }),
      lean: () => ({ exec }),
    }
  }
  find(filter: any) {
    const result = this.docs.filter((d) => matches(d, filter))
    const execAll = async () => [...result].sort((a, b) => a.seq - b.seq)
    return {
      sort: () => ({ limit: (n: number) => ({ lean: () => ({ exec: async () => (await execAll()).slice(0, n) }) }) }),
      lean: () => ({ exec: execAll }),
    }
  }
  async create(data: any) { const doc = { ...data, _id: data._id || `id-${this.docs.length + 1}` }; this.docs.push(doc); return doc }
  async findOneAndUpdate(filter: any, update: any) {
    const doc = this.docs.find((d) => matches(d, filter))
    if (!doc) return null
    const sets = update.$set || {}
    Object.assign(doc, sets)
    return { ...doc }
  }
}

test('消息按 seq 升序返回并支持 afterSeq 游标', async () => {
  const model = new MemoryModel([
    { _id: 'm1', conversationId: 'cccccccccccccccccccccccc', userId: 'aaaaaaaaaaaaaaaaaaaaaaaa', seq: 1, role: 'user', route: 'pet', content: 'hi', status: 'completed' },
    { _id: 'm2', conversationId: 'cccccccccccccccccccccccc', userId: 'aaaaaaaaaaaaaaaaaaaaaaaa', seq: 2, role: 'assistant', route: 'pet', content: 'hello', status: 'completed' },
  ])
  const service = new AssistantMessagesService(model as any)
  const all = await service.list('aaaaaaaaaaaaaaaaaaaaaaaa', 'cccccccccccccccccccccccc')
  assert.deepEqual(all.map((m) => m.seq), [1, 2])
  const after = await service.list('aaaaaaaaaaaaaaaaaaaaaaaa', 'cccccccccccccccccccccccc', { afterSeq: 1 })
  assert.deepEqual(after.map((m) => m.seq), [2])
})

test('getByRequestId 按用户与 requestId 精确查询', async () => {
  const model = new MemoryModel([{ _id: 'm1', conversationId: 'cccccccccccccccccccccccc', userId: 'aaaaaaaaaaaaaaaaaaaaaaaa', seq: 1, role: 'user', route: 'rag', content: 'q', status: 'completed', requestId: 'req-1' }])
  const service = new AssistantMessagesService(model as any)
  assert.ok(await service.getByRequestId('aaaaaaaaaaaaaaaaaaaaaaaa', 'req-1'))
  assert.equal(await service.getByRequestId('bbbbbbbbbbbbbbbbbbbbbbbb', 'req-1'), null)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/assistant/assistant-messages.service.ts
import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { RagCitation } from '../ai/rag/rag.types'
import { AssistantMessage, AssistantMessageDocument } from './schemas/assistant-message.schema'

export type AssistantMessageView = {
  id: string; conversationId: string; seq: number; role: 'user' | 'assistant'; route: 'pet' | 'rag'
  content: string; status: string; requestId?: string; retryOfMessageId?: string
  citations: RagCitation[]; warnings: string[]; tokenUsage?: { input: number; output: number }
  createdAt: string; completedAt?: string
}

function toView(doc: any): AssistantMessageView {
  return {
    id: String(doc._id), conversationId: String(doc.conversationId), seq: Number(doc.seq), role: doc.role, route: doc.route,
    content: String(doc.content || ''), status: doc.status, requestId: doc.requestId, retryOfMessageId: doc.retryOfMessageId ? String(doc.retryOfMessageId) : undefined,
    citations: Array.isArray(doc.citations) ? doc.citations : [], warnings: Array.isArray(doc.warnings) ? doc.warnings : [],
    tokenUsage: doc.tokenUsage, createdAt: String(doc.createdAt || new Date().toISOString()), completedAt: doc.completedAt ? String(doc.completedAt) : undefined,
  }
}

@Injectable()
export class AssistantMessagesService {
  constructor(@InjectModel(AssistantMessage.name) private readonly model: Model<AssistantMessageDocument>) {}

  async appendUser(userId: string, conversationId: string, route: 'pet' | 'rag', content: string, requestId: string): Promise<{ messageId: string; seq: number }> {
    const seq = await this.nextSeq(userId, conversationId)
    const created = await this.model.create({ userId: new Types.ObjectId(userId), conversationId: new Types.ObjectId(conversationId), seq, role: 'user', route, content, status: 'completed', requestId })
    return { messageId: String(created._id), seq }
  }

  async createPlaceholder(userId: string, conversationId: string, route: 'pet' | 'rag', requestId?: string, retryOfMessageId?: string): Promise<{ messageId: string; seq: number }> {
    const seq = await this.nextSeq(userId, conversationId)
    const created = await this.model.create({
      userId: new Types.ObjectId(userId), conversationId: new Types.ObjectId(conversationId), seq, role: 'assistant', route, content: '', status: 'pending',
      ...(requestId ? { requestId } : {}), ...(retryOfMessageId ? { retryOfMessageId: new Types.ObjectId(retryOfMessageId) } : {}),
    })
    return { messageId: String(created._id), seq }
  }

  private async nextSeq(userId: string, conversationId: string): Promise<number> {
    // 顺序生成 seq：假设单写者；并发时依赖唯一索引 (conversationId, seq) 兜底报错，而非静默错序
    const last = await this.model.findOne({ conversationId: new Types.ObjectId(conversationId), userId: new Types.ObjectId(userId) }).sort({ seq: -1 }).select('seq').lean().exec()
    return (Number(last?.seq) || 0) + 1
  }

  async appendDelta(userId: string, messageId: string, content: string, tokenUsage?: { input: number; output: number }) {
    const update: any = { $set: { content, status: 'streaming' } }
    if (tokenUsage) update.$set.tokenUsage = tokenUsage
    await this.model.updateOne({ _id: new Types.ObjectId(messageId), userId: new Types.ObjectId(userId) }, update).exec()
  }

  async finalize(userId: string, messageId: string, payload: { content: string; citations: RagCitation[]; warnings: string[]; runId?: string; tokenUsage?: { input: number; output: number } }) {
    const update: any = { $set: { content: payload.content, citations: payload.citations, warnings: payload.warnings, status: 'completed', completedAt: new Date() } }
    if (payload.tokenUsage) update.$set.tokenUsage = payload.tokenUsage
    await this.model.updateOne({ _id: new Types.ObjectId(messageId), userId: new Types.ObjectId(userId) }, update).exec()
  }

  async markCancelled(userId: string, messageId: string, content: string) {
    await this.model.updateOne({ _id: new Types.ObjectId(messageId), userId: new Types.ObjectId(userId) }, { $set: { content, status: 'cancelled', completedAt: new Date() } }).exec()
  }

  async markFailed(userId: string, messageId: string, content: string) {
    await this.model.updateOne({ _id: new Types.ObjectId(messageId), userId: new Types.ObjectId(userId) }, { $set: { content, status: 'failed', completedAt: new Date() } }).exec()
  }

  async list(userId: string, conversationId: string, opts?: { afterSeq?: number; limit?: number }): Promise<AssistantMessageView[]> {
    const filter: any = { conversationId: new Types.ObjectId(conversationId), userId: new Types.ObjectId(userId) }
    if (opts?.afterSeq !== undefined) filter.seq = { $gt: opts.afterSeq }
    const docs = await this.model.find(filter).sort({ seq: 1 }).limit(Math.min(200, opts?.limit ?? 200)).lean().exec()
    return docs.map(toView)
  }

  async getByRequestId(userId: string, requestId: string): Promise<AssistantMessageView | null> {
    const doc = await this.model.findOne({ userId: new Types.ObjectId(userId), requestId }).lean().exec()
    return doc ? toView(doc) : null
  }
}
```

```ts
// notes-backend/src/modules/assistant/assistant-conversations.service.ts
import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { AssistantConversation, AssistantConversationDocument } from './schemas/assistant-conversation.schema'

@Injectable()
export class AssistantConversationsService {
  constructor(@InjectModel(AssistantConversation.name) private readonly model: Model<AssistantConversationDocument>) {}

  async ensure(userId: string, opts?: { knowledgeBaseId?: string; title?: string }): Promise<{ id: string; isNew: boolean }> {
    const existing = await this.model.findOne({ userId: new Types.ObjectId(userId), status: 'active' }).sort({ updatedAt: -1 }).select('_id').lean().exec()
    if (existing) return { id: String(existing._id), isNew: false }
    const created = await this.model.create({
      userId: new Types.ObjectId(userId),
      title: opts?.title || '新对话',
      ...(opts?.knowledgeBaseId ? { knowledgeBaseId: new Types.ObjectId(opts.knowledgeBaseId) } : {}),
    })
    return { id: String(created._id), isNew: true }
  }

  async get(userId: string, id: string) {
    const doc = await this.model.findOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) }).lean().exec()
    if (!doc) return null
    return { id: String(doc._id), title: String(doc.title || ''), status: doc.status }
  }

  async touch(userId: string, id: string, delta: { lastMessageAt: Date; messageCount: number; knowledgeBaseId?: string | null }) {
    const update: any = { $set: { lastMessageAt: delta.lastMessageAt, messageCount: delta.messageCount } }
    if (delta.knowledgeBaseId !== undefined) update.$set.knowledgeBaseId = delta.knowledgeBaseId ? new Types.ObjectId(delta.knowledgeBaseId) : null
    await this.model.updateOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) }, update).exec()
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-store.test.ts`
Expected: PASS（假模型已按服务调用形态实现：`findOne().sort().select().lean().exec()`、`find().sort().limit().lean().exec()` 与 `$gt` 过滤器；测试种子使用合法 ObjectId hex 字符串，服务端 `new Types.ObjectId(...)` 不会抛错。若实现者对服务代码做了查询形态调整，保持假模型与服务调用一致即可）

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant-conversations.service.ts notes-backend/src/modules/assistant/assistant-messages.service.ts notes-backend/test/assistant-store.test.ts
git commit -m "feat(assistant): 会话与消息仓储服务"
```

---

### Task 5: 流式 RAG 编排服务（RagStreamService）

**Files:**
- Create: `notes-backend/src/modules/ai/rag/rag-stream.service.ts`
- Create: `notes-backend/src/modules/ai/rag/rag-task-builder.ts`（共享任务选项/prompt 构建器，双 RAG 路径复用）
- Modify: `notes-backend/src/modules/ai/rag/rag-answer.service.ts`（改用 builder，行为不变）
- Modify: `notes-backend/src/modules/ai/ai.module.ts`（导出）
- Test: `notes-backend/test/rag-stream.service.test.ts`

**Interfaces:**
- Consumes: `QueryPlannerService.plan(question)`、`RagRetrievalService.retrieve(question, userId, knowledgeBaseId, plan)`、`AiGatewayClient.streamTask({ task: 'rag_answer', ... })`、`createRagCitationSanitizer`。
- Produces: `RagStreamService.streamRagAnswer(input: { question: string; knowledgeBaseId?: string; userId: string }, hooks: { onStatus(stage: 'retrieving'|'answering', message: string): void | Promise<void>; onDelta(text: string): void | Promise<void> }): Promise<{ route: 'rag'; citations: RagCitation[]; warnings: string[]; planSummary: RagPlanSummary; runId?: string }>`。无证据时 `onStatus('answering','未找到相关片段')` 后直接返回空引用与降级提示（不调用模型）。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/rag-stream.service.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { RagStreamService } from '../src/modules/ai/rag/rag-stream.service'

const evidence = [{ noteId: 'n1', noteTitle: 'React', chunkId: 'c1', headingPath: ['前端'], content: 'Diff', excerpt: 'Diff', score: 0.9, source: 'chunk_vector' as const }]

test('流式回答逐段下发正文并剔除伪造引用', async () => {
  const deltas: string[] = []
  const service = new RagStreamService(
    { plan: async () => ({ intent: 'explain', tools: ['chunk_vector', 'rerank'], reasoningMode: 'off', graphHops: 0 }) } as any,
    { retrieve: async () => ({ evidence, warnings: [], rerankApplied: true, candidateCount: 1 }) } as any,
    { streamTask: async () => sseStream(['这是答案 [E', '1] 另见 [E999]']) } as any,
  )
  const result = await service.streamRagAnswer({ question: 'React 是什么', userId: 'u1' }, {
    onStatus: async () => undefined,
    onDelta: async (text) => { deltas.push(text) },
  })
  assert.equal(deltas.join(''), '这是答案 [E1] 另见 ')
  assert.equal(result.citations[0].evidenceId, 'E1')
  assert.equal(result.warnings.includes('已忽略无效引用'), true)
})

test('无证据时不调用模型并返回降级提示', async () => {
  let modelCalled = false
  const service = new RagStreamService(
    { plan: async () => ({ intent: 'user_history', tools: ['keyword'], reasoningMode: 'off', graphHops: 0 }) } as any,
    { retrieve: async () => ({ evidence: [], warnings: [], rerankApplied: false, candidateCount: 0 }) } as any,
    { streamTask: async () => { modelCalled = true; return sseStream([]) } } as any,
  )
  const result = await service.streamRagAnswer({ question: '我踩了什么坑', userId: 'u1' }, { onStatus: async () => undefined, onDelta: async () => undefined })
  assert.equal(modelCalled, false)
  assert.equal(result.citations.length, 0)
  assert.ok(result.warnings.includes('未找到足够笔记证据'))
})

// 构造一个按 chunk 输出的上游 ReadableStream（模拟 gateway 流式响应）
function sseStream(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
}
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/rag-stream.service.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/ai/rag/rag-stream.service.ts
import { Injectable } from '@nestjs/common'
import { AiGatewayClient } from '../ai-gateway.client'
import { RagCitation, RagPlanSummary } from './rag.types'
import { QueryPlannerService } from './query-planner.service'
import { RagRetrievalService } from './rag-retrieval.service'
import { createRagCitationSanitizer } from './rag-citation-sanitize'
import { buildRagAnswerTaskOptions } from './rag-task-builder'

export type RagStreamHooks = {
  onStatus(stage: 'retrieving' | 'answering', message: string): void | Promise<void>
  onDelta(text: string): void | Promise<void>
}

@Injectable()
export class RagStreamService {
  constructor(private readonly planner: QueryPlannerService, private readonly retrieval: RagRetrievalService, private readonly gateway: AiGatewayClient) {}

  async streamRagAnswer(input: { question: string; knowledgeBaseId?: string; userId: string }, hooks: RagStreamHooks): Promise<{ route: 'rag'; citations: RagCitation[]; warnings: string[]; planSummary: RagPlanSummary; runId?: string }> {
    const { question, knowledgeBaseId, userId } = input
    await hooks.onStatus('retrieving', '正在检索笔记')
    const plan = await this.planner.plan(question)
    const result = await this.retrieval.retrieve(question, userId, knowledgeBaseId, plan)
    if (result.evidence.length === 0) {
      await hooks.onStatus('answering', '未找到相关片段')
      return { route: 'rag', citations: [], warnings: [...result.warnings, '未找到足够笔记证据'], planSummary: { ...plan, rerankApplied: result.rerankApplied } }
    }
    await hooks.onStatus('answering', `已找到 ${result.evidence.length} 个相关片段`)
    const allowed = result.evidence
    const stream = await this.gateway.streamTask(buildRagAnswerTaskOptions({ question, allowed, plan, userId }))
    const sanitizer = createRagCitationSanitizer(allowed)
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          const safe = sanitizer.push(decoder.decode(value, { stream: true }))
          if (safe) await hooks.onDelta(safe)
        }
      }
    } finally {
      // 流结束时补一次无参 decode，冲刷解码缓冲区内残留的多字节字符尾部（与 ai-gateway 的 auditTextStream 同一惯例）
      const tailText = decoder.decode()
      const safe = tailText ? sanitizer.push(tailText) : ''
      const tail = safe + sanitizer.flush()
      if (tail) await hooks.onDelta(tail)
    }
    const warnings = [...result.warnings]
    if (sanitizer.invalidReferenceFound) warnings.push('已忽略无效引用')
    if (sanitizer.citations.length === 0) warnings.push('回答未附带可验证引用')
    return { route: 'rag', citations: sanitizer.citations, warnings, planSummary: { ...plan, rerankApplied: result.rerankApplied } }
  }
}
```

```ts
// notes-backend/src/modules/ai/rag/rag-task-builder.ts
import { AiChatOptions } from '../ai-gateway.types'
import { RagEvidence, RagPlan } from './rag.types'

// 一次性 answer 与流式 streamRagAnswer 两条 RAG 路径共用同一份任务选项与提示词，避免后续调优只改一处导致双路径漂移。
export function buildRagAnswerTaskOptions(input: { question: string; allowed: RagEvidence[]; plan: RagPlan; userId: string; runId?: string }): AiChatOptions & { task: 'rag_answer' } {
  const audit: any = { graphName: 'GraphRagAnswerGraph', userId: input.userId }
  if (input.runId) audit.runId = input.runId
  return {
    task: 'rag_answer', reasoningMode: input.plan.reasoningMode, maxTokens: 1800, temperature: 0.2,
    audit,
    system: 'Answer in Chinese. Cite note-supported claims using only [E1] style IDs supplied in context. General knowledge is allowed only when labelled “通用补充”, never as a user-note fact. For user history claims, use only evidence. Do not reveal reasoning.',
    prompt: ['用户问题：' + input.question, '', '证据：', ...input.allowed.map((item, index) => `[E${index + 1}] ${item.noteTitle} | ${item.headingPath.join(' > ')}\n${item.content}`)].join('\n\n'),
  }
}
```

`rag-answer.service.ts`：同步把 `chatTask({...})` 内联选项改为 `buildRagAnswerTaskOptions({ question, allowed: result.evidence, plan, userId: context.userId, runId })`（`runId` 仅该路径有；行为不变，grounding 测试保持通过）。warning 聚合仅两行且两路径条件相同，不抽取。

`ai.module.ts`：在 `providers` 增加 `RagStreamService`，`exports` 增加 `RagStreamService`。

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/rag-stream.service.test.ts test/rag-answer-grounding.test.ts test/rag-retrieval-orchestration.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/ai/rag/rag-stream.service.ts notes-backend/src/modules/ai/rag/rag-task-builder.ts notes-backend/src/modules/ai/rag/rag-answer.service.ts notes-backend/src/modules/ai/ai.module.ts notes-backend/test/rag-stream.service.test.ts
git commit -m "feat(ai): 流式 RAG 回答编排"
```

---

### Task 6: 生成编排：幂等、取消、断线续跑与事件订阅

**Files:**
- Create: `notes-backend/src/modules/assistant/assistant-generation.service.ts`
- Test: `notes-backend/test/assistant-generation.test.ts`

**Interfaces:**
- Consumes: `AssistantConversationsService`、`AssistantMessagesService`、`RagStreamService`、`AiService.chatPet`、`formatSseEvent`/`AssistantStreamEvent`、`REDIS_CLIENT`（可选）。
- Produces:
  - `AssistantGenerationService.start(input: { userId: string; conversationId?: string; requestId: string; question: string; knowledgeBaseId?: string; forceRoute?: 'pet' | 'rag' }, emit: (event: AssistantStreamEvent) => void): Promise<void>`。幂等：`getByRequestId` 命中则直接发 `started`+`complete`（已有终态）或仅订阅（运行中）。生成在后台继续（不因 HTTP 断开而中止），通过 `EventEmitter`（keyed by requestId）向所有订阅者广播 delta/complete/error。
  - `AssistantGenerationService.attach(requestId: string, emit: (event: AssistantStreamEvent) => void): void`（新连接补发当前快照后订阅）。
  - `AssistantGenerationService.cancel(requestId: string, userId: string): Promise<void>`（置 Redis 取消键 + 触发本地取消）。
  - `AssistantGenerationService.isRunning(requestId): boolean`。
- 取消语义：`cancel` 后生成循环在下一个上游 chunk 处停止，`markCancelled(已生成文本)`，广播 `cancelled` 事件；`(userId, requestId)` 唯一索引保证重复请求不重复生成。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-generation.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { EventEmitter } from 'node:events'
import { AssistantGenerationService } from '../src/modules/assistant/assistant-generation.service'

const userId = 'u1'
const requestId = 'req-1'

function fakeStore() {
  const byRequest = new Map<string, any>()
  const events: any[] = []
  return {
    events,
    conversations: {
      ensure: async () => ({ id: 'c1', isNew: true }),
      get: async () => ({ id: 'c1', title: 't', status: 'active' }),
      touch: async () => undefined,
    },
    messages: {
      appendUser: async () => ({ messageId: 'um1', seq: 1 }),
      createPlaceholder: async () => ({ messageId: 'am1', seq: 2 }),
      appendDelta: async (u: string, id: string, content: string) => { events.push({ type: 'delta', content }) },
      finalize: async (u: string, id: string, payload: any) => { events.push({ type: 'finalize', ...payload }) },
      markCancelled: async (u: string, id: string, content: string) => { events.push({ type: 'cancelled', content }) },
      markFailed: async () => undefined,
      list: async () => [],
      getByRequestId: async () => byRequest.get(requestId) ?? null,
    },
    byRequest,
  }
}

test('同一 requestId 重复 start 不重复生成', async () => {
  const store = fakeStore()
  let ragCalls = 0
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => { ragCalls += 1; return { route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } } } } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  const emitted: any[] = []
  await service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted.push(e))
  store.byRequest.set(requestId, { id: 'am1', status: 'completed' })
  await service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted.push(e))
  assert.equal(ragCalls, 1)
  assert.ok(emitted.some((e) => e.event === 'started'))
})

test('cancel 后消息标记 cancelled 且广播事件', async () => {
  const store = fakeStore()
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async (input: any, hooks: any) => { await hooks.onDelta('部分文本'); return { route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } } } } as any,
    { chatPet: async () => new ReadableStream({ start(c) { c.close() } }) } as any,
    undefined as any,
  )
  const emitted: any[] = []
  const done = service.start({ userId, requestId, question: 'q', forceRoute: 'rag' }, (e) => emitted.push(e))
  await service.cancel(requestId, userId)
  await done
  assert.ok(store.events.some((e) => e.type === 'cancelled'))
  assert.ok(emitted.some((e) => e.event === 'cancelled'))
})

test('route 未指定时按问题路由 pet/rag', async () => {
  const store = fakeStore()
  let petCalled = false
  const service = new AssistantGenerationService(
    store.conversations as any, store.messages as any,
    { streamRagAnswer: async () => ({ route: 'rag', citations: [], warnings: [], planSummary: { intent: 'explain', tools: [], graphHops: 0, rerankApplied: false } }) } as any,
    { chatPet: async () => { petCalled = true; return new ReadableStream({ start(c) { c.close() } }) } } as any,
    undefined as any,
  )
  await service.start({ userId, requestId: 'req-pet', question: '今天天气不错', forceRoute: undefined }, () => undefined)
  assert.equal(petCalled, true)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-generation.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/assistant/assistant-generation.service.ts
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { EventEmitter } from 'node:events'
import Redis from 'ioredis'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { AiService } from '../ai/ai.service'
import { RagStreamService } from '../ai/rag/rag-stream.service'
import { AssistantStreamEvent } from './assistant-stream-format'
import { AssistantConversationsService } from './assistant-conversations.service'
import { AssistantMessagesService } from './assistant-messages.service'

const NOTE_INTENT = /(我的笔记|笔记里|之前|当时|踩坑|查找|找到|搜索|哪篇|比较|区别|差异|冲突|矛盾|知识库)/i

@Injectable()
export class AssistantGenerationService {
  private readonly logger = new Logger(AssistantGenerationService.name)
  private readonly emitters = new Map<string, EventEmitter>()
  private readonly running = new Set<string>()
  private readonly cancelKeys = new Set<string>()
  // requestId -> 生成停止时 resolve 的 promise：cancel 等待它，保证返回时 cancelled 已落库并广播。
  private readonly stops = new Map<string, Promise<void>>()

  constructor(
    private readonly conversations: AssistantConversationsService,
    private readonly messages: AssistantMessagesService,
    private readonly ragStream: RagStreamService,
    private readonly aiService: AiService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  isRunning(requestId: string): boolean { return this.running.has(requestId) }

  async start(input: { userId: string; conversationId?: string; requestId: string; question: string; knowledgeBaseId?: string; forceRoute?: 'pet' | 'rag' }, emit: (event: AssistantStreamEvent) => void): Promise<void> {
    const { userId, requestId } = input
    if (this.running.has(requestId)) { this.attach(requestId, emit); return }

    // 同步段先占位运行态并注册停止处理器：cancel 在 start 首个 await 前调用也能等到生成停止。
    this.running.add(requestId)
    let resolveStop!: () => void
    const stop = new Promise<void>((resolve) => { resolveStop = resolve })
    this.stops.set(requestId, stop)
    const emitter = new EventEmitter()
    this.emitters.set(requestId, emitter)
    emitter.on('event', (event: AssistantStreamEvent) => { try { emit(event) } catch { /* 订阅者已断开 */ } })
    const finish = () => {
      this.running.delete(requestId)
      this.emitters.delete(requestId)
      this.stops.delete(requestId)
      resolveStop()
    }
    try {
      // 幂等：同一 (userId, requestId) 已有消息时不重复生成，直接补发终态。
      const existing = await this.messages.getByRequestId(userId, requestId)
      if (existing) {
        emit({ event: 'started', data: { conversationId: String(existing.conversationId), userMessageId: existing.retryOfMessageId || '', assistantMessageId: existing.id, requestId } })
        if (existing.status === 'completed' || existing.status === 'failed' || existing.status === 'cancelled') {
          emit({ event: 'complete', data: { messageId: existing.id, route: existing.route, citations: existing.citations, warnings: existing.warnings } })
        } else {
          this.attach(requestId, emit)
        }
        finish()
        return
      }

      const route: 'pet' | 'rag' = input.forceRoute === 'pet' || input.forceRoute === 'rag'
        ? input.forceRoute
        : (input.forceRoute === 'rag' || NOTE_INTENT.test(input.question) ? 'rag' : 'pet')
      const conversation = await this.conversations.ensure(userId, input.knowledgeBaseId ? { knowledgeBaseId: input.knowledgeBaseId } : undefined)
      const userMessage = await this.messages.appendUser(userId, conversation.id, route, input.question, requestId)
      const assistantMessage = await this.messages.createPlaceholder(userId, conversation.id, route, requestId)
      await this.conversations.touch(userId, conversation.id, { lastMessageAt: new Date(), messageCount: userMessage.seq + 1, knowledgeBaseId: input.knowledgeBaseId ?? null })
      emitter.emit('event', { event: 'started', data: { conversationId: conversation.id, userMessageId: userMessage.messageId, assistantMessageId: assistantMessage.messageId, requestId } })

      // 后台继续生成：HTTP 断开不中止，订阅者通过 attach 重连。
      void this.runGeneration({ ...input, conversationId: conversation.id, assistantMessageId: assistantMessage.messageId, route }, emitter).finally(() => finish())
    } catch (error) {
      // 前置步骤失败时释放占位，避免 requestId 永久停留在运行态。
      finish()
      throw error
    }
  }

  attach(requestId: string, emit: (event: AssistantStreamEvent) => void): void {
    const emitter = this.emitters.get(requestId)
    if (emitter) emitter.on('event', (event: AssistantStreamEvent) => { try { emit(event) } catch { /* ignore */ } })
  }

  async cancel(requestId: string, userId: string): Promise<void> {
    // 单实例内存取消标记为当前实现；跨实例取消通过 Redis 发布订阅增强（后续阶段）。
    this.cancelKeys.add(requestId)
    const emitter = this.emitters.get(requestId)
    if (emitter) emitter.emit('event', { event: 'error', data: { code: 'CANCELLED', message: '已停止生成', retryable: false } })
    // 等待生成循环真正停止：cancel 返回时 cancelled 已落库并广播。
    const stop = this.stops.get(requestId)
    if (stop) await stop
  }

  private async runGeneration(input: { userId: string; conversationId: string; assistantMessageId: string; requestId: string; question: string; knowledgeBaseId?: string; route: 'pet' | 'rag' }, emitter: EventEmitter): Promise<void> {
    const { userId, assistantMessageId, requestId, route } = input
    let content = ''
    let flushedAt = 0
    let flushedChars = 0
    const flush = async (force: boolean) => {
      // 批量落库：每 500ms 或新增 200 字符写一次。
      const now = Date.now()
      if (!force && now - flushedAt < 500 && content.length - flushedChars < 200) return
      await this.messages.appendDelta(userId, assistantMessageId, content)
      flushedAt = now
      flushedChars = content.length
    }
    const cancelled = () => this.cancelKeys.has(requestId)
    const emitDelta = async (text: string) => {
      content += text
      await flush(false)
      emitter.emit('event', { event: 'delta', data: { text } })
    }
    try {
      if (route === 'rag') {
        emitter.emit('event', { event: 'status', data: { stage: 'routing', message: '正在检索你的笔记' } })
        const result = await this.ragStream.streamRagAnswer(
          { question: input.question, knowledgeBaseId: input.knowledgeBaseId, userId },
          {
            onStatus: async (stage, message) => { if (cancelled()) throw new Error('CANCELLED'); emitter.emit('event', { event: 'status', data: { stage, message } }) },
            onDelta: async (text) => { if (cancelled()) throw new Error('CANCELLED'); await emitDelta(text) },
          },
        )
        if (cancelled()) throw new Error('CANCELLED')
        await flush(true)
        await this.messages.finalize(userId, assistantMessageId, { content, citations: result.citations, warnings: result.warnings })
        emitter.emit('event', { event: 'complete', data: { messageId: assistantMessageId, route: 'rag', citations: result.citations, warnings: result.warnings, planSummary: result.planSummary, runId: result.runId } })
      } else {
        emitter.emit('event', { event: 'status', data: { stage: 'routing', message: '小助手正在回复' } })
        const stream = await this.aiService.chatPet({ message: input.question }, { userId })
        const reader = stream.getReader()
        const decoder = new TextDecoder()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) {
              if (cancelled()) throw new Error('CANCELLED')
              await emitDelta(decoder.decode(value, { stream: true }))
            }
          }
        } finally { decoder.decode() }
        await flush(true)
        await this.messages.finalize(userId, assistantMessageId, { content, citations: [], warnings: [] })
        emitter.emit('event', { event: 'complete', data: { messageId: assistantMessageId, route: 'pet', citations: [], warnings: [] } })
      }
    } catch (error: any) {
      if (cancelled() || String(error?.message) === 'CANCELLED') {
        await flush(true)
        await this.messages.markCancelled(userId, assistantMessageId, content)
        emitter.emit('event', { event: 'cancelled', data: { messageId: assistantMessageId, text: content, reason: 'user_stopped' } })
      } else {
        await this.messages.markFailed(userId, assistantMessageId, content || '回答生成中断')
        emitter.emit('event', { event: 'error', data: { code: 'PROVIDER_UNAVAILABLE', message: '回答生成中断，请稍后重试。', retryable: true } })
        this.logger.warn(`assistant generation failed: ${error?.message}`)
      }
    } finally {
      this.cancelKeys.delete(requestId)
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-generation.test.ts`
Expected: PASS。实现已采用 Step 4 预案：`start` 在同步段注册 running/stop/emitter（首个 await 之前），`cancel` 等待 stop promise——cancel 竞态已消除，测试断言「调用 cancel 后最终消息为 cancelled 且只广播一次」。

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant-generation.service.ts notes-backend/test/assistant-generation.test.ts
git commit -m "feat(assistant): 生成编排支持幂等取消与后台续跑"
```

---

### Task 7: 控制器与模块装配（SSE 端点）

**Files:**
- Create: `notes-backend/src/modules/assistant/assistant.controller.ts`
- Create: `notes-backend/src/modules/assistant/assistant.module.ts`
- Modify: `notes-backend/src/app.module.ts`（注册 AssistantModule）
- Modify: `notes-backend/src/modules/ai/ai.module.ts`（如 Task 5 未完成则一并处理）
- Test: `notes-backend/test/assistant-controller.test.ts`（构造 controller 实例，校验 DTO 校验与 SSE 写出）

**Interfaces:**
- Consumes: `AssistantGenerationService`、`AssistantMessagesService`、`AssistantConversationsService`、`formatSseEvent`。
- Produces 端点：
  - `POST /api/assistant/chat`，body `{ conversationId?, requestId, question, knowledgeBaseId?, forceRoute? }`（DTO：`requestId`/`question` 必填，`question` ≤ 2000 字，`requestId` ≤ 128，`conversationId`/`knowledgeBaseId` 为 MongoId 可选，`forceRoute` ∈ ['pet','rag'] 可选）。响应 `text/event-stream`，写 `started/status/delta/complete|cancelled|error` 事件后 `res.end()`。
  - `POST /api/assistant/generations/:requestId/cancel`：调 `cancel(requestId, userId)`，返回 `{ cancelled: true }`。
  - `GET /api/assistant/conversations/:id/messages?afterSeq=&limit=`：返回 `{ items: AssistantMessageView[] }`。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-controller.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantController } from '../src/modules/assistant/assistant.controller'

test('chat 端点把生成事件写出为 SSE 并结束响应', async () => {
  const events: any[] = []
  const generation = {
    start: async (_input: any, emit: (event: any) => void) => {
      emit({ event: 'started', data: { conversationId: 'c1', userMessageId: 'um1', assistantMessageId: 'am1', requestId: 'r1' } })
      emit({ event: 'complete', data: { messageId: 'am1', route: 'pet', citations: [], warnings: [] } })
    },
    cancel: async () => undefined,
  }
  const messages = { list: async () => [] }
  const controller = new AssistantController(generation as any, messages as any)
  let written = ''
  const res: any = {
    setHeader: (k: string, v: string) => { res.headers = { ...(res.headers || {}), [k]: v } },
    write: (chunk: string) => { written += chunk },
    end: () => { res.ended = true },
  }
  await controller.chat({ requestId: 'r1', question: 'hi', forceRoute: 'pet' }, res, { user: { id: 'u1' } })
  assert.equal(res.headers['Content-Type'], 'text/event-stream; charset=utf-8')
  assert.ok(written.includes('event: started'))
  assert.ok(written.includes('event: complete'))
  assert.equal(res.ended, true)
})

test('cancel 端点返回取消结果', async () => {
  const generation = { start: async () => undefined, cancel: async () => undefined }
  const controller = new AssistantController(generation as any, { list: async () => [] } as any)
  const result = await controller.cancel('r1', { user: { id: 'u1' } })
  assert.deepEqual(result, { cancelled: true })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-controller.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/assistant/assistant.controller.ts
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { Throttle } from '@nestjs/throttler'
import { IsEnum, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator'
import type { Request, Response } from 'express'
import { AssistantGenerationService } from './assistant-generation.service'
import { AssistantMessagesService } from './assistant-messages.service'
import { formatSseEvent } from './assistant-stream-format'

class AssistantChatDto {
  @IsString() @MaxLength(128)
  requestId: string
  @IsString() @MaxLength(2000)
  question: string
  @IsOptional() @IsMongoId()
  conversationId?: string
  @IsOptional() @IsMongoId()
  knowledgeBaseId?: string
  @IsOptional() @IsEnum(['pet', 'rag'])
  forceRoute?: 'pet' | 'rag'
}

type AuthenticatedRequest = Request & { user?: { id?: string; _id?: string; userId?: string } }

@Throttle({ short: { ttl: 60_000, limit: 40 } })
@UseGuards(AuthGuard('jwt'))
@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly generation: AssistantGenerationService,
    private readonly messages: AssistantMessagesService,
  ) {}

  @Post('chat')
  async chat(@Body() body: AssistantChatDto, @Res() res: Response, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    const emit = (event: any) => { if (!res.writableEnded) res.write(formatSseEvent(event)) }
    // start 本身不等待生成结束（后台续跑），这里等待首个事件落定后由客户端保持连接直到终态事件。
    await this.generation.start(
      { userId, conversationId: body.conversationId, requestId: body.requestId, question: body.question, knowledgeBaseId: body.knowledgeBaseId, forceRoute: body.forceRoute },
      emit,
    )
    res.end()
  }

  @Post('generations/:requestId/cancel')
  async cancel(@Param('requestId') requestId: string, @Req() req?: AuthenticatedRequest) {
    await this.generation.cancel(requestId, this.userId(req) || '')
    return { cancelled: true }
  }

  @Get('conversations/:id/messages')
  async messages(@Param('id') id: string, @Query('afterSeq') afterSeq?: string, @Query('limit') limit?: string, @Req() req?: AuthenticatedRequest) {
    const userId = this.userId(req)
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    const items = await this.messages.list(userId, id, {
      ...(afterSeq !== undefined ? { afterSeq: Number(afterSeq) || 0 } : {}),
      ...(limit !== undefined ? { limit: Math.min(200, Number(limit) || 200) } : {}),
    })
    return { items }
  }

  private userId(req?: AuthenticatedRequest): string | undefined {
    const user = req?.user
    return user?.id || user?._id || user?.userId
  }
}
```

```ts
// notes-backend/src/modules/assistant/assistant.module.ts
import { Module, forwardRef } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AiModule } from '../ai/ai.module'
import { AssistantController } from './assistant.controller'
import { AssistantConversationsService } from './assistant-conversations.service'
import { AssistantGenerationService } from './assistant-generation.service'
import { AssistantMessagesService } from './assistant-messages.service'
import { AssistantConversation, AssistantConversationSchema } from './schemas/assistant-conversation.schema'
import { AssistantMessage, AssistantMessageSchema } from './schemas/assistant-message.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AssistantConversation.name, schema: AssistantConversationSchema },
      { name: AssistantMessage.name, schema: AssistantMessageSchema },
    ]),
    forwardRef(() => AiModule),
  ],
  controllers: [AssistantController],
  providers: [AssistantConversationsService, AssistantMessagesService, AssistantGenerationService],
  exports: [AssistantConversationsService, AssistantMessagesService],
})
export class AssistantModule { }
```

`app.module.ts`：`imports` 增加 `AssistantModule`。
`ai.module.ts`：`exports` 增加 `RagStreamService`（若 Task 5 未完成，此处一起补上）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-controller.test.ts; npm run build`
Expected: PASS；后端 TypeScript 编译通过

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant.controller.ts notes-backend/src/modules/assistant/assistant.module.ts notes-backend/src/app.module.ts notes-backend/src/modules/ai/ai.module.ts notes-backend/test/assistant-controller.test.ts
git commit -m "feat(assistant): 注册 SSE 聊天与取消端点"
```

---

### Task 8: 前端统一流式客户端

**Files:**
- Create: `notes-frontend/src/lib/assistant-stream-client.ts`
- Create: `notes-frontend/src/app/api/assistant/[...path]/route.ts`（Next 代理：`/api/assistant/*` → 后端 `/api/assistant/*`，现有 `_proxy.ts` 只覆盖 `/api/ai/*`）
- Test: `notes-frontend/__tests__/assistant-stream-client.spec.ts`

**Interfaces:**
- Produces:
  - `export type AssistantRoute = 'pet' | 'rag'`
  - `export type RagCitation = { evidenceId: string; noteId: string; noteTitle: string; chunkId: string; headingPath: string[]; excerpt: string; score?: number }`
  - `export type RagPlanSummary = { intent: string; tools: string[]; graphHops: 0 | 1; rerankApplied: boolean }`
  - `export type AssistantMessageView = { id: string; conversationId: string; seq: number; role: 'user' | 'assistant'; route: AssistantRoute; content: string; status: 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled'; requestId?: string; retryOfMessageId?: string; citations: RagCitation[]; warnings: string[]; createdAt: string; completedAt?: string }`
  - `export type AssistantStreamEvents = { onStarted?(data): void; onStatus?(stage, message): void; onDelta?(text): void; onComplete?(data): void; onCancelled?(data): void; onError?(code, message, retryable): void }`
  - `export async function streamAssistantReply(input: { conversationId?: string; requestId: string; question: string; knowledgeBaseId?: string; forceRoute?: 'pet' | 'rag' }, events: AssistantStreamEvents, signal?: AbortSignal): Promise<void>`（内部 `fetch('/api/assistant/chat', { method: 'POST', ... })`，读取响应体并解析 SSE 块；非 2xx 时解析错误 JSON 抛出稳定文案）。
  - `export async function fetchConversationMessages(conversationId: string, opts?: { afterSeq?: number }): Promise<{ items: AssistantMessageView[] }>`。
  - 代理路由 `app/api/assistant/[...path]/route.ts`：支持 `GET/POST/PATCH/DELETE`；透传 query 与 JSON body；`text/event-stream` 与 `application/x-ndjson` 响应原样透传（SSE/导出）；JSON 响应解包后端 `{ code, data }` 信封后返回；错误时回传后端 message 并保留状态码；`Authorization` 从 `notes_token` cookie 读取。

- [ ] **Step 1: 写失败测试（用可控 SSE 响应体驱动）**

```ts
// notes-frontend/__tests__/assistant-stream-client.spec.ts
import { streamAssistantReply } from '@/lib/assistant-stream-client'

function sseBody(blocks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      blocks.forEach((block) => controller.enqueue(encoder.encode(block)))
      controller.close()
    },
  })
}

test('解析 started/delta/complete 事件并依次回调', async () => {
  const calls: string[] = []
  global.fetch = jest.fn(async () => new Response(sseBody([
    'event: started\ndata: {"conversationId":"c1","userMessageId":"um1","assistantMessageId":"am1","requestId":"r1"}\n\n',
    'event: status\ndata: {"stage":"routing","message":"小助手正在回复"}\n\n',
    'event: delta\ndata: {"text":"你"}\n\n',
    'event: delta\ndata: {"text":"好"}\n\n',
    'event: complete\ndata: {"messageId":"am1","route":"pet","citations":[],"warnings":[]}\n\n',
  ]), { status: 200 })) as any

  await streamAssistantReply({ requestId: 'r1', question: 'hi' }, {
    onStarted: () => calls.push('started'),
    onStatus: () => calls.push('status'),
    onDelta: (text) => calls.push(`delta:${text}`),
    onComplete: (data) => calls.push(`complete:${data.messageId}`),
  })

  expect(calls).toEqual(['started', 'status', 'delta:你', 'delta:好', 'complete:am1'])
  expect(fetch).toHaveBeenCalledWith('/api/assistant/chat', expect.objectContaining({ method: 'POST' }))
})

test('非 2xx 时抛出稳定错误文案', async () => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ error: '请求过于频繁' }), { status: 429 })) as any
  await expect(streamAssistantReply({ requestId: 'r1', question: 'hi' }, {})).rejects.toThrow('请求过于频繁')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/assistant-stream-client.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-frontend/src/lib/assistant-stream-client.ts
'use client';

export type AssistantRoute = 'pet' | 'rag';

export type RagCitation = { evidenceId: string; noteId: string; noteTitle: string; chunkId: string; headingPath: string[]; excerpt: string; score?: number };

export type RagPlanSummary = { intent: string; tools: string[]; graphHops: 0 | 1; rerankApplied: boolean };

export type AssistantMessageView = {
  id: string; conversationId: string; seq: number; role: 'user' | 'assistant'; route: AssistantRoute;
  content: string; status: 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled';
  requestId?: string; retryOfMessageId?: string; citations: RagCitation[]; warnings: string[];
  createdAt: string; completedAt?: string;
};

export type AssistantStreamEvents = {
  onStarted?(data: { conversationId: string; userMessageId: string; assistantMessageId: string; requestId: string }): void;
  onStatus?(stage: 'routing' | 'retrieving' | 'answering', message: string): void;
  onDelta?(text: string): void;
  onComplete?(data: { messageId: string; route: AssistantRoute; citations: RagCitation[]; warnings: string[]; planSummary?: RagPlanSummary; runId?: string }): void;
  onCancelled?(data: { messageId: string; text: string; reason: string }): void;
  onError?(code: string, message: string, retryable: boolean): void;
};

type RawEvent = { event: string; data: any };

function parseBlock(block: string): RawEvent | null {
  let eventName = '';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!eventName || dataLines.length === 0) return null;
  try { return { event: eventName, data: JSON.parse(dataLines.join('\n')) }; } catch { return null; }
}

export async function streamAssistantReply(
  input: { conversationId?: string; requestId: string; question: string; knowledgeBaseId?: string; forceRoute?: 'pet' | 'rag' },
  events: AssistantStreamEvents,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const payload = await response.json();
      detail = payload?.error || payload?.message || detail;
    } catch { /* keep statusText */ }
    throw new Error(detail);
  }
  if (!response.body) throw new Error('AI service stream unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const parsed = parseBlock(block);
      if (!parsed) continue;
      switch (parsed.event) {
        case 'started': events.onStarted?.(parsed.data); break;
        case 'status': events.onStatus?.(parsed.data.stage, parsed.data.message); break;
        case 'delta': events.onDelta?.(parsed.data.text); break;
        case 'complete': events.onComplete?.(parsed.data); break;
        case 'cancelled': events.onCancelled?.(parsed.data); break;
        case 'error': events.onError?.(parsed.data.code, parsed.data.message, parsed.data.retryable); break;
      }
    }
  }
}

export async function fetchConversationMessages(conversationId: string, opts?: { afterSeq?: number }): Promise<{ items: AssistantMessageView[] }> {
  const query = new URLSearchParams();
  if (opts?.afterSeq !== undefined) query.set('afterSeq', String(opts.afterSeq));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('会话消息加载失败');
  const payload = await response.json();
  return (payload?.data && typeof payload.data === 'object' && Array.isArray(payload.data.items)) ? payload.data : payload;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/assistant-stream-client.spec.ts; npm run type-check; npm run build`
Expected: PASS；类型检查与生产构建通过（build 同时验证新代理路由可编译）

- [ ] **Step 5: 提交**

```bash
git add notes-frontend/src/lib/assistant-stream-client.ts notes-frontend/src/app/api/assistant/\[...path\]/route.ts notes-frontend/__tests__/assistant-stream-client.spec.ts
git commit -m "feat(assistant): 前端统一流式客户端与代理路由"
```

> 说明：`npm run build` 前需先停止 `next dev`（避免 `.next` 冲突），验证后重启；构建产物会包含新路由。Step 3 中代理路由实现如下：

```ts
// notes-frontend/src/app/api/assistant/[...path]/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SERVER_API_URL } from '@/lib/server/api-url'

const BACKEND_PREFIX = '/assistant'

async function buildHeaders() {
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  const cookieStore = await cookies()
  const token = cookieStore.get('notes_token')?.value
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

async function forward(request: Request, context: { params: Promise<{ path: string[] }> | { path: string[] } }, method: string) {
  const resolved = await context.params
  const segments = Array.isArray(resolved.path) ? resolved.path : []
  const query = new URL(request.url).search
  const target = `${SERVER_API_URL.replace(/\/+$/, '')}${BACKEND_PREFIX}/${segments.join('/')}${query}`
  const init: RequestInit = { method, headers: await buildHeaders(), cache: 'no-store' as RequestCache }
  if (method !== 'GET') {
    const text = await request.text()
    if (text) init.body = text
  }
  const response = await fetch(target, init)
  const contentType = response.headers.get('Content-Type') || ''
  if (contentType.includes('text/event-stream') || contentType.includes('ndjson')) {
    // SSE 与 JSONL 导出原样透传，不能解包信封。
    return new NextResponse(response.body, {
      status: response.status,
      headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    })
  }
  const text = await response.text()
  let payload: any = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { error: text } }
  if (!response.ok) {
    return NextResponse.json(
      { error: payload?.message || payload?.error || payload?.data?.message || `Backend assistant request failed with ${response.status}` },
      { status: response.status },
    )
  }
  const data = payload && typeof payload === 'object' && 'code' in payload && 'data' in payload ? payload.data : payload
  return NextResponse.json(data, { status: response.status })
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> | { path: string[] } }) { return forward(request, context, 'GET') }
export async function POST(request: Request, context: { params: Promise<{ path: string[] }> | { path: string[] } }) { return forward(request, context, 'POST') }
export async function PATCH(request: Request, context: { params: Promise<{ path: string[] }> | { path: string[] } }) { return forward(request, context, 'PATCH') }
export async function DELETE(request: Request, context: { params: Promise<{ path: string[] }> | { path: string[] } }) { return forward(request, context, 'DELETE') }
```

> 说明：本代理路由是阶段二/三/四全部 `/api/assistant/*` 端点的唯一前端入口；后续阶段新增端点（conversations 管理、search、branch、checkpoint、export、memories 等）无需再新增前端路由。

---

### Task 9: ChatWindow 迁移到服务端消息与统一协议

**Files:**
- Modify: `notes-frontend/src/components/ai/ChatWindow.tsx`（整体重写消息层）
- Modify: `notes-frontend/src/lib/ai-client.ts`（删除 `getRagAnswer`/`RagAnswer`/`RagCitation`，导出改由 `assistant-stream-client.ts` 提供；如 `RagCitation` 被其他组件引用需同步改 import）
- Modify: `notes-frontend/src/components/ai/RagCitationList.tsx`（改从 `assistant-stream-client` 引入 `RagCitation` 类型）
- Test: `notes-frontend/__tests__/ai-chat-window.spec.tsx`、`notes-frontend/__tests__/rag-chat-answer.spec.tsx`

**Interfaces:**
- Consumes: `streamAssistantReply`、`fetchConversationMessages`、`AssistantMessageView`。
- 行为契约：
  - 挂载时读取 `localStorage` 的 `assistant_current_conversation_id`；有则 `fetchConversationMessages` 拉取并按序渲染；无则空态。
  - 发送：生成 `requestId`（`crypto.randomUUID()`），先本地乐观追加 user 消息，再 `streamAssistantReply`；`onStarted` 记录 `conversationId`（写入 localStorage）与 `assistantMessageId`；`onDelta` 更新对应 assistant 消息；`onComplete` 写入 citations/warnings；`onCancelled`/`onError` 标记终态；失败时保留部分文本并给出"重新回答"（新 `requestId`，同一会话）。
  - 生成中显示"停止"按钮，点击 `POST /api/assistant/generations/:requestId/cancel`。
  - 顶部"清空"按钮改为"新建对话"：删除本地 `assistant_current_conversation_id` 并清空界面；旧会话保留在服务端（多会话管理在阶段三呈现）。
  - pet 与 rag 共用同一套逻辑，仅 `forceRoute` 与标签不同；`routeAssistantMessage` 逻辑迁移到本组件或保留在 `assistant-history.ts` 供复用。

- [ ] **Step 1: 写失败测试（先锁定新行为）**

```ts
// notes-frontend/__tests__/rag-chat-answer.spec.tsx（更新）
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import ChatWindow from '@/components/ai/ChatWindow'

// 固定顺序的 SSE 响应：started → status → delta → complete
function sseResponse(blocks: string[]): Response {
  return new Response(new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      blocks.forEach((b) => controller.enqueue(encoder.encode(b)))
      controller.close()
    },
  }), { status: 200 })
}

test('发送问题后流式呈现回答并在完成后显示引用与警告', async () => {
  const fetchMock = jest.fn(async (url: string, init?: any) => {
    if (String(url).includes('/messages')) return new Response(JSON.stringify({ items: [] }), { status: 200 })
    return sseResponse([
      'event: started\ndata: {"conversationId":"c1","userMessageId":"um1","assistantMessageId":"am1","requestId":"r1"}\n\n',
      'event: status\ndata: {"stage":"routing","message":"正在检索你的笔记"}\n\n',
      'event: delta\ndata: {"text":"结论 [E1]"}\n\n',
      'event: complete\ndata: {"messageId":"am1","route":"rag","citations":[{"evidenceId":"E1","noteId":"n1","noteTitle":"React","chunkId":"c1","headingPath":[],"excerpt":"Diff"}],"warnings":[],"planSummary":{"intent":"explain","tools":[],"graphHops":0,"rerankApplied":false}}\n\n',
    ])
  }) as any
  global.fetch = fetchMock

  render(<ChatWindow isOpen onClose={() => undefined} />)
  const textbox = screen.getByPlaceholderText('问问小助手…')
  const input = textbox as HTMLTextAreaElement
  // 触发 route=rag
  input.value = 'React Diff 是什么？'
  await waitFor(() => { fireEvent.change(input); fireEvent.keyDown(input, { key: 'Enter' }) })
  await screen.findByText(/结论 \[E1\]/)
  await screen.findByText('React')
  expect(fetchMock).toHaveBeenCalledWith('/api/assistant/chat', expect.objectContaining({ method: 'POST' }))
})
```

> 说明：`ai-chat-window.spec.tsx` 中旧的 pet 流式与重试断言同步改为新协议（`/api/assistant/chat` + `requestId`），并把"清空"改为"新建对话"后的文案断言一并更新。

- [ ] **Step 2: 运行确认失败**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/rag-chat-answer.spec.tsx __tests__/ai-chat-window.spec.tsx`
Expected: FAIL（ChatWindow 仍走旧协议/无服务端恢复）

- [ ] **Step 3: 最小实现（ChatWindow 重写消息层）**

```tsx
// notes-frontend/src/components/ai/ChatWindow.tsx（关键结构）
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Loader2, Sparkles, Square, Maximize2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { appToast } from '@/lib/app-toast';
import {
  AssistantMessageView, RagCitation, streamAssistantReply, fetchConversationMessages,
} from '@/lib/assistant-stream-client';
import RagCitationList from './RagCitationList';

const CURRENT_CONVERSATION_KEY = 'assistant_current_conversation_id';

function requestId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type LocalMessage = AssistantMessageView & { pending?: boolean };

export default function ChatWindow({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [forceNotes, setForceNotes] = useState(false);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const activeRequestIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const conversationId = localStorage.getItem(CURRENT_CONVERSATION_KEY);
    (async () => {
      if (!conversationId) return;
      try {
        const result = await fetchConversationMessages(conversationId);
        if (!active) return;
        conversationIdRef.current = conversationId;
        setMessages(result.items);
      } catch { /* 服务端不可用时保持空态 */ }
    })().finally(() => { if (active) setHydrated(true); });
    return () => { active = false; };
  }, []);

  const patchAssistant = (messageId: string, patch: Partial<LocalMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, ...patch } : m)));
  };

  const handleSend = () => {
    const content = input.trim();
    if (!content || generating) return;
    const route = forceNotes ? 'rag' : (/(我的笔记|笔记里|之前|当时|踩坑|查找|找到|搜索|哪篇|比较|区别|差异|冲突|矛盾|知识库)/i.test(content) ? 'rag' : 'pet');
    const currentRequestId = requestId();
    activeRequestIdRef.current = currentRequestId;
    setInput('');
    setGenerating(true);
    const userMessage: LocalMessage = {
      id: `local-user-${currentRequestId}`, conversationId: '', seq: 0, role: 'user', route,
      content, status: 'completed', citations: [], warnings: [], createdAt: new Date().toISOString(), pending: true,
    };
    setMessages((prev) => [...prev, userMessage]);
    let assistantId = `local-assistant-${currentRequestId}`;
    setMessages((prev) => [...prev, {
      id: assistantId, conversationId: '', seq: 0, role: 'assistant', route,
      content: '', status: 'pending', citations: [], warnings: [], createdAt: new Date().toISOString(),
    }]);

    void streamAssistantReply(
      { conversationId: conversationIdRef.current || undefined, requestId: currentRequestId, question: content, forceRoute: route },
      {
        onStarted: (data) => {
          conversationIdRef.current = data.conversationId;
          localStorage.setItem(CURRENT_CONVERSATION_KEY, data.conversationId);
          assistantId = data.assistantMessageId;
          patchAssistant(data.assistantMessageId, { id: data.assistantMessageId, conversationId: data.conversationId, status: 'streaming' });
          setMessages((prev) => prev.map((m) => (m.id === assistantId || m.id === `local-assistant-${currentRequestId}`) ? { ...m, id: data.assistantMessageId, conversationId: data.conversationId, status: 'streaming' } : m));
        },
        onDelta: (text) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text, status: 'streaming' } : m)));
        },
        onComplete: (data) => {
          patchAssistant(data.messageId, { status: 'completed', citations: data.citations, warnings: data.warnings });
        },
        onCancelled: (data) => {
          patchAssistant(data.messageId, { status: 'cancelled', content: data.text });
        },
        onError: (code, message) => {
          patchAssistant(assistantId, { status: 'failed', content: (m) => m });
        },
      },
    ).catch(() => {
      patchAssistant(assistantId, { status: 'failed' });
      appToast.error({
        id: `assistant:${currentRequestId}`, title: '小助手请求失败', message: '请检查网络后重试。', persistent: true,
        action: { label: '重试', onClick: () => { /* 以新 requestId 重发同一问题 */ } },
      });
    }).finally(() => {
      activeRequestIdRef.current = null;
      setGenerating(false);
    });
  };

  const handleStop = () => {
    const current = activeRequestIdRef.current;
    if (!current) return;
    void fetch(`/api/assistant/generations/${encodeURIComponent(current)}/cancel`, { method: 'POST' }).catch(() => undefined);
  };

  const handleNewConversation = () => {
    localStorage.removeItem(CURRENT_CONVERSATION_KEY);
    conversationIdRef.current = null;
    setMessages([]);
  };

  // 渲染逻辑沿用现有 ink-* 样式；消息来源标签、RagCitationList、warnings、输入区（Enter/Shift+Enter、搜索笔记开关）保持不变，
  // 生成中把发送按钮换成"停止"（Square 图标，aria-label="停止生成"）。
  if (!isOpen) return null;
  return (
    <aside className="ink-panel-real" aria-label="小助手">
      <div className="ink-head-real">
        <div className="ink-head-title"><span className="ink-head-mark"><Sparkles aria-hidden="true" /></span><div><h3>小助手</h3><p>闲聊，或从你的笔记中寻找答案</p></div></div>
        <div className="ink-head-actions">
          <button type="button" title="展开全屏工作台" aria-label="展开全屏工作台"><Maximize2 aria-hidden="true" /></button>
          <button type="button" onClick={handleNewConversation} title="新建对话">新建</button>
          <button type="button" onClick={onClose} aria-label="关闭小助手">×</button>
        </div>
      </div>
      <div className="ink-body-real">
        {messages.length === 0 && <div className="ink-empty-real"><span><Sparkles aria-hidden="true" /></span><h4>今天想聊点什么？</h4><p>直接聊天，或让我从你有权限访问的笔记里寻找依据。</p><div>{['帮我理清今天的想法', '找找我之前踩过的坑'].map((action) => <button key={action} type="button" onClick={() => setInput(action)}>{action}</button>)}</div></div>}
        {messages.map((message) => <div key={message.id} className={`ink-message-real ${message.role}`}>
          {message.role === 'assistant' && <div className={`ink-message-source ${message.route}`}>{message.route === 'rag' ? <BookOpen aria-hidden="true" /> : <Sparkles aria-hidden="true" />}{message.route === 'rag' ? '基于你的笔记' : '轻松聊聊'}</div>}
          <div className="prose dark:prose-invert max-w-none text-sm"><ReactMarkdown>{message.content}</ReactMarkdown></div>
          {message.status === 'failed' && <p className="ink-message-warning">回答生成中断，请重试。</p>}
          {message.citations?.length > 0 && <RagCitationList citations={message.citations} />}
          {message.warnings?.map((warning) => <p key={warning} className="ink-message-warning">{warning}</p>)}
        </div>)}
        <div ref={messagesEndRef} />
      </div>
      <div className="ink-compose-wrap">
        <button type="button" className="ink-note-toggle" aria-pressed={forceNotes} onClick={() => setForceNotes((current) => !current)}><BookOpen aria-hidden="true" />搜索笔记</button>
        <div className="ink-compose-real">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSend(); } }} placeholder="问问小助手…" />
          {generating
            ? <button type="button" onClick={handleStop} aria-label="停止生成"><Square aria-hidden="true" /></button>
            : <button type="button" onClick={handleSend} disabled={!input.trim()} aria-label="发送">↑</button>}
        </div>
      </div>
    </aside>
  );
}
```

`ai-client.ts`：删除 `RagAnswer`/`RagCitation`/`getRagAnswer`（若 `RagCitation` 被其他文件引用，改 import 自 `assistant-stream-client`）。
`RagCitationList.tsx`：`import type { RagCitation } from '@/lib/assistant-stream-client'`。

- [ ] **Step 4: 运行确认通过**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/rag-chat-answer.spec.tsx __tests__/ai-chat-window.spec.tsx __tests__/assistant-history.spec.ts __tests__/rag-citation-list.spec.tsx; npm run type-check`
Expected: PASS；TypeScript 通过

- [ ] **Step 5: 提交**

```bash
git add notes-frontend/src/components/ai/ChatWindow.tsx notes-frontend/src/lib/ai-client.ts notes-frontend/src/components/ai/RagCitationList.tsx notes-frontend/__tests__/rag-chat-answer.spec.tsx notes-frontend/__tests__/ai-chat-window.spec.tsx
git commit -m "feat(assistant): 聊天迁移到服务端消息与流式协议"
```

---

### Task 10: 阶段一全量验证

**Files:**
- 无新增（仅运行验证）

- [ ] **Step 1: 后端全量单测与编译**

Run: `npm run test:unit; npm run build`
Expected: 全部通过（含既有 262 项与新增 assistant/rag-stream/sanitize 测试）

- [ ] **Step 2: 前端全量测试与类型检查**

Run: `npm run ci:test; npm run type-check`
Expected: 全部通过；确认无组件仍在 import 已删除的 `getRagAnswer`/`RagAnswer`

- [ ] **Step 3: 手动冒烟（服务运行中）**

- 后端、前端、Redis 保持运行；用浏览器登录，打开小助手，发送"你好"，确认流式逐字出现、结束后标签为"轻松聊聊"。
- 发送"我之前的笔记结论是什么"（或开启"搜索笔记"），确认出现"正在检索笔记"→ delta 流式 → 完成后显示引用卡片。
- 生成中点"停止"，确认消息标记为已停止且保留部分文本。
- 关闭浮层再打开，确认消息从服务端恢复（不依赖 localStorage 历史）。
- 观察后端日志无异常堆栈；浏览器控制台无报错。

- [ ] **Step 4: 更新 debug 记录（如遇新坑）**

如过程中发现新坑，按 `project-debug` 规范把「现象→根因→修复→相关文件→教训」追加到 `docs/debug-records.md` 并单独提交。

- [ ] **Step 5: 提交收尾（如无代码变更则跳过）**

```bash
git status --short
git log --oneline -12
```
Expected: 工作区干净（`codex配置ar.md` 仍为未跟踪）；阶段一提交均在 `master`。

---

## Self-Review 记录

- 规格覆盖：SSE 事件协议（Task 2/5/6/7/8）、`(userId, requestId)` 幂等（Task 1 索引 + Task 6）、消息状态机 pending→streaming→completed/failed/cancelled（Task 4/6）、批量落库 500ms/200 字符（Task 6 `flush`）、断线后台续跑与重订阅（Task 6 `attach`/EventEmitter）、取消保留已生成文本（Task 6）、普通聊天不读 Chunk（Task 6 pet 分支）、稳定错误文案（Task 8/9）、旧端点保留（Global Constraints）。阶段二所需 `GET /assistant/conversations` 列表端点不在本阶段（阶段二 Task 1 新增）。
- 占位符扫描：无 TBD/TODO；所有代码步骤均给出可运行测试与实现。
- 类型一致性：`AssistantStreamEvent`（Task 2）与前端 `AssistantStreamEvents`（Task 8）字段一一对应；`RagCitation` 在 Task 3 产出、Task 4/5/8 消费；`RagPlanSummary` 在 Task 5 产出、Task 8 声明；`requestId` 幂等键在 Task 1 索引、Task 6 检查、Task 7 DTO、Task 8 客户端、Task 9 UI 中保持一致。
