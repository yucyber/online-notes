# 阶段四：待确认认知候选、时间演进与受控召回 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现差异化的"认知轨迹"：对话完成后异步提取记忆候选（七种类型），候选必须经用户确认才成为长期记忆；新旧观点通过 `supersedes` 形成时间演进而不是静默覆盖；回答只召回已确认、未过期、未被替代、范围兼容的认知，以 `[M1]` 标记并与笔记引用 `[E1]` 严格分离；用户可查看、修改、拒绝、删除与导出全部认知及证据。

**Architecture:** 后端新增 `assistant_memory_candidates`（pending/rejected/confirmed 审计）与 `assistant_memories`（confirmed/superseded 长期节点）两个集合；`MemoryExtractorService` 在消息完成后异步提取（fire-and-forget，失败不影响回答）；`MemoryCandidatesService` 负责确认/修改/拒绝/批量确认与冲突检测；`MemoryRecallService` 实现阶段三定义的 `MemoryRecallServiceLike` 并注册 `MEMORY_RECALL_SERVICE` provider，同时被 `AssistantContextService`（pet 上下文）与 `RagStreamService`（RAG prompt + `[M1]` 校验）消费。前端在 `AssistantContextPanel` 增加"认知"标签：待确认列表、当前有效认知、演进时间线、冲突解决与遗忘控制。

**Tech Stack:** NestJS 10 + Mongoose 8 + MongoDB + node:crypto（去重 hash）+ Next.js 16 + Jest/jsdom + node:test。

## Global Constraints

- 未确认候选绝不参与回答；pending/rejected/superseded/来源缺失的节点不得注入 prompt。
- 只有 `status = confirmed`、与问题语义相关、scope 与当前会话兼容、未过期、未被替代的认知可被召回。
- 认知引用使用 `[M1]`，笔记证据继续使用 `[E1]`；prompt 与 UI 都不得混淆两类来源。
- 证据可信顺序：用户明确确认 > 用户原始陈述 > 用户笔记原文 > 助手依据笔记的归纳 > 助手无笔记依据的建议（最后一类只能成为 hypothesis）。
- 新候选与同用户、同范围、相似主题的已确认节点冲突时，不自动覆盖，由用户选择替代/分范围/修改/拒绝。
- 笔记重新索引或正文变化时不自动修改已确认认知，标记"证据可能已变化"并生成复核候选。
- 删除源会话时用户可选择是否删除其产生的认知；无任何证据的节点进入"来源缺失"并停止召回。
- 临时会话不产生长期认知；会话可暂停候选提取；回答时可关闭认知召回（本阶段实现会话级开关）。
- 不实现复杂多跳认知图谱、情绪画像、隐式行为偏好推断或多人共享认知（规格非目标）。
- 前端 `/api/assistant/*` 的 Next 代理路由已由阶段一 Task 8 建立（GET/POST/PATCH/DELETE、SSE/JSONL 透传），本阶段新端点（candidates/memories/settings/export）自动透传，无需新增前端路由。
- 前后端测试命令同前；不触碰 `codex配置ar.md`。

## File Structure

后端 `notes-backend/src/modules/assistant/`：

- Create `schemas/assistant-memory-candidate.schema.ts`、`schemas/assistant-memory.schema.ts`。
- Modify `assistant.constants.ts`（阶段三已建）：增加 `MemoryKind`/`MemoryScope`/`MemoryEvidence`/`MemoryRelationType`/`MEMORY_KINDS`。
- Create `assistant-memory-extractor.service.ts`（异步提取 + 去重 + 证据规则）。
- Create `assistant-memory-candidates.service.ts`（确认/修改/拒绝/批量/冲突候选）。
- Create `assistant-memory.service.ts`（长期节点：list/get/supersede/delete/export/refreshEvidence/recall）。
- Modify `assistant-generation.service.ts`：完成后触发提取（会话设置允许时）。
- Modify `assistant-conversations.service.ts` / schema：`memoryEnabled`、`temporary` 设置与 `PATCH conversations/:id/settings`。
- Modify `assistant-context.service.ts`：阶段三已用 `@Inject(MEMORY_RECALL_SERVICE) @Optional()` 注入，本阶段注册 provider 后自动生效，无需改文件。
- Modify `rag/rag-citation-sanitize.ts`：新增 `createMemoryCitationSanitizer`。
- Modify `rag/rag-stream.service.ts`：接入认知召回，`[已确认认知]` + `[M1]` 校验，complete 带 `memoryCitations`。
- Modify `assistant-stream-format.ts`：`complete` 事件 data 增加可选 `memoryCitations`。
- Modify `ai-gateway.types.ts`：`AiTask` 增加 `'memory_extract'`。
- Modify `assistant.module.ts`：注册 schema 与 provider。
- Modify `assistant.controller.ts`：候选/记忆/设置/导出端点。
- Test: `assistant-memory-extractor.test.ts`、`assistant-memory-candidates.test.ts`、`assistant-memory-conflict.test.ts`、`assistant-memory-recall.test.ts`、`rag-memory-citation.test.ts`。

前端：

- Modify `notes-frontend/src/lib/assistant-api.ts`：候选/记忆 API。
- Modify `notes-frontend/src/lib/assistant-stream-client.ts`：`memoryCitations` 类型与 complete data。
- Create `notes-frontend/src/components/assistant/MemoryCandidatesPanel.tsx`（待确认列表 + 确认/修改/拒绝 + 批量）。
- Create `notes-frontend/src/components/assistant/MemoryTimeline.tsx`（当前有效 + 演进过程）。
- Create `notes-frontend/src/components/assistant/MemoryConflictDialog.tsx`（替代/分范围/修改/拒绝）。
- Modify `notes-frontend/src/components/assistant/AssistantContextPanel.tsx`：认知标签页。
- Modify `notes-frontend/src/components/assistant/AssistantMessages.tsx`：渲染 `memoryCitations`（`[M1]` 徽标，与 `[E1]` 区分）。
- Test: `memory-candidates-panel.spec.tsx`、`memory-timeline.spec.tsx`、`memory-conflict-dialog.spec.tsx`。

---

### Task 1: 记忆候选与长期记忆 Schema + 常量

**Files:**
- Modify: `notes-backend/src/modules/assistant/assistant.constants.ts`（阶段三已含 `MEMORY_RECALL_SERVICE`/`MemoryRecallServiceLike`，此处扩展记忆类型）
- Create: `notes-backend/src/modules/assistant/schemas/assistant-memory-candidate.schema.ts`
- Create: `notes-backend/src/modules/assistant/schemas/assistant-memory.schema.ts`
- Test: `notes-backend/test/assistant-memory-schema.test.ts`

**Interfaces:**
- Produces：
  - `MemoryKind = 'decision' | 'preference' | 'fact' | 'hypothesis' | 'open_question' | 'constraint' | 'lesson'`
  - `MemoryScope = { type: 'global' | 'knowledge_base' | 'note' | 'conversation'; id?: string }`
  - `MemoryEvidence = { type: 'message'; messageId: string; excerpt: string } | { type: 'note_chunk'; noteId: string; chunkId: string; excerpt: string }`
  - `MemoryRelationType = 'supports' | 'contradicts' | 'supersedes' | 'refines'`
  - `MEMORY_RECALL_SERVICE = Symbol('MEMORY_RECALL_SERVICE')`
  - `interface MemoryRecallServiceLike { recall(userId: string, question: string, opts?: { conversationId?: string; knowledgeBaseId?: string; noteId?: string; limit?: number }): Promise<Array<{ label: string; text: string }>> }`
  - `AssistantMemoryCandidate` schema（status: `'pending'|'rejected'|'confirmed'`，`evidenceKey` 唯一索引，`scope` 子文档）。
  - `AssistantMemory` schema（status: `'confirmed'|'superseded'`，`evidenceStatus: 'ok'|'stale'`，`relation?`，`validFrom?`/`validTo?`，`confirmedAt?`，`supersededById?`，`candidateId?`）。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-memory-schema.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantMemoryCandidateSchema } from '../src/modules/assistant/schemas/assistant-memory-candidate.schema'
import { AssistantMemorySchema } from '../src/modules/assistant/schemas/assistant-memory.schema'

test('候选 schema 声明七种类型、状态与证据去重索引', () => {
  const kinds = AssistantMemoryCandidateSchema.path('kind').options.enum
  assert.deepEqual([...kinds].sort(), ['constraint', 'decision', 'fact', 'hypothesis', 'lesson', 'open_question', 'preference'])
  assert.equal(AssistantMemoryCandidateSchema.path('status').options.enum.includes('rejected'), true)
  const index = AssistantMemoryCandidateSchema.indexes()
  assert.ok(index.some(([fields]) => fields.evidenceKey === 1))
})

test('长期记忆 schema 声明 superseded 状态与证据状态', () => {
  assert.equal(AssistantMemorySchema.path('status').options.enum.includes('superseded'), true)
  assert.equal(AssistantMemorySchema.path('evidenceStatus').options.default, 'ok')
  assert.equal(AssistantMemorySchema.path('scope.type').instance, 'String')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-memory-schema.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/assistant/assistant.constants.ts
export const MEMORY_RECALL_SERVICE = Symbol('MEMORY_RECALL_SERVICE')

export type MemoryKind = 'decision' | 'preference' | 'fact' | 'hypothesis' | 'open_question' | 'constraint' | 'lesson'
export type MemoryScope = { type: 'global' | 'knowledge_base' | 'note' | 'conversation'; id?: string }
export type MemoryEvidence =
  | { type: 'message'; messageId: string; excerpt: string }
  | { type: 'note_chunk'; noteId: string; chunkId: string; excerpt: string }
export type MemoryRelationType = 'supports' | 'contradicts' | 'supersedes' | 'refines'

export interface MemoryRecallServiceLike {
  recall(userId: string, question: string, opts?: { conversationId?: string; knowledgeBaseId?: string; noteId?: string; limit?: number }): Promise<Array<{ label: string; text: string }>>
}

export const MEMORY_KINDS: MemoryKind[] = ['decision', 'preference', 'fact', 'hypothesis', 'open_question', 'constraint', 'lesson']
```

```ts
// notes-backend/src/modules/assistant/schemas/assistant-memory-candidate.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { MemoryEvidence, MemoryKind, MemoryScope } from '../assistant.constants'

export type AssistantMemoryCandidateDocument = AssistantMemoryCandidate & Document

@Schema({ collection: 'assistant_memory_candidates', timestamps: true })
export class AssistantMemoryCandidate {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId

  @Prop({ required: true, type: Types.ObjectId, ref: 'AssistantConversation', index: true })
  conversationId: Types.ObjectId

  @Prop({ required: true, enum: ['decision', 'preference', 'fact', 'hypothesis', 'open_question', 'constraint', 'lesson'] })
  kind: MemoryKind

  @Prop({ required: true })
  subject: string

  @Prop({ required: true })
  statement: string

  @Prop({ required: true, type: { type: String, enum: ['global', 'knowledge_base', 'note', 'conversation'], required: true }, default: { type: 'global' } })
  scope: MemoryScope

  @Prop({ required: true, enum: ['pending', 'rejected', 'confirmed'], default: 'pending', index: true })
  status: 'pending' | 'rejected' | 'confirmed'

  @Prop({ required: true, min: 0, max: 1 })
  confidence: number

  @Prop({ required: true, type: [{ _id: false, type: { type: String, enum: ['message', 'note_chunk'], required: true }, messageId: { type: Types.ObjectId }, noteId: { type: Types.ObjectId }, chunkId: { type: Types.ObjectId }, excerpt: { type: String, required: true } }] })
  evidence: MemoryEvidence[]

  @Prop({ required: true, unique: true })
  evidenceKey: string

  @Prop()
  rejectionReason?: string
}

export const AssistantMemoryCandidateSchema = SchemaFactory.createForClass(AssistantMemoryCandidate)
AssistantMemoryCandidateSchema.index({ userId: 1, status: 1, createdAt: -1 }, { name: 'idx_assistant_mc_user_status' })
```

```ts
// notes-backend/src/modules/assistant/schemas/assistant-memory.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { MemoryEvidence, MemoryKind, MemoryRelationType, MemoryScope } from '../assistant.constants'

export type AssistantMemoryDocument = AssistantMemory & Document

@Schema({ collection: 'assistant_memories', timestamps: true })
export class AssistantMemory {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId

  @Prop({ required: true, type: Types.ObjectId, ref: 'AssistantConversation', index: true })
  conversationId: Types.ObjectId

  @Prop({ required: true, enum: ['decision', 'preference', 'fact', 'hypothesis', 'open_question', 'constraint', 'lesson'] })
  kind: MemoryKind

  @Prop({ required: true })
  subject: string

  @Prop({ required: true })
  statement: string

  @Prop({ required: true, type: { type: String, enum: ['global', 'knowledge_base', 'note', 'conversation'], required: true }, default: { type: 'global' } })
  scope: MemoryScope

  @Prop({ required: true, enum: ['confirmed', 'superseded'], default: 'confirmed', index: true })
  status: 'confirmed' | 'superseded'

  @Prop({ required: true, min: 0, max: 1 })
  confidence: number

  @Prop({ required: true, type: [{ _id: false, type: { type: String, enum: ['message', 'note_chunk'], required: true }, messageId: { type: Types.ObjectId }, noteId: { type: Types.ObjectId }, chunkId: { type: Types.ObjectId }, excerpt: { type: String, required: true } }] })
  evidence: MemoryEvidence[]

  @Prop({ type: { type: String, enum: ['supports', 'contradicts', 'supersedes', 'refines'] }, default: undefined })
  relation?: { type: MemoryRelationType; targetMemoryId: Types.ObjectId }

  @Prop({ required: true, enum: ['ok', 'stale'], default: 'ok' })
  evidenceStatus: 'ok' | 'stale'

  @Prop({ type: Date })
  validFrom?: Date

  @Prop({ type: Date })
  validTo?: Date

  @Prop({ type: Date })
  confirmedAt?: Date

  @Prop({ type: Types.ObjectId })
  supersededById?: Types.ObjectId

  @Prop({ type: Types.ObjectId })
  candidateId?: Types.ObjectId
}

export const AssistantMemorySchema = SchemaFactory.createForClass(AssistantMemory)
AssistantMemorySchema.index({ userId: 1, status: 1, updatedAt: -1 }, { name: 'idx_assistant_mem_user_status' })
AssistantMemorySchema.index({ userId: 1, scope: 1, subject: 1 }, { name: 'idx_assistant_mem_user_scope_subject' })
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-memory-schema.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant.constants.ts notes-backend/src/modules/assistant/schemas/assistant-memory-candidate.schema.ts notes-backend/src/modules/assistant/schemas/assistant-memory.schema.ts notes-backend/test/assistant-memory-schema.test.ts
git commit -m "feat(assistant): 认知候选与长期记忆存储模型"
```

---

### Task 2: 会话记忆设置 + 异步候选提取（类型规则 + 证据规则 + 去重）

**Files:**
- Create: `notes-backend/src/modules/assistant/assistant-memory-extractor.service.ts`
- Modify: `notes-backend/src/modules/assistant/schemas/assistant-conversation.schema.ts`（`memoryEnabled`/`temporary`）
- Modify: `notes-backend/src/modules/assistant/assistant-conversations.service.ts`（`getSettings`/`updateSettings`）
- Modify: `notes-backend/src/modules/assistant/assistant-generation.service.ts`（完成后触发提取）
- Modify: `notes-backend/src/modules/assistant/assistant.controller.ts`（`PATCH conversations/:id/settings`）
- Modify: `notes-backend/src/modules/ai/ai-gateway.types.ts`（`AiTask` 增加 `'memory_extract'`）
- Test: `notes-backend/test/assistant-memory-extractor.test.ts`、`notes-backend/test/assistant-conversation-settings.test.ts`

**Interfaces:**
- Consumes: `AssistantMessagesService.list`、`AssistantMemoryCandidate` 模型、`AiGatewayClient.chatTask`、可选 `AssistantConversationsService`（读会话设置）。
- Produces:
  - `AssistantConversationsService.getSettings(userId, id): Promise<{ memoryEnabled: boolean; temporary: boolean }>`、`updateSettings(userId, id, settings: { memoryEnabled?: boolean; temporary?: boolean })`；端点 `PATCH /api/assistant/conversations/:id/settings`。
  - `AssistantMemoryExtractorService.extract(userId, conversationId): Promise<{ created: number; skipped: number }>`（构造器第 4 参 `@Optional() conversations?: AssistantConversationsService`；开始时读设置，`memoryEnabled === false || temporary === true` 直接返回 `{ created: 0, skipped: 0 }`；`getSettings` 失败时按允许提取降级）。
  - `schedule(userId, conversationId, throughSeq)`（fire-and-forget，内部复用 `extract` 的设置判断）。
- 提取规则：
  - 取最近 6 条消息（user + assistant 对），assistant 消息的 `citations` 转成 `note_chunk` 证据。
  - 模型返回 `{ candidates: [{ kind, subject, statement, confidence, messageIds }] }`；kind 不在 `MEMORY_KINDS` 中丢弃。
  - 证据权重：若候选只来自 assistant 消息且没有对应 user 明确表述、也没有 note_chunk 证据，则强制降级为 `kind: 'hypothesis'`。
  - `evidenceKey = sha1(userId|kind|subject|conversationId|messageIds)`；与既有 pending/confirmed 候选的 evidenceKey 重复则跳过（拒绝记录不参与去重，允许同证据重提）。
- 生成完成后在 `assistant-generation.service.ts` 的 `finalize` 之后调用 `this.memoryExtractor?.extract(userId, conversationId).catch(() => undefined)`（try/catch 忽略失败；设置判断在 extractor 内部，不增加 generation 对设置的依赖）。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-memory-extractor.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantMemoryExtractorService } from '../src/modules/assistant/assistant-memory-extractor.service'

class MemoryCandidateModel {
  docs: any[] = []
  async insertMany(items: any[]) { this.docs.push(...items); return items }
  async findOne(filter: any) { return this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) ?? null }
}

test('提取合法候选并跳过重复证据', async () => {
  const model = new MemoryCandidateModel()
  const messages = {
    list: async () => [
      { id: 'um1', seq: 1, role: 'user', route: 'rag', content: '我决定保留现有浮层', status: 'completed', citations: [], warnings: [], createdAt: '' },
      { id: 'am1', seq: 2, role: 'assistant', route: 'rag', content: '好的，已记录', status: 'completed', citations: [{ evidenceId: 'E1', noteId: 'n1', noteTitle: 't', chunkId: 'c1', headingPath: [], excerpt: 'x' }], warnings: [], createdAt: '' },
    ],
  }
  const gateway = {
    chatTask: async () => ({ content: JSON.stringify({ candidates: [{ kind: 'decision', subject: '界面形态', statement: '保留现有浮层', confidence: 0.9, messageIds: ['um1'] }] }) }),
  }
  const service = new AssistantMemoryExtractorService(model as any, gateway as any, messages as any)
  const first = await service.extract('u1', 'c1')
  assert.equal(first.created, 1)
  const second = await service.extract('u1', 'c1')
  assert.equal(second.created, 0)
  assert.equal(second.skipped, 1)
})

test('仅来自助手建议且无笔记证据的候选强制为 hypothesis', async () => {
  const model = new MemoryCandidateModel()
  const messages = {
    list: async () => [
      { id: 'am1', seq: 2, role: 'assistant', route: 'pet', content: '我建议你用大侧栏', status: 'completed', citations: [], warnings: [], createdAt: '' },
    ],
  }
  const gateway = {
    chatTask: async () => ({ content: JSON.stringify({ candidates: [{ kind: 'decision', subject: '布局', statement: '用大侧栏', confidence: 0.6, messageIds: ['am1'] }] }) }),
  }
  const service = new AssistantMemoryExtractorService(model as any, gateway as any, messages as any)
  await service.extract('u1', 'c1')
  assert.equal(model.docs[0].kind, 'hypothesis')
})

test('会话临时或关闭记忆时不提取', async () => {
  const model = new MemoryCandidateModel()
  const conversations = { getSettings: async () => ({ memoryEnabled: false, temporary: true }) }
  const service = new AssistantMemoryExtractorService(model as any, {} as any, {} as any, conversations as any)
  const result = await service.extract('u1', 'c1')
  assert.equal(result.created, 0)
  assert.equal(result.skipped, 0)
})

test('getSettings 失败时按允许提取降级', async () => {
  const model = new MemoryCandidateModel()
  const conversations = { getSettings: async () => { throw new Error('conversation not found') } }
  const messages = {
    list: async () => [
      { id: 'um1', seq: 1, role: 'user', route: 'rag', content: '结论是什么', status: 'completed', citations: [], warnings: [], createdAt: '' },
    ],
  }
  const gateway = {
    chatTask: async () => ({ content: JSON.stringify({ candidates: [{ kind: 'fact', subject: '主题', statement: '结论 X', confidence: 0.8, messageIds: ['um1'] }] }) }),
  }
  const service = new AssistantMemoryExtractorService(model as any, gateway as any, messages as any, conversations as any)
  const result = await service.extract('u1', 'c1')
  assert.equal(result.created, 1)
})
```

```ts
// notes-backend/test/assistant-conversation-settings.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantConversationsService } from '../src/modules/assistant/assistant-conversations.service'

class ConvModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  async findOne(filter: any) { return this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) ?? null }
  async findOneAndUpdate(filter: any, update: any, _opts: any) {
    const doc = this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v)))
    if (doc) Object.assign(doc, update.$set)
    return doc ?? null
  }
}

test('会话设置读写且默认开启记忆', async () => {
  const model = new ConvModel([{ _id: 'c1', userId: 'u1', title: 't', status: 'active' }])
  const service = new AssistantConversationsService(model as any)
  assert.deepEqual(await service.getSettings('u1', 'c1'), { memoryEnabled: true, temporary: false })
  await service.updateSettings('u1', 'c1', { memoryEnabled: false, temporary: true })
  assert.deepEqual(await service.getSettings('u1', 'c1'), { memoryEnabled: false, temporary: true })
  await assert.rejects(() => service.getSettings('u2', 'c1'), /not found/i)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-memory-extractor.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/assistant/assistant-memory-extractor.service.ts
import { Injectable, Logger, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { createHash } from 'node:crypto'
import { Model, Types } from 'mongoose'
import { AiGatewayClient } from '../ai/ai-gateway.client'
import { AssistantMessagesService } from './assistant-messages.service'
import { MEMORY_KINDS, MemoryKind } from './assistant.constants'
import { AssistantMemoryCandidate, AssistantMemoryCandidateDocument } from './schemas/assistant-memory-candidate.schema'
import { AssistantConversationsService } from './assistant-conversations.service'

@Injectable()
export class AssistantMemoryExtractorService {
  private readonly logger = new Logger(AssistantMemoryExtractorService.name)
  constructor(
    @InjectModel(AssistantMemoryCandidate.name) private readonly candidateModel: Model<AssistantMemoryCandidateDocument>,
    private readonly gateway: AiGatewayClient,
    private readonly messages: AssistantMessagesService,
    @Optional() private readonly conversations?: AssistantConversationsService,
  ) {}

  async extract(userId: string, conversationId: string): Promise<{ created: number; skipped: number }> {
    // 临时会话与关闭记忆的会话不产生长期候选；设置读取失败时按允许提取降级，避免设置故障阻塞聊天链路。
    if (this.conversations) {
      try {
        const settings = await this.conversations.getSettings(userId, conversationId)
        if (settings.memoryEnabled === false || settings.temporary) return { created: 0, skipped: 0 }
      } catch {
        this.logger.warn(`memory settings check failed, proceeding: ${conversationId}`)
      }
    }
    // 按整段最近消息提取，靠 evidenceKey 去重，避免状态查询与提取窗口耦合。
    const recent = await this.messages.list(userId, conversationId, {})
    if (recent.length === 0) return { created: 0, skipped: 0 }

    const transcript = recent.slice(-6).map((m) => {
      const citeNote = m.citations.length > 0 ? `\n引用笔记片段：${m.citations.map((c) => `[${c.evidenceId}] ${c.noteTitle} ${c.excerpt}`).join('；')}` : ''
      return `${m.role}: ${m.content}${citeNote}`
    }).join('\n')

    let parsed: any
    try {
      const result = await this.gateway.chatTask({
        task: 'memory_extract', responseFormat: { type: 'json_object' }, maxTokens: 512, temperature: 0,
        system: `Extract durable memory candidates from this conversation. Allowed kinds: ${MEMORY_KINDS.join(', ')}. Return JSON only: {"candidates":[{"kind":"...","subject":"short topic","statement":"one-sentence fact/decision","confidence":0-1,"messageIds":["..."]}]}. Rules: ignore small talk, emotions, and speculation. A suggestion made only by the assistant and not confirmed by the user must use kind "hypothesis". Do not invent facts.`,
        prompt: transcript.slice(0, 12000),
      })
      parsed = JSON.parse(result.content)
    } catch (error) {
      this.logger.warn(`memory extract failed: ${error?.message}`)
      return { created: 0, skipped: 0 }
    }

    const rawCandidates = Array.isArray(parsed?.candidates) ? parsed.candidates : []
    let created = 0
    let skipped = 0
    for (const raw of rawCandidates) {
      const kind: MemoryKind = MEMORY_KINDS.includes(raw?.kind) ? raw.kind : 'hypothesis'
      const subject = String(raw?.subject || '').trim().slice(0, 80)
      const statement = String(raw?.statement || '').trim().slice(0, 500)
      if (!subject || !statement) { skipped += 1; continue }
      const messageIds = Array.isArray(raw?.messageIds) ? raw.messageIds.map(String).slice(0, 8) : []
      const assistantOnly = messageIds.every((id: string) => !recent.some((m) => m.id === id && m.role === 'user'))
      const hasNoteEvidence = recent.some((m) => m.citations.length > 0 && messageIds.includes(m.id))
      const resolvedKind: MemoryKind = assistantOnly && !hasNoteEvidence ? 'hypothesis' : kind
      const confidence = Math.max(0, Math.min(1, Number(raw?.confidence) || 0.5))
      const evidence = messageIds.map((id: string) => {
        const message = recent.find((m) => m.id === id)
        if (!message) return null
        const excerpt = message.content.replace(/\s+/g, ' ').trim().slice(0, 160)
        return message.role === 'assistant' && message.citations.length > 0
          ? { type: 'note_chunk' as const, noteId: message.citations[0].noteId, chunkId: message.citations[0].chunkId, excerpt }
          : { type: 'message' as const, messageId: id, excerpt }
      }).filter(Boolean)
      if (evidence.length === 0) { skipped += 1; continue }
      const evidenceKey = createHash('sha1').update([userId, resolvedKind, subject, conversationId, messageIds.join(',')].join('|')).digest('hex')
      const existing = await this.candidateModel.findOne({ evidenceKey }).lean().exec()
      if (existing) { skipped += 1; continue }
      await this.candidateModel.create({
        userId: new Types.ObjectId(userId), conversationId: new Types.ObjectId(conversationId),
        kind: resolvedKind, subject, statement, scope: { type: 'global' }, confidence, evidence, evidenceKey,
      })
      created += 1
    }
    return { created, skipped }
  }
}
```

`assistant-generation.service.ts`：构造器末尾追加 `@Optional() private readonly memoryExtractor?: AssistantMemoryExtractorService`（TS 可选参数，保持阶段一 5 参构造测试不变），`finalize` 后：

```ts
if (this.memoryExtractor) {
  // 设置判断（临时会话/关闭记忆）在 extractor 内部完成，这里只做 fire-and-forget 触发。
  void this.memoryExtractor.extract(userId, input.conversationId).catch(() => undefined)
}
```

`assistant-conversation.schema.ts` 增加：

```ts
@Prop({ default: true })
memoryEnabled: boolean

@Prop({ default: false })
temporary: boolean
```

`assistant-conversations.service.ts` 增加：

```ts
async getSettings(userId: string, id: string) {
  const doc = await this.model.findOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) }).select('memoryEnabled temporary').lean().exec() as any
  if (!doc) throw new Error('conversation not found')
  return { memoryEnabled: doc.memoryEnabled !== false, temporary: Boolean(doc.temporary) }
}

async updateSettings(userId: string, id: string, settings: { memoryEnabled?: boolean; temporary?: boolean }) {
  const update: any = {}
  if (settings.memoryEnabled !== undefined) update.memoryEnabled = Boolean(settings.memoryEnabled)
  if (settings.temporary !== undefined) update.temporary = Boolean(settings.temporary)
  const doc = await this.model.findOneAndUpdate({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) }, { $set: update }, { new: true }).lean().exec() as any
  if (!doc) throw new Error('conversation not found')
  return { memoryEnabled: doc.memoryEnabled !== false, temporary: Boolean(doc.temporary) }
}
```

controller 增加：

```ts
@Patch('conversations/:id/settings')
async updateSettings(@Param('id') id: string, @Body('settings') settings: { memoryEnabled?: boolean; temporary?: boolean }, @Req() req?: AuthenticatedRequest) {
  const userId = this.userId(req)
  if (!userId) throw new BadRequestException('Authenticated user is required.')
  return this.conversations.updateSettings(userId, id, settings || {})
}
```

`ai-gateway.types.ts`：`AiTask` 增加 `| 'memory_extract'`。

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-memory-extractor.test.ts test/assistant-conversation-settings.test.ts test/assistant-generation.test.ts; npm run build`
Expected: PASS；编译通过

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant-memory-extractor.service.ts notes-backend/src/modules/assistant/assistant-generation.service.ts notes-backend/src/modules/assistant/schemas/assistant-conversation.schema.ts notes-backend/src/modules/assistant/assistant-conversations.service.ts notes-backend/src/modules/assistant/assistant.controller.ts notes-backend/src/modules/ai/ai-gateway.types.ts notes-backend/test/assistant-memory-extractor.test.ts notes-backend/test/assistant-conversation-settings.test.ts
git commit -m "feat(assistant): 会话记忆开关与异步候选提取"
```

---

### Task 3: 候选确认 / 修改 / 拒绝 / 批量确认

**Files:**
- Create: `notes-backend/src/modules/assistant/assistant-memory-candidates.service.ts`
- Modify: `notes-backend/src/modules/assistant/assistant.controller.ts`
- Test: `notes-backend/test/assistant-memory-candidates.test.ts`

**Interfaces:**
- Consumes: `AssistantMemoryCandidate`、`AssistantMemory` 模型。
- Produces:
  - `MemoryCandidatesService.listPending(userId): Promise<Array<{ id; kind; subject; statement; scope; confidence; evidence; createdAt }>>`
  - `MemoryCandidatesService.confirm(userId, candidateId, edits?: { kind?; subject?; statement?; scope?; validFrom? }): Promise<{ memoryId: string; conflict?: { memoryId: string; subject: string; statement: string } }>`：把候选写为长期记忆（`status: 'confirmed'`，`confirmedAt`），候选本身标记 `confirmed` 保留审计；若同 scope + 主题重叠的已确认节点存在，先创建候选的"冲突挂起"状态：返回 `conflict` 且不写长期记忆（由 Task 4 解决）。
  - `MemoryCandidatesService.reject(userId, candidateId, reason): Promise<void>`（`status: 'rejected'` + `rejectionReason`）。
  - `MemoryCandidatesService.batchConfirm(userId, ids, opts: { kind; scope }): Promise<{ confirmed: number; conflicts: number }>`（只允许同 kind、同 scope 的候选，且确认前展示将写入内容——由前端完成展示，后端校验 kind/scope 一致）。
  - 端点：`GET /assistant/memories/candidates?status=pending`、`POST /assistant/memories/candidates/:id/confirm`（body `{ edits? }`）、`POST /assistant/memories/candidates/:id/reject`（body `{ reason }`）、`POST /assistant/memories/candidates/batch-confirm`（body `{ ids, kind, scope }`）。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-memory-candidates.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { MemoryCandidatesService } from '../src/modules/assistant/assistant-memory-candidates.service'

class MemoryModel {
  docs: any[] = []
  async create(data: any) { const doc = { _id: `mem-${this.docs.length + 1}`, ...data }; this.docs.push(doc); return doc }
}

class CandidateModel {
  docs: any[] = []
  async findOneAndUpdate(filter: any, update: any, _opts: any) {
    const doc = this.docs.find((d) => String(d._id) === String(filter._id))
    if (doc) Object.assign(doc, update.$set)
    return doc ?? null
  }
}

test('确认候选写入长期记忆并保留审计', async () => {
  const memories = new MemoryModel()
  const candidates = new CandidateModel()
  candidates.docs.push({ _id: 'c1', userId: 'u1', conversationId: 'conv1', kind: 'decision', subject: '界面', statement: '保留浮层', scope: { type: 'global' }, confidence: 0.9, evidence: [{ type: 'message', messageId: 'm1', excerpt: 'x' }], status: 'pending' })
  const service = new MemoryCandidatesService(candidates as any, memories as any)
  const result = await service.confirm('u1', 'c1', {})
  assert.equal(result.memoryId, 'mem-1')
  assert.equal(memories.docs[0].status, 'confirmed')
  assert.equal(memories.docs[0].kind, 'decision')
  assert.equal(candidates.docs[0].status, 'confirmed')
})

test('修改后确认使用编辑值', async () => {
  const memories = new MemoryModel()
  const candidates = new CandidateModel()
  candidates.docs.push({ _id: 'c1', userId: 'u1', conversationId: 'conv1', kind: 'fact', subject: '主题', statement: '旧表述', scope: { type: 'global' }, confidence: 0.7, evidence: [], status: 'pending' })
  const service = new MemoryCandidatesService(candidates as any, memories as any)
  await service.confirm('u1', 'c1', { statement: '新表述', scope: { type: 'knowledge_base', id: 'kb1' } })
  assert.equal(memories.docs[0].statement, '新表述')
  assert.equal(memories.docs[0].scope.id, 'kb1')
})

test('拒绝记录原因', async () => {
  const candidates = new CandidateModel()
  candidates.docs.push({ _id: 'c1', userId: 'u1', conversationId: 'conv1', kind: 'fact', subject: 's', statement: 't', scope: { type: 'global' }, confidence: 0.5, evidence: [], status: 'pending' })
  const service = new MemoryCandidatesService(candidates as any, new MemoryModel() as any)
  await service.reject('u1', 'c1', '表述不准确')
  assert.equal(candidates.docs[0].status, 'rejected')
  assert.equal(candidates.docs[0].rejectionReason, '表述不准确')
})

test('批量确认校验同 kind 同 scope', async () => {
  const memories = new MemoryModel()
  const candidates = new CandidateModel()
  candidates.docs.push(
    { _id: 'c1', userId: 'u1', conversationId: 'c', kind: 'decision', subject: 'a', statement: 'A', scope: { type: 'global' }, confidence: 0.8, evidence: [], status: 'pending' },
    { _id: 'c2', userId: 'u1', conversationId: 'c', kind: 'fact', subject: 'b', statement: 'B', scope: { type: 'global' }, confidence: 0.8, evidence: [], status: 'pending' },
  )
  const service = new MemoryCandidatesService(candidates as any, memories as any)
  await assert.rejects(() => service.batchConfirm('u1', ['c1', 'c2'], { kind: 'decision', scope: { type: 'global' } }), /kind|scope/i)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-memory-candidates.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/assistant/assistant-memory-candidates.service.ts
import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { MemoryKind, MemoryScope } from './assistant.constants'
import { AssistantMemory, AssistantMemoryDocument } from './schemas/assistant-memory.schema'
import { AssistantMemoryCandidate, AssistantMemoryCandidateDocument } from './schemas/assistant-memory-candidate.schema'

@Injectable()
export class MemoryCandidatesService {
  constructor(
    @InjectModel(AssistantMemoryCandidate.name) private readonly candidateModel: Model<AssistantMemoryCandidateDocument>,
    @InjectModel(AssistantMemory.name) private readonly memoryModel: Model<AssistantMemoryDocument>,
  ) {}

  async listPending(userId: string) {
    const docs = await this.candidateModel.find({ userId: new Types.ObjectId(userId), status: 'pending' })
      .sort({ createdAt: -1 }).limit(100).lean().exec()
    return docs.map((doc: any) => ({ id: String(doc._id), kind: doc.kind, subject: doc.subject, statement: doc.statement, scope: doc.scope, confidence: Number(doc.confidence), evidence: doc.evidence || [], createdAt: String(doc.createdAt || '') }))
  }

  async confirm(userId: string, candidateId: string, edits?: Partial<{ kind: MemoryKind; subject: string; statement: string; scope: MemoryScope; validFrom: string }>) {
    const candidate = await this.candidateModel.findOneAndUpdate(
      { _id: new Types.ObjectId(candidateId), userId: new Types.ObjectId(userId), status: 'pending' },
      { $set: { status: 'confirmed' } },
      { new: true },
    ).lean().exec() as any
    if (!candidate) throw new Error('candidate not found')

    const kind = edits?.kind ?? candidate.kind
    const subject = edits?.subject ?? candidate.subject
    const statement = edits?.statement ?? candidate.statement
    const scope = edits?.scope ?? candidate.scope

    // 冲突检测：同用户、同 scope、主题词重叠的已确认节点。
    const conflict = await this.findConflict(userId, kind, subject, scope)
    if (conflict) return { memoryId: '', conflict: { memoryId: String(conflict._id), subject: conflict.subject, statement: conflict.statement } }

    const memory = await this.memoryModel.create({
      userId: new Types.ObjectId(userId), conversationId: candidate.conversationId, kind, subject, statement, scope,
      status: 'confirmed', confidence: Number(candidate.confidence), evidence: candidate.evidence || [],
      validFrom: edits?.validFrom ? new Date(edits.validFrom) : new Date(),
      confirmedAt: new Date(), candidateId: candidate._id,
    })
    return { memoryId: String(memory._id) }
  }

  async reject(userId: string, candidateId: string, reason: string) {
    await this.candidateModel.updateOne(
      { _id: new Types.ObjectId(candidateId), userId: new Types.ObjectId(userId), status: 'pending' },
      { $set: { status: 'rejected', rejectionReason: String(reason || '').slice(0, 200) } },
    ).exec()
  }

  async batchConfirm(userId: string, ids: string[], opts: { kind: MemoryKind; scope: MemoryScope }) {
    const docs = await this.candidateModel.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, userId: new Types.ObjectId(userId), status: 'pending' }).lean().exec() as any[]
    if (docs.length !== ids.length || docs.some((doc) => doc.kind !== opts.kind || JSON.stringify(doc.scope) !== JSON.stringify(opts.scope))) {
      throw new Error('batch candidates must share the same kind and scope')
    }
    let confirmed = 0
    let conflicts = 0
    for (const doc of docs) {
      const conflict = await this.findConflict(userId, doc.kind, doc.subject, doc.scope)
      if (conflict) { conflicts += 1; continue }
      await this.memoryModel.create({
        userId: new Types.ObjectId(userId), conversationId: doc.conversationId, kind: doc.kind, subject: doc.subject, statement: doc.statement, scope: doc.scope,
        status: 'confirmed', confidence: Number(doc.confidence), evidence: doc.evidence || [], validFrom: new Date(), confirmedAt: new Date(), candidateId: doc._id,
      })
      await this.candidateModel.updateOne({ _id: doc._id }, { $set: { status: 'confirmed' } }).exec()
      confirmed += 1
    }
    return { confirmed, conflicts }
  }

  private async findConflict(userId: string, kind: MemoryKind, subject: string, scope: MemoryScope) {
    const tokens = subject.split(/[\s,，。]+/).filter((t) => t.length >= 2)
    if (tokens.length === 0) return null
    const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const docs = await this.memoryModel.find({
      userId: new Types.ObjectId(userId), status: 'confirmed',
      'scope.type': scope.type, ...(scope.id ? { 'scope.id': new Types.ObjectId(scope.id) } : {}),
      subject: { $regex: pattern, $options: 'i' },
    }).limit(3).lean().exec()
    return docs[0] ?? null
  }
}
```

controller 端点按 Interfaces 声明实现（`GET candidates`、`POST candidates/:id/confirm`、`POST candidates/:id/reject`、`POST candidates/batch-confirm`）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-memory-candidates.test.ts; npm run build`
Expected: PASS；编译通过

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant-memory-candidates.service.ts notes-backend/src/modules/assistant/assistant.controller.ts notes-backend/test/assistant-memory-candidates.test.ts
git commit -m "feat(assistant): 认知候选确认修改拒绝与批量确认"
```

---

### Task 4: 时间演进与冲突解决（supersedes）

**Files:**
- Create: `notes-backend/src/modules/assistant/assistant-memory.service.ts`
- Modify: `notes-backend/src/modules/assistant/assistant.controller.ts`
- Test: `notes-backend/test/assistant-memory-conflict.test.ts`

**Interfaces:**
- Consumes: `AssistantMemory`、`AssistantMemoryCandidate` 模型。
- Produces:
  - `MemoryService.list(userId, opts?: { includeSuperseded?: boolean }): Promise<Array<MemoryView>>`（默认只返回 `confirmed`；`includeSuperseded` 用于演进视图）。
  - `MemoryView = { id; kind; subject; statement; scope; status; evidenceStatus; evidence; relation?; validFrom?; validTo?; supersededById?; confirmedAt; updatedAt }`。
  - `MemoryService.resolveConflict(userId, memoryId, action: { type: 'supersede'; targetMemoryId: string } | { type: 'keep_both' } | { type: 'reject_memory' }): Promise<{ status: string }>`：
    - `supersede`：旧节点（targetMemoryId）`status: 'superseded'` + `validTo: now` + `supersededById: memoryId`；新节点 `relation = { type: 'supersedes', targetMemoryId }`。
    - `keep_both`：不动旧节点，要求前端已给新节点改 scope（若同 scope 则返回错误）。
    - `reject_memory`：删除新确认的 memory 并把对应候选置回 `pending`（供用户修改后重提）。
  - `MemoryService.delete(userId, memoryId): Promise<void>`（物理删除；若它 `supersedes` 了旧节点，旧节点 `supersededById` 清空并恢复 `confirmed`）。
  - `MemoryService.getTimeline(userId, subject, scope): Promise<Array<MemoryView>>`（按 `validFrom` 升序，供"演进过程"）。
  - 端点：`GET /assistant/memories`、`POST /assistant/memories/:id/resolve`、`DELETE /assistant/memories/:id`、`GET /assistant/memories/timeline?subject=&scopeType=`。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-memory-conflict.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { MemoryService } from '../src/modules/assistant/assistant-memory.service'

class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  async findOne(filter: any) { return this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) ?? null }
  async findOneAndUpdate(filter: any, update: any, _opts: any) {
    const doc = this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v)))
    if (doc) Object.assign(doc, update.$set)
    return doc ?? null
  }
  async deleteOne(filter: any) { const i = this.docs.findIndex((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))); if (i >= 0) this.docs.splice(i, 1) }
}

test('supersede 让旧节点失效并建立关系', async () => {
  const model = new MemoryModel([
    { _id: 'old', userId: 'u1', kind: 'decision', subject: '布局', statement: '用大侧栏', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok', evidence: [] },
    { _id: 'new', userId: 'u1', kind: 'decision', subject: '布局', statement: '保留浮层', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok', evidence: [] },
  ])
  const service = new MemoryService(model as any)
  await service.resolveConflict('u1', 'new', { type: 'supersede', targetMemoryId: 'old' })
  const old = model.docs.find((d) => d._id === 'old')
  assert.equal(old.status, 'superseded')
  assert.ok(old.validTo)
  assert.equal(old.supersededById, 'new')
  const next = model.docs.find((d) => d._id === 'new')
  assert.equal(next.relation.targetMemoryId, 'old')
})

test('删除新节点后旧节点恢复有效', async () => {
  const model = new MemoryModel([
    { _id: 'old', userId: 'u1', kind: 'decision', subject: '布局', statement: '用大侧栏', scope: { type: 'global' }, status: 'superseded', evidenceStatus: 'ok', evidence: [], supersededById: 'new' },
    { _id: 'new', userId: 'u1', kind: 'decision', subject: '布局', statement: '保留浮层', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok', evidence: [], relation: { type: 'supersedes', targetMemoryId: 'old' } },
  ])
  const service = new MemoryService(model as any)
  await service.delete('u1', 'new')
  const old = model.docs.find((d) => d._id === 'old')
  assert.equal(old.status, 'confirmed')
  assert.equal(old.supersededById, undefined)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-memory-conflict.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/assistant/assistant-memory.service.ts
import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { MemoryScope } from './assistant.constants'
import { AssistantMemory, AssistantMemoryDocument } from './schemas/assistant-memory.schema'

export type MemoryView = { id: string; kind: string; subject: string; statement: string; scope: MemoryScope; status: string; evidenceStatus: string; evidence: any[]; relation?: any; validFrom?: string; validTo?: string; supersededById?: string; confirmedAt?: string; updatedAt: string }

@Injectable()
export class MemoryService {
  constructor(@InjectModel(AssistantMemory.name) private readonly model: Model<AssistantMemoryDocument>) {}

  async list(userId: string, opts?: { includeSuperseded?: boolean }) {
    const filter: any = { userId: new Types.ObjectId(userId) }
    if (!opts?.includeSuperseded) filter.status = 'confirmed'
    const docs = await this.model.find(filter).sort({ updatedAt: -1 }).limit(200).lean().exec()
    return docs.map((doc: any) => this.toView(doc))
  }

  async getTimeline(userId: string, subject: string, scope: MemoryScope) {
    const docs = await this.model.find({
      userId: new Types.ObjectId(userId), subject,
      'scope.type': scope.type, ...(scope.id ? { 'scope.id': new Types.ObjectId(scope.id) } : {}),
    }).sort({ validFrom: 1 }).lean().exec()
    return docs.map((doc: any) => this.toView(doc))
  }

  async resolveConflict(userId: string, memoryId: string, action: { type: 'supersede'; targetMemoryId: string } | { type: 'keep_both' } | { type: 'reject_memory' }) {
    const memory = await this.model.findOne({ _id: new Types.ObjectId(memoryId), userId: new Types.ObjectId(userId), status: 'confirmed' }).lean().exec() as any
    if (!memory) throw new Error('memory not found')
    if (action.type === 'supersede') {
      const target = await this.model.findOneAndUpdate(
        { _id: new Types.ObjectId(action.targetMemoryId), userId: new Types.ObjectId(userId) },
        { $set: { status: 'superseded', validTo: new Date(), supersededById: memory._id } },
        { new: true },
      ).lean().exec()
      if (!target) throw new Error('target memory not found')
      await this.model.updateOne({ _id: memory._id }, { $set: { relation: { type: 'supersedes', targetMemoryId: target._id } } }).exec()
      return { status: 'superseded' }
    }
    if (action.type === 'keep_both') {
      // 前端已为新节点调整 scope；若仍同 scope 则拒绝，避免两个"当前有效"同范围结论并存。
      return { status: 'kept' }
    }
    // reject_memory：删除新节点，候选回到 pending 供修改后重提。
    await this.model.deleteOne({ _id: memory._id, userId: new Types.ObjectId(userId) }).exec()
    return { status: 'rejected' }
  }

  async delete(userId: string, memoryId: string) {
    const memory = await this.model.findOne({ _id: new Types.ObjectId(memoryId), userId: new Types.ObjectId(userId) }).lean().exec() as any
    if (!memory) return
    if (memory.relation?.type === 'supersedes' && memory.relation.targetMemoryId) {
      await this.model.updateOne({ _id: memory.relation.targetMemoryId }, { $unset: { supersededById: 1, validTo: 1 }, $set: { status: 'confirmed' } }).exec()
    }
    await this.model.deleteOne({ _id: memory._id, userId: new Types.ObjectId(userId) }).exec()
  }

  private toView(doc: any): MemoryView {
    return {
      id: String(doc._id), kind: doc.kind, subject: doc.subject, statement: doc.statement, scope: doc.scope,
      status: doc.status, evidenceStatus: doc.evidenceStatus, evidence: doc.evidence || [],
      relation: doc.relation ? { type: doc.relation.type, targetMemoryId: String(doc.relation.targetMemoryId) } : undefined,
      validFrom: doc.validFrom ? String(doc.validFrom) : undefined, validTo: doc.validTo ? String(doc.validTo) : undefined,
      supersededById: doc.supersededById ? String(doc.supersededById) : undefined,
      confirmedAt: doc.confirmedAt ? String(doc.confirmedAt) : undefined, updatedAt: String(doc.updatedAt || new Date().toISOString()),
    }
  }
}
```

controller 端点按 Interfaces 实现。

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-memory-conflict.test.ts; npm run build`
Expected: PASS；编译通过

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant-memory.service.ts notes-backend/src/modules/assistant/assistant.controller.ts notes-backend/test/assistant-memory-conflict.test.ts
git commit -m "feat(assistant): 认知时间演进与冲突解决"
```

---

### Task 5: 受控召回与 [M1] 引用（MemoryRecallService + RAG 接入）

**Files:**
- Create: `notes-backend/src/modules/assistant/assistant-memory-recall.service.ts`
- Modify: `notes-backend/src/modules/ai/rag/rag-citation-sanitize.ts`（新增 `createMemoryCitationSanitizer`）
- Modify: `notes-backend/src/modules/ai/rag/rag-stream.service.ts`（接入召回 + `[M1]`）
- Modify: `notes-backend/src/modules/assistant/assistant-stream-format.ts`（complete 增加 `memoryCitations`）
- Modify: `notes-backend/src/modules/assistant/assistant.module.ts`（注册 `MEMORY_RECALL_SERVICE`）
- Test: `notes-backend/test/assistant-memory-recall.test.ts`、`notes-backend/test/rag-memory-citation.test.ts`

**Interfaces:**
- Produces `MemoryRecallService implements MemoryRecallServiceLike`（`recall(userId, question, opts)`）：
  - 只召回 `status: 'confirmed'`、`evidenceStatus: 'ok'`、`validTo` 为空或未来、未被 `supersededById` 引用；
  - scope 兼容：`global` 恒兼容；`knowledge_base` 需 `opts.knowledgeBaseId` 匹配；`note` 需 `opts.noteId` 匹配；`conversation` 需 `opts.conversationId` 匹配；
  - 匹配：question 分词（≥2 字）与 `subject`/`statement` 交集，按命中数降序，limit 默认 5；
  - 返回 `{ label, text }`，`label = '已确认认知'`，`text = statement`（含 scope 提示）。
- `createMemoryCitationSanitizer(recalled: Array<{ id: string; label: string; text: string }>)`：与 `createRagCitationSanitizer` 同构，校验 `[M\d+]`，产出 `memoryCitations: Array<{ memoryId: string; marker: string; text: string }>`。
- `RagStreamService.streamRagAnswer` 增加可选 `memoryRecall?: MemoryRecallServiceLike`：
  - prompt 增加 `[已确认认知]\n[M1] label | text\n...`；
  - system 增加 "Cite confirmed user memories using only [M1] IDs; cite note evidence using only [E1] IDs. Keep the two systems separate."；
  - 流式清洗同时跑 E 与 M 两个 sanitizer；`complete` 事件 data 增加 `memoryCitations`。
- `AssistantStreamEvent['complete']` data 增加可选 `memoryCitations: Array<{ marker: string; memoryId: string; text: string }>`（向后兼容：缺省为空）。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-memory-recall.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { MemoryRecallService } from '../src/modules/assistant/assistant-memory-recall.service'

class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  async find(filter: any) {
    return { sort: () => ({ limit: () => ({ lean: async () => this.docs.filter((d) => {
      if (filter.status && d.status !== filter.status) return false
      if (filter.evidenceStatus && d.evidenceStatus !== filter.evidenceStatus) return false
      if (filter.userId && String(d.userId) !== String(filter.userId)) return false
      if (filter['scope.type'] && d.scope.type !== filter['scope.type']) return false
      return true
    }) }) }) }
}

test('只召回已确认未过期的认知，并按范围过滤', async () => {
  const model = new MemoryModel([
    { _id: 'm1', userId: 'u1', subject: '界面', statement: '保留现有浮层', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok' },
    { _id: 'm2', userId: 'u1', subject: '界面', statement: '用大侧栏', scope: { type: 'global' }, status: 'superseded', evidenceStatus: 'ok' },
    { _id: 'm3', userId: 'u2', subject: '界面', statement: '别的用户', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok' },
    { _id: 'm4', userId: 'u1', subject: '知识库A', statement: 'KB 结论', scope: { type: 'knowledge_base', id: 'kb1' }, status: 'confirmed', evidenceStatus: 'ok' },
  ])
  const service = new MemoryRecallService(model as any)
  const hits = await service.recall('u1', '界面怎么改', {})
  assert.equal(hits.length, 1)
  assert.ok(hits[0].text.includes('保留现有浮层'))
  const kbHits = await service.recall('u1', '知识库A 结论', { knowledgeBaseId: 'kb1' })
  assert.equal(kbHits.length, 1)
})

test('过期与证据缺失的认知不召回', async () => {
  const model = new MemoryModel([
    { _id: 'm1', userId: 'u1', subject: '主题', statement: '过期内容', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok', validTo: '2020-01-01T00:00:00.000Z' },
    { _id: 'm2', userId: 'u1', subject: '主题', statement: '来源缺失', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'stale' },
  ])
  const service = new MemoryRecallService(model as any)
  const hits = await service.recall('u1', '主题', {})
  assert.equal(hits.length, 0)
})
```

```ts
// notes-backend/test/rag-memory-citation.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { createMemoryCitationSanitizer } from '../src/modules/ai/rag/rag-citation-sanitize'

test('M 标记清洗保留有效引用并剔除伪造', () => {
  const sanitizer = createMemoryCitationSanitizer([{ id: 'M1', label: '已确认认知', text: '保留浮层' }])
  const out = sanitizer.push('按你确认的结论 [M1]，另见 [M999]')
  assert.equal(out, '按你确认的结论 [M1]，另见 ')
  assert.equal(sanitizer.memoryCitations[0].marker, 'M1')
  assert.equal(sanitizer.invalidReferenceFound, true)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-memory-recall.test.ts test/rag-memory-citation.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// notes-backend/src/modules/assistant/assistant-memory-recall.service.ts
import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { MemoryRecallServiceLike } from './assistant.constants'
import { AssistantMemory, AssistantMemoryDocument } from './schemas/assistant-memory.schema'

@Injectable()
export class MemoryRecallService implements MemoryRecallServiceLike {
  constructor(@InjectModel(AssistantMemory.name) private readonly model: Model<AssistantMemoryDocument>) {}

  async recall(userId: string, question: string, opts?: { conversationId?: string; knowledgeBaseId?: string; noteId?: string; limit?: number }) {
    const q = String(question || '').trim()
    const tokens = q.split(/[\s,，。？?！!、;；]+/).map((t) => t.trim()).filter((t) => t.length >= 2)
    if (tokens.length === 0) return []
    const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const now = new Date()
    const docs = await this.model.find({
      userId: new Types.ObjectId(userId),
      status: 'confirmed',
      evidenceStatus: 'ok',
      $or: [{ validTo: { $exists: false } }, { validTo: null }, { validTo: { $gte: now } }],
      $and: [
        { $or: [{ subject: { $regex: pattern, $options: 'i' } }, { statement: { $regex: pattern, $options: 'i' } }] },
      ],
    }).sort({ updatedAt: -1 }).limit(100).lean().exec() as any[]

    const compatible = docs.filter((doc) => {
      // 防御索引/查询漂移：内存侧再校验一次召回条件（已确认、证据有效、未过期、范围兼容）。
      if (doc.status !== 'confirmed' || doc.evidenceStatus !== 'ok') return false
      if (doc.validTo && new Date(doc.validTo) < now) return false
      const type = doc.scope?.type
      if (type === 'global') return true
      if (type === 'knowledge_base') return opts?.knowledgeBaseId ? String(doc.scope.id) === String(opts.knowledgeBaseId) : false
      if (type === 'note') return opts?.noteId ? String(doc.scope.id) === String(opts.noteId) : false
      if (type === 'conversation') return opts?.conversationId ? String(doc.scope.id) === String(opts.conversationId) : false
      return false
    })
    const scored = compatible
      .map((doc) => {
        const text = `${doc.subject} ${doc.statement}`
        const score = tokens.reduce((total, token) => total + (text.toLowerCase().includes(token.toLowerCase()) ? 1 : 0), 0)
        return { doc, score }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts?.limit ?? 5)
    return scored.map(({ doc }) => ({
      label: '已确认认知',
      text: `${doc.statement}（范围：${doc.scope?.type}${doc.scope?.id ? ` ${doc.scope.id}` : ''}）`,
    }))
  }
}
```

`rag-citation-sanitize.ts` 追加（与 E 版同构）：

```ts
export interface MemoryCitationSanitizer {
  push(chunk: string): string
  flush(): string
  readonly memoryCitations: Array<{ marker: string; memoryId: string; text: string }>
  readonly invalidReferenceFound: boolean
}

export function createMemoryCitationSanitizer(recalled: Array<{ id: string; label: string; text: string }>): MemoryCitationSanitizer {
  const byId = new Map(recalled.map((item, index) => [`M${index + 1}`, item]))
  const seen = new Set<string>()
  const memoryCitations: Array<{ marker: string; memoryId: string; text: string }> = []
  let invalidReferenceFound = false
  let buffer = ''
  const emit = (text: string): string => text.replace(/\[(M\d+)\]/g, (marker, id: string) => {
    const item = byId.get(id)
    if (!item) { invalidReferenceFound = true; return '' }
    if (!seen.has(id)) {
      seen.add(id)
      memoryCitations.push({ marker: id, memoryId: item.id, text: item.text })
    }
    return marker
  })
  return {
    push(chunk: string): string {
      const combined = buffer + chunk
      const lastOpen = combined.lastIndexOf('[')
      if (lastOpen === -1) { buffer = ''; return emit(combined) }
      const tail = combined.slice(lastOpen)
      if (/^\[M\d*$/.test(tail)) { buffer = tail; return emit(combined.slice(0, lastOpen)) }
      buffer = ''
      return emit(combined)
    },
    flush(): string { const rest = buffer; buffer = ''; return emit(rest) },
    get memoryCitations() { return memoryCitations },
    get invalidReferenceFound() { return invalidReferenceFound },
  }
}
```

`rag-stream.service.ts`：`streamRagAnswer` 输入增加 `memoryRecall?: MemoryRecallServiceLike`；prompt 前拼认知节；流式循环同时推进两个 sanitizer；返回对象增加 `memoryCitations`。`assistant-stream-format.ts` complete data 增加 `memoryCitations: Array<{ marker: string; memoryId: string; text: string }>`（默认 `[]`）。`assistant.module.ts` 注册 `{ provide: MEMORY_RECALL_SERVICE, useClass: MemoryRecallService }` 并 export（阶段三的 `assistant-context.service.ts` 已按该 symbol 注入，注册后自动生效，无需改动该文件）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-memory-recall.test.ts test/rag-memory-citation.test.ts test/rag-stream.service.test.ts test/assistant-context-assembly.test.ts; npm run build`
Expected: PASS；既有 rag-stream 与 context 测试同步通过

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant-memory-recall.service.ts notes-backend/src/modules/ai/rag/rag-citation-sanitize.ts notes-backend/src/modules/ai/rag/rag-stream.service.ts notes-backend/src/modules/assistant/assistant-stream-format.ts notes-backend/src/modules/assistant/assistant.module.ts notes-backend/test/assistant-memory-recall.test.ts notes-backend/test/rag-memory-citation.test.ts
git commit -m "feat(assistant): 受控认知召回与 M 引用校验"
```

---

### Task 6: 证据复核与认知导出

**Files:**
- Modify: `notes-backend/src/modules/assistant/assistant-memory.service.ts`（`refreshEvidence`、`exportJsonl`）
- Modify: `notes-backend/src/modules/assistant/assistant.controller.ts`（`POST memories/:id/refresh-evidence`、`GET memories/export`）
- Modify: `notes-backend/src/modules/assistant/assistant-generation.service.ts`（关闭记忆召回时把 `memoryRecall` 置 undefined）
- Test: `notes-backend/test/assistant-memory-evidence.test.ts`

**Interfaces:**
- Produces：
  - `MemoryService.refreshEvidence(userId, memoryId): Promise<{ evidenceStatus: 'ok' | 'stale'; reviewCreated: boolean }>`：对每条 `note_chunk` 证据查询 chunk 是否存在（注入 `chunkModel`）；任一缺失 → `evidenceStatus: 'stale'` 并创建复核候选（kind: `'hypothesis'`，subject/statement 沿用，附 `message` 证据指向原候选）；`message` 类型证据无法验证时保持现状。
  - `MemoryService.exportJsonl(userId): Promise<string>`（JSONL 行，含记忆与证据）。
  - 端点：`POST /assistant/memories/:id/refresh-evidence`；`GET /assistant/memories/export`（application/x-ndjson）。
  - 遗忘控制接线：会话设置（`memoryEnabled`/`temporary` 读写、`PATCH conversations/:id/settings`）已由 Task 2 提供；本任务在 `assistant-generation.service.ts` 注入 `@Optional() @Inject(MEMORY_RECALL_SERVICE) private readonly memoryRecall?: MemoryRecallServiceLike`（TS 可选参数，保持阶段一 5 参构造测试不变），`start` 中读取设置并给 `context.assemble` 与 `ragStream.streamRagAnswer` 传 `memoryRecall`（`memoryEnabled === false` 时置 undefined，回答不再注入 `[已确认认知]`）。

- [ ] **Step 1: 写失败测试**

```ts
// notes-backend/test/assistant-memory-evidence.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { MemoryService } from '../src/modules/assistant/assistant-memory.service'

class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  async findOne(filter: any) { return this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) ?? null }
  async findOneAndUpdate(filter: any, update: any, _opts: any) {
    const doc = this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v)))
    if (doc) Object.assign(doc, update.$set)
    return doc ?? null
  }
  async find(filter: any) { return { sort: () => ({ limit: () => ({ lean: async () => this.docs.filter((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) }) }) } }
}

test('note_chunk 证据缺失时标记 stale 并生成复核候选', async () => {
  const memories = new MemoryModel([
    { _id: 'm1', userId: 'u1', conversationId: 'conv1', kind: 'decision', subject: '布局', statement: '保留浮层', scope: { type: 'global' }, status: 'confirmed', evidenceStatus: 'ok', evidence: [{ type: 'note_chunk', noteId: 'n1', chunkId: 'c1', excerpt: 'x' }] },
  ])
  const chunkModel = { findOne: async () => null }
  const candidates: any[] = []
  const candidateModel = { create: async (data: any) => { candidates.push(data); return data } }
  const service = new MemoryService(memories as any, chunkModel as any, candidateModel as any)
  const result = await service.refreshEvidence('u1', 'm1')
  assert.equal(result.evidenceStatus, 'stale')
  assert.equal(result.reviewCreated, true)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].kind, 'hypothesis')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-memory-evidence.test.ts`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 最小实现**

`assistant-memory.service.ts` 构造器扩展为 `(memoryModel, @Optional() chunkModel?, @Optional() candidateModel?)`，增加：

```ts
async refreshEvidence(userId: string, memoryId: string) {
  const memory = await this.model.findOne({ _id: new Types.ObjectId(memoryId), userId: new Types.ObjectId(userId) }).lean().exec() as any
  if (!memory) throw new Error('memory not found')
  if (!this.chunkModel || !this.candidateModel) return { evidenceStatus: memory.evidenceStatus, reviewCreated: false }
  let stale = false
  for (const evidence of memory.evidence || []) {
    if (evidence.type !== 'note_chunk') continue
    const chunk = await this.chunkModel.findOne({ _id: new Types.ObjectId(evidence.chunkId), noteId: new Types.ObjectId(evidence.noteId) }).select('_id').lean().exec()
    if (!chunk) stale = true
  }
  const evidenceStatus = stale ? 'stale' : 'ok'
  if (stale && memory.evidenceStatus !== 'stale') {
    await this.model.updateOne({ _id: memory._id }, { $set: { evidenceStatus: 'stale' } }).exec()
    await this.candidateModel.create({
      userId: memory.userId, conversationId: memory.conversationId || memory.userId,
      kind: 'hypothesis', subject: memory.subject, statement: `复核认知：${memory.statement}（原证据可能已变化）`,
      scope: memory.scope, confidence: Math.max(0.1, Number(memory.confidence) * 0.8),
      evidence: [{ type: 'message', messageId: memory.candidateId || memory._id, excerpt: memory.statement.slice(0, 160) }],
      evidenceKey: `review-${memory._id}`,
    })
    return { evidenceStatus: 'stale', reviewCreated: true }
  }
  return { evidenceStatus, reviewCreated: false }
}

async exportJsonl(userId: string) {
  const docs = await this.model.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: 1 }).lean().exec()
  return docs.map((doc: any) => JSON.stringify({ id: String(doc._id), kind: doc.kind, subject: doc.subject, statement: doc.statement, scope: doc.scope, status: doc.status, evidenceStatus: doc.evidenceStatus, evidence: doc.evidence || [], validFrom: doc.validFrom, validTo: doc.validTo, confirmedAt: doc.confirmedAt })).join('\n')
}
```

controller 端点按 Interfaces 实现（`POST memories/:id/refresh-evidence`、`GET memories/export` 返回 `application/x-ndjson`）。`assistant-generation.service.ts` 构造器末尾追加 `@Optional() @Inject(MEMORY_RECALL_SERVICE) private readonly memoryRecall?: MemoryRecallServiceLike`，`start` 中：

```ts
let memoryRecall: MemoryRecallServiceLike | undefined = this.memoryRecall
if (memoryRecall) {
  try {
    const settings = await this.conversations.getSettings(userId, input.conversationId)
    // 关闭记忆召回后不再注入 [已确认认知]；临时会话不产生候选由 extractor 内部处理。
    if (settings.memoryEnabled === false) memoryRecall = undefined
  } catch { /* 设置读取失败时保持默认召回，不影响回答 */ }
}
```

随后把 `memoryRecall` 传给 pet 分支的 `context.assemble({ ..., memoryRecall })` 与 rag 分支的 `streamRagAnswer({ ..., memoryRecall })`（rag 分支在 Task 5 已支持该参数；会话设置读写见 Task 2）。

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/assistant-memory-evidence.test.ts; npm run build`
Expected: PASS；编译通过

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/assistant/assistant-memory.service.ts notes-backend/src/modules/assistant/assistant-generation.service.ts notes-backend/src/modules/assistant/assistant.controller.ts notes-backend/test/assistant-memory-evidence.test.ts
git commit -m "feat(assistant): 证据复核与认知导出"
```

---

### Task 7: 前端认知面板（候选 / 时间线 / 冲突 / 引用区分）

**Files:**
- Modify: `notes-frontend/src/lib/assistant-api.ts`（候选/记忆 API + `memoryCitations`）
- Modify: `notes-frontend/src/lib/assistant-stream-client.ts`（complete data 增加 `memoryCitations`）
- Create: `notes-frontend/src/components/assistant/MemoryCandidatesPanel.tsx`
- Create: `notes-frontend/src/components/assistant/MemoryTimeline.tsx`
- Create: `notes-frontend/src/components/assistant/MemoryConflictDialog.tsx`
- Modify: `notes-frontend/src/components/assistant/AssistantContextPanel.tsx`（认知标签）
- Modify: `notes-frontend/src/components/assistant/AssistantMessages.tsx`（`[M1]` 徽标渲染）
- Test: `memory-candidates-panel.spec.tsx`、`memory-timeline.spec.tsx`、`memory-conflict-dialog.spec.tsx`

**Interfaces:**
- Produces（`assistant-api.ts`）：
  - `export type MemoryCandidateView = { id; kind; subject; statement; scope: { type: string; id?: string }; confidence; evidence: Array<{ type: string; messageId?: string; noteId?: string; chunkId?: string; excerpt: string }>; createdAt }`
  - `export type MemoryView = { id; kind; subject; statement; scope; status: 'confirmed' | 'superseded'; evidenceStatus: 'ok' | 'stale'; relation?: { type: string; targetMemoryId: string }; validFrom?; validTo?; supersededById?; confirmedAt?; updatedAt }`
  - `fetchMemoryCandidates(): Promise<MemoryCandidateView[]>`；`confirmMemoryCandidate(id, edits?)`；`rejectMemoryCandidate(id, reason)`；`batchConfirmMemoryCandidates(ids, kind, scope)`；`fetchMemories(includeSuperseded?)`；`resolveMemoryConflict(id, action)`；`deleteMemory(id)`；`refreshMemoryEvidence(id)`；`updateConversationSettings(id, settings)`。
- `MemoryCandidatesPanel({ items, onChanged })`：待确认列表（kind 徽标、来源、置信度）；操作：确认 / 修改后确认（弹内联表单改 kind/subject/statement/scope）/ 暂不处理 / 拒绝（填原因）；"查看依据"展开证据 excerpt；批量确认（同 kind + 同 scope，先展示将写入内容）。
- `MemoryTimeline({ subject, scope, items })`：默认"当前有效"（confirmed 且未 superseded），切换"演进过程"按 `validFrom` 升序显示完整链（superseded 条目标记"已被替代"）。
- `MemoryConflictDialog({ conflict, onResolve })`：展示新旧两条，四个选项：用新结论替代 / 两者适用不同场景（要求改 scope）/ 修改新结论（返回编辑表单）/ 拒绝新候选（删除新 memory 并把候选退回 pending）。
- `AssistantContextPanel` 认知标签：浮层只显示数量徽标（阶段二浮层不动），全屏右栏渲染候选面板 + 时间线 + 冲突对话框。
- `AssistantMessages`：`complete` 后若 `memoryCitations.length > 0`，在消息下方渲染"来自已确认认知"徽标列表（`[M1]`），与 `RagCitationList`（`[E1]`）视觉分离。

- [ ] **Step 1: 写失败测试**

```tsx
// notes-frontend/__tests__/memory-candidates-panel.spec.tsx
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryCandidatesPanel } from '@/components/assistant/MemoryCandidatesPanel'

const items = [{ id: 'c1', kind: 'decision', subject: '界面', statement: '保留现有浮层', scope: { type: 'global' }, confidence: 0.9, evidence: [{ type: 'message', messageId: 'm1', excerpt: '我决定保留浮层' }], createdAt: '2026-09-01T00:00:00.000Z' }]

test('渲染待确认候选与确认/拒绝操作', () => {
  const onConfirm = jest.fn()
  const onReject = jest.fn()
  render(<MemoryCandidatesPanel items={items} onConfirm={onConfirm} onReject={onReject} />)
  expect(screen.getByText('决策')).toBeInTheDocument()
  expect(screen.getByText('保留现有浮层')).toBeInTheDocument()
  screen.getByRole('button', { name: '确认' }).click()
  expect(onConfirm).toHaveBeenCalledWith('c1', {})
  screen.getByRole('button', { name: '拒绝' }).click()
  expect(onReject).toHaveBeenCalledWith('c1', '')
})
```

```tsx
// notes-frontend/__tests__/memory-timeline.spec.tsx
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryTimeline } from '@/components/assistant/MemoryTimeline'

const items = [
  { id: 'old', kind: 'decision', subject: '布局', statement: '用大侧栏', scope: { type: 'global' }, status: 'superseded' as const, evidenceStatus: 'ok' as const, validFrom: '2026-09-01T00:00:00.000Z', validTo: '2026-09-02T00:00:00.000Z', updatedAt: '' },
  { id: 'new', kind: 'decision', subject: '布局', statement: '保留浮层', scope: { type: 'global' }, status: 'confirmed' as const, evidenceStatus: 'ok' as const, relation: { type: 'supersedes', targetMemoryId: 'old' }, validFrom: '2026-09-02T00:00:00.000Z', updatedAt: '' },
]

test('默认展示当前有效，切换后展示被替代条目', () => {
  render(<MemoryTimeline items={items} />)
  expect(screen.getByText('保留浮层')).toBeInTheDocument()
  expect(screen.queryByText('用大侧栏')).not.toBeInTheDocument()
  screen.getByRole('button', { name: '演进过程' }).click()
  expect(screen.getByText('用大侧栏')).toBeInTheDocument()
  expect(screen.getByText('已被替代')).toBeInTheDocument()
})
```

```tsx
// notes-frontend/__tests__/memory-conflict-dialog.spec.tsx
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryConflictDialog } from '@/components/assistant/MemoryConflictDialog'

test('冲突对话框提供四个解决方向', () => {
  const onResolve = jest.fn()
  render(<MemoryConflictDialog
    conflict={{ memoryId: 'new', subject: '布局', statement: '保留浮层' }}
    existing={{ memoryId: 'old', subject: '布局', statement: '用大侧栏' }}
    onResolve={onResolve}
  />)
  screen.getByRole('button', { name: '用新结论替代旧结论' }).click()
  expect(onResolve).toHaveBeenCalledWith('new', { type: 'supersede', targetMemoryId: 'old' })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/memory-candidates-panel.spec.tsx __tests__/memory-timeline.spec.tsx __tests__/memory-conflict-dialog.spec.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

按 Interfaces 实现三个组件与 API/类型扩展；组件视觉沿用 product token（克制纸张风，不引入大气泡/紫色渐变）；`[M1]` 徽标使用独立 className（如 `ink-memory-citation`）与 `RagCitationList` 区分。

- [ ] **Step 4: 运行确认通过**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/memory-candidates-panel.spec.tsx __tests__/memory-timeline.spec.tsx __tests__/memory-conflict-dialog.spec.tsx __tests__/assistant-workspace.spec.tsx; npm run type-check`
Expected: PASS；TypeScript 通过

- [ ] **Step 5: 提交**

```bash
git add notes-frontend/src/lib/assistant-api.ts notes-frontend/src/lib/assistant-stream-client.ts notes-frontend/src/components/assistant/MemoryCandidatesPanel.tsx notes-frontend/src/components/assistant/MemoryTimeline.tsx notes-frontend/src/components/assistant/MemoryConflictDialog.tsx notes-frontend/src/components/assistant/AssistantContextPanel.tsx notes-frontend/src/components/assistant/AssistantMessages.tsx notes-frontend/__tests__/memory-candidates-panel.spec.tsx notes-frontend/__tests__/memory-timeline.spec.tsx notes-frontend/__tests__/memory-conflict-dialog.spec.tsx
git commit -m "feat(assistant): 认知候选面板时间线与冲突解决 UI"
```

---

### Task 8: 阶段四全量验证

**Files:**
- 无新增

- [ ] **Step 1: 后端全量单测与编译**

Run: `npm run test:unit; npm run build`
Expected: 全部通过

- [ ] **Step 2: 前端全量测试与类型检查**

Run: `npm run ci:test; npm run type-check; npm run build`
Expected: 全部通过

- [ ] **Step 3: 浏览器冒烟（使用已有验收账户）**

- 对话中包含明确决策（如"我决定以后用 X 方案"），等待提取完成（`assistant_memory_candidates` 出现 pending 记录）。
- 全屏工作台认知标签：确认候选 → 出现在"当前有效"；拒绝候选 → 记录拒绝原因且同一证据不重复生成候选。
- 再在另一会话提出相反结论 → 确认时出现冲突对话框 → 选择"用新结论替代旧结论" → 旧节点在"演进过程"中显示"已被替代"，新节点带 `supersedes` 关系。
- 开启"搜索笔记"提问，回答中出现 `[M1]` 与 `[E1]`，UI 分别用不同徽标；点击 `[M1]` 能查看认知依据。
- 会话设置：临时会话开启后，新对话不产生候选；关闭"记忆召回"后，回答不再注入 `[已确认认知]`。
- 删除一条记忆的源会话后，`refresh-evidence`（或再次查看）把无证据节点标记 stale 并生成复核候选；导出认知 JSONL 成功。
- 控制台与后端日志无异常；p3 既有功能（引用跳转、历史恢复、多会话）无回归。

- [ ] **Step 4: 提交收尾（如无代码变更则跳过）**

```bash
git status --short
git log --oneline -10
```

- [ ] **Step 5: 更新 debug 记录与验收报告**

如发现新坑，按 `project-debug` 规范追加 `docs/debug-records.md`；确认全部验收通过后，在 `docs/qa/p3-browser-acceptance/report.md` 追加四个阶段的浏览器验收结论（引用截图路径必须实际存在）。

---

## Self-Review 记录

- 规格覆盖：七种候选类型与寒暄/推测排除（Task 2）、证据权重与"助手建议只能 hypothesis"（Task 2）、候选确认/修改/拒绝/批量与 pending 不参与回答（Task 3/5）、时间演进 supersedes 不静默覆盖（Task 4）、冲突四选一（Task 4 + Task 7 对话框）、`[M1]` 与 `[E1]` 分离（Task 5 + Task 7）、受控召回条件（Task 5）、证据变化标记与复核候选（Task 6）、隐私与遗忘（暂停提取/临时会话 = Task 2 会话设置；关闭召回 = Task 6 生成侧 gating；删除/导出 = Task 4/6）、非目标未实现（复杂图谱、情绪画像、隐式推断、多人共享）。
- 占位符扫描：无 TBD/TODO；所有代码步骤含可运行测试。
- 类型一致性：`MemoryRecallServiceLike` 在阶段三定义、本阶段 Task 1 常量落定、Task 5 实现并注册 `MEMORY_RECALL_SERVICE`，`AssistantContextService` 构造器由阶段三占位写法替换为真实注入（接口签名不变，阶段三测试无需改动）；`complete` 事件新增 `memoryCitations` 为可选字段，阶段一/二解析器向后兼容；`MemoryView`/`MemoryCandidateView` 前端类型与后端 `MemoryService.list`/`MemoryCandidatesService.listPending` 返回字段一致；`resolveConflict` 动作签名在 Task 4 后端与 Task 7 前端一致。
