# 无知识库 RAG 自动图谱扩展 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小助手全笔记 RAG（无 `knowledgeBaseId`）且 planner 计划含 `graph_expand` 时，后端自动反查用户自有知识库图谱做一跳扩展，使回答能使用知识图谱证据。

**Architecture:** `RagRetrievalService.retrieve()` 在 `graph_expand` 工具命中但无 `knowledgeBaseId` 的分支改为调用 `KnowledgeBasesService.expandGraphEvidenceAuto()`；该方法由种子 chunk 的 noteId 经 `knowledge_base_notes` 反查当前用户自有且链接了这些笔记的知识库（上限 5 个），对每个库复用现有 `expandGraphEvidence()`（内部自带 KB 归属 + NoteAccess + chunk 归属三重 ACL），按 chunkId 去重合并证据。显式选库路径与 planner 触发规则保持不变。

**Tech Stack:** NestJS + Mongoose + MongoDB；后端单测 node:test + 内存 mock 模型（见 `test/knowledge-graph-evidence-access.test.ts` 的 mock 惯例：`execResult`/`doc` 辅助）。

**Spec:** `docs/superpowers/specs/2026-09-03-assistant-auto-graph-expand-design.md`

## Global Constraints

- 只扩**用户自有**知识库：候选库经 `knowledge_base_notes` 反查（查询带 `userId` = 当前用户），共享/公开笔记不在自有库时不扩展。
- `graphHops` 保持 1；每库独立一跳，不做跨库多跳。
- 显式选库路径（`expandGraphEvidence`）、planner 触发规则（仅 compare 类问题启用 `graph_expand`）、rerank、最终证据截断（30→10）不变。
- 扩图为空时与显式选库路径一致：**静默**，不追加 warning；仅当无候选库（`attemptedKbs === 0`）时提示「未找到可用的知识库图谱，已跳过图谱扩展」。
- 不新增 API 字段、不改前端。
- 候选库上限常量 `AUTO_GRAPH_EXPAND_KB_CAP = 5`，超出时按 `_id` 字符串升序取前 5。
- 注释规范（AGENTS.md）：只写“为什么/约束”，中文；提交信息中文且用 `git commit -F <utf8文件>` 避免乱码。

---

### Task 1: 服务层 `expandGraphEvidenceAuto`（失败测试先行）

**Files:**
- Modify: `notes-backend/src/modules/knowledge-bases/knowledge-bases.service.ts`
- Test: `notes-backend/test/knowledge-base-auto-graph-expand.test.ts`（新建）

**Interfaces:**
- Consumes: 现有公开方法 `expandGraphEvidence(id, userId, seedChunkIds)`（返回 `Array<{ chunkId, noteId, noteTitle, headingPath, content, graphPath }>`，见 `knowledge-bases.service.ts:390-414`）；导入的 `uniqueStrings`（来自 `./knowledge-graph-normalize`）；`this.kbNoteModel`、`this.objectId`、`Types.ObjectId`。
- Produces（Task 2 依赖）:
  ```ts
  expandGraphEvidenceAuto(userId: string, seeds: Array<{ chunkId: string; noteId: string }>):
    Promise<{ evidence: Array<{ chunkId: string; noteId: string; noteTitle: string; headingPath: string[]; content: string; graphPath: string[] }>; attemptedKbs: number }>
  ```

- [ ] **Step 1: 写失败测试**

创建 `notes-backend/test/knowledge-base-auto-graph-expand.test.ts`：

```ts
import assert = require('node:assert/strict')
import { test } from 'node:test'
import { Types } from 'mongoose'
import { KnowledgeBasesService } from '../src/modules/knowledge-bases/knowledge-bases.service'

const userId = '507f1f77bcf86cd799439012'
const noteId = '507f1f77bcf86cd799439014'
const chunkId = '507f1f77bcf86cd799439021'
// 7 个候选库 id（字符串升序）
const kbIds = ['507f1f77bcf86cd799439013', '507f1f77bcf86cd799439015', '507f1f77bcf86cd799439016', '507f1f77bcf86cd799439017', '507f1f77bcf86cd799439018', '507f1f77bcf86cd799439019', '507f1f77bcf86cd79943901a']

function execResult<T>(value: T) { return { exec: async () => value } }
function objectId(id: string) { return new Types.ObjectId(id) }
function evidence(chunkId: string) {
  return { chunkId, noteId, noteTitle: 'Note', headingPath: [], content: 'evidence ' + chunkId, graphPath: ['seed', 'neighbor'] }
}

// 构造服务并 stub 掉 expandGraphEvidence：本文件只测自动反查自身的逻辑
// （自有库发现/按 _id 上限/跨库去重/无候选早退），单库扩图内部的 ACL 由
// knowledge-graph-evidence-access.test.ts 覆盖，不在本文件重复。
function buildService(opts: { kbIds: Types.ObjectId[]; expand?: (kbId: string, chunkIds: string[]) => any[] }) {
  const expandCalls: Array<{ kbId: string; chunkIds: string[] }> = []
  let distinctFilter: any = null
  const linkModel = {
    distinct: (_field: string, filter: any) => {
      distinctFilter = filter
      return execResult(opts.kbIds)
    },
  }
  const service = new KnowledgeBasesService(
    {} as any,
    linkModel as any,
    {} as any,
    { objectId: (id: string) => new Types.ObjectId(id) } as any,
    {} as any,
    {} as any,
    undefined,
    {} as any,
  )
  ;(service as any).expandGraphEvidence = async (kbId: string, _uid: string, chunkIds: string[]) => {
    expandCalls.push({ kbId, chunkIds })
    return opts.expand ? opts.expand(kbId, chunkIds) : []
  }
  return { service, expandCalls, distinctFilter: () => distinctFilter }
}

test('expandGraphEvidenceAuto 经自有库链接反查候选库并逐库扩图', async () => {
  const { service, expandCalls, distinctFilter } = buildService({
    kbIds: [objectId(kbIds[0]), objectId(kbIds[1])],
    expand: (kbId) => [evidence(kbId === kbIds[0] ? 'chunk-a' : 'chunk-b')],
  })
  const result = await service.expandGraphEvidenceAuto(userId, [{ chunkId, noteId }])
  const filter = distinctFilter()
  assert.equal(String(filter.userId), userId, '候选库查询必须按当前 userId 过滤（他人/共享库不参与）')
  assert.deepEqual(filter.noteId.$in.map(String), [noteId], '只反查链接了种子笔记的库')
  assert.equal(result.attemptedKbs, 2)
  assert.deepEqual(expandCalls.map((call) => call.kbId), [kbIds[0], kbIds[1]])
  assert.deepEqual(expandCalls[0].chunkIds, [chunkId])
  assert.deepEqual(result.evidence.map((item: any) => item.chunkId).sort(), ['chunk-a', 'chunk-b'])
})

test('expandGraphEvidenceAuto 跨库证据按 chunkId 去重', async () => {
  const { service } = buildService({
    kbIds: [objectId(kbIds[0]), objectId(kbIds[1])],
    expand: () => [evidence('chunk-a')],
  })
  const result = await service.expandGraphEvidenceAuto(userId, [{ chunkId, noteId }])
  assert.equal(result.attemptedKbs, 2)
  assert.equal(result.evidence.length, 1)
  assert.equal(result.evidence[0].chunkId, 'chunk-a')
})

test('expandGraphEvidenceAuto 候选库超过上限只扩前 5 个（按 _id 升序）', async () => {
  const sorted = kbIds.map(objectId).sort((left, right) => String(left).localeCompare(String(right)))
  const { service, expandCalls } = buildService({ kbIds: sorted })
  const result = await service.expandGraphEvidenceAuto(userId, [{ chunkId, noteId }])
  assert.equal(result.attemptedKbs, 5)
  assert.equal(expandCalls.length, 5)
  assert.deepEqual(expandCalls.map((call) => call.kbId), kbIds.slice(0, 5))
})

test('expandGraphEvidenceAuto 无自有库链接时返回空且 attemptedKbs 0', async () => {
  const { service, expandCalls } = buildService({ kbIds: [] })
  const result = await service.expandGraphEvidenceAuto(userId, [{ chunkId, noteId }])
  assert.equal(result.attemptedKbs, 0)
  assert.deepEqual(result.evidence, [])
  assert.equal(expandCalls.length, 0)
})

test('expandGraphEvidenceAuto 全部种子非法时早退且不查询模型', async () => {
  let modelCalled = false
  const linkModel = {
    distinct: () => { modelCalled = true; return execResult([]) },
  }
  const service = new KnowledgeBasesService(
    {} as any, linkModel as any, {} as any,
    { objectId: (id: string) => new Types.ObjectId(id) } as any,
    {} as any, {} as any, undefined, {} as any,
  )
  const result = await service.expandGraphEvidenceAuto(userId, [{ chunkId: 'not-an-id', noteId: 'also-bad' }])
  assert.equal(result.attemptedKbs, 0)
  assert.equal(modelCalled, false)
})
```

- [ ] **Step 2: 运行确认失败**

Run（在 `notes-backend` 下）: `node --test -r ts-node/register -r tsconfig-paths/register test/knowledge-base-auto-graph-expand.test.ts`
Expected: FAIL（`expandGraphEvidenceAuto is not a function`）。

- [ ] **Step 3: 最小实现**

a) 文件顶部导入区之后新增模块级常量。插入位置：`knowledge-bases.service.ts` 第 20 行（最后一个 import `KnowledgeGraphNode...`）与第 22 行 `@Injectable()` 之间的空行处：

```ts
// 自动图谱扩展的候选库上限：一次全笔记检索最多反查扩图的库数，控制额外延迟与结果噪声。
const AUTO_GRAPH_EXPAND_KB_CAP = 5
```

b) 在 `expandGraphEvidence` 方法（结束于约第 414 行）之后新增：

```ts
  // 无知识库 RAG（全笔记检索）的自动扩图入口：由命中 chunk 的 noteId 经 knowledge_base_notes 反查
  // 当前用户自有、且链接了这些笔记的知识库（distinct 过滤带 userId，他人/共享库不参与），
  // 每库复用 expandGraphEvidence 做一跳扩展（内部含 KB 归属 + NoteAccess + chunk 归属校验）。
  // 候选超过上限按 _id 升序取前 AUTO_GRAPH_EXPAND_KB_CAP；扩图为空静默，仅无候选库可扩时由调用方提示。
  async expandGraphEvidenceAuto(userId: string, seeds: Array<{ chunkId: string; noteId: string }>) {
    const userObjectId = this.objectId(userId, 'user id')
    const validSeeds = seeds
      .map((seed) => ({ chunkId: String(seed?.chunkId || ''), noteId: String(seed?.noteId || '') }))
      .filter((seed) => Types.ObjectId.isValid(seed.chunkId) && Types.ObjectId.isValid(seed.noteId))
    const noteIds = uniqueStrings(validSeeds.map((seed) => seed.noteId))
    if (noteIds.length === 0) return { evidence: [], attemptedKbs: 0 }
    const candidateKbIds = (await this.kbNoteModel
      .distinct('knowledgeBaseId', { userId: userObjectId, noteId: { $in: noteIds.map((value) => new Types.ObjectId(value)) } })
      .exec()) as Types.ObjectId[]
    if (candidateKbIds.length === 0) return { evidence: [], attemptedKbs: 0 }
    const capped = candidateKbIds
      .sort((left, right) => String(left).localeCompare(String(right)))
      .slice(0, AUTO_GRAPH_EXPAND_KB_CAP)
    const seedChunkIds = uniqueStrings(validSeeds.map((seed) => seed.chunkId))
    const expanded: Array<Awaited<ReturnType<typeof this.expandGraphEvidence>>[number]> = []
    for (const kbId of capped) {
      // 候选库已由 kbNote 行 userId 保证自有；库被删等竞态下防御性跳过单个库，避免拖垮整次检索。
      expanded.push(...(await this.expandGraphEvidence(String(kbId), userId, seedChunkIds).catch(() => [])))
    }
    const byChunkId = new Map<string, (typeof expanded)[number]>()
    for (const item of expanded) if (!byChunkId.has(item.chunkId)) byChunkId.set(item.chunkId, item)
    return { evidence: [...byChunkId.values()], attemptedKbs: capped.length }
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/knowledge-base-auto-graph-expand.test.ts`
Expected: PASS（5 条）。

- [ ] **Step 5: 跑相关回归**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/knowledge-graph-evidence-access.test.ts test/rag-retrieval-orchestration.test.ts test/rag-stream.service.test.ts test/query-planner.test.ts`
Expected: PASS（无回归）。

- [ ] **Step 6: 提交**

```powershell
@'
feat(rag): 服务层支持无知识库时自动反查自有库图谱扩展

新增 KnowledgeBasesService.expandGraphEvidenceAuto：由种子 chunk 的 noteId 反查
当前用户自有且链接这些笔记的知识库，逐库复用 expandGraphEvidence 一跳扩展并去重。
'@ | Set-Content -Encoding utf8 $env:TEMP\commit-msg.txt
git add notes-backend/src/modules/knowledge-bases/knowledge-bases.service.ts notes-backend/test/knowledge-base-auto-graph-expand.test.ts
git commit -F $env:TEMP\commit-msg.txt
Remove-Item $env:TEMP\commit-msg.txt
```

---

### Task 2: 检索层接入自动扩图（失败测试先行）

**Files:**
- Modify: `notes-backend/src/modules/ai/rag/rag-retrieval.service.ts:19-23`
- Test: `notes-backend/test/rag-retrieval-orchestration.test.ts`（追加 2 条）

**Interfaces:**
- Consumes: Task 1 的 `expandGraphEvidenceAuto(userId, seeds) → { evidence, attemptedKbs }`。
- Produces: `retrieve()` 在无 `knowledgeBaseId` + plan 含 `graph_expand` 时 evidence 含 `source:'graph_expand'` 的自动扩图候选；无候选库时 warnings 含「未找到可用的知识库图谱，已跳过图谱扩展」。

**背景约束（写测试前先看 `rag-retrieval.service.ts:11-35`）:** 候选 seed 只来自 `plan.tools` 中启用的检索工具——因此测试的 plan 必须同时含 `chunk_vector`（否则 candidates 为空、自动扩图收到的 seeds 为空）。compare 类计划省略 `rerank` 以避免引入排序 mock。

- [ ] **Step 1: 写失败测试（追加到 `test/rag-retrieval-orchestration.test.ts` 末尾）**

```ts
test('无 knowledgeBaseId 且计划含 graph_expand 时自动反查自有库并并入扩图候选', async () => {
  let autoSeeds: any = null
  const service = new RagRetrievalService(
    {
      searchKeywordChunks: async () => [],
      searchChunks: async () => [{ chunkId: 'chunk-seed', noteId: 'note-1', title: 'Seed', headingPath: [], content: 'seed evidence', score: 0.9 }],
    } as any,
    {
      expandGraphEvidenceAuto: async (_userId: string, seeds: any[]) => {
        autoSeeds = seeds
        return { evidence: [{ chunkId: 'chunk-neighbor', noteId: 'note-1', noteTitle: 'Neighbor', headingPath: ['H'], content: 'neighbor evidence', graphPath: ['a', 'b'] }], attemptedKbs: 1 }
      },
    } as any,
    { chatTask: async () => ({ content: '{"query":"q","keywords":[]}' }) } as any,
  )

  const result = await service.retrieve('对比 x 和 y 的区别', '507f1f77bcf86cd799439012', undefined, {
    intent: 'compare', tools: ['chunk_vector', 'graph_expand'], reasoningMode: 'deep', graphHops: 1,
  })

  assert.deepEqual(autoSeeds, [{ chunkId: 'chunk-seed', noteId: 'note-1' }], '种子应来自 chunk_vector 候选')
  const graphHit = result.evidence.find((item: any) => item.chunkId === 'chunk-neighbor')
  assert.ok(graphHit, '自动扩图证据应进入候选')
  assert.equal(graphHit.source, 'graph_expand')
  assert.deepEqual(graphHit.graphPath, ['a', 'b'])
  assert.equal(result.warnings.some((warning: string) => warning.includes('跳过图谱扩展')), false, '有库可扩时不得提示跳过')
})

test('无 knowledgeBaseId 且无自有库可扩时提示跳过、普通候选不受影响', async () => {
  const service = new RagRetrievalService(
    {
      searchKeywordChunks: async () => [],
      searchChunks: async () => [{ chunkId: 'chunk-seed', noteId: 'note-1', title: 'Seed', headingPath: [], content: 'seed evidence', score: 0.9 }],
    } as any,
    { expandGraphEvidenceAuto: async () => ({ evidence: [], attemptedKbs: 0 }) } as any,
    { chatTask: async () => ({ content: '{"query":"q","keywords":[]}' }) } as any,
  )

  const result = await service.retrieve('对比 x 和 y 的区别', '507f1f77bcf86cd799439012', undefined, {
    intent: 'compare', tools: ['chunk_vector', 'graph_expand'], reasoningMode: 'deep', graphHops: 1,
  })

  assert.equal(result.warnings.includes('未找到可用的知识库图谱，已跳过图谱扩展'), true)
  assert.equal(result.evidence.some((item: any) => item.chunkId === 'chunk-seed'), true, '普通检索候选不受影响')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/rag-retrieval-orchestration.test.ts`
Expected: FAIL（自动扩图未接线 → 出现旧 warning「未指定知识库，已跳过图谱扩展」、无 graph_expand 候选）。

- [ ] **Step 3: 最小实现**

将 `rag-retrieval.service.ts` 第 19-23 行替换为：

```ts
    if (plan.tools.includes('graph_expand') && knowledgeBaseId) {
      const graph = await this.knowledgeBases.expandGraphEvidence(knowledgeBaseId, userId, candidates.map((item) => item.chunkId))
      candidates.push(...graph.map((item: any) => ({ ...item, excerpt: item.content.slice(0, 700), content: item.content.slice(0, 1200), score: 0.35, source: 'graph_expand' as RagTool })))
    } else if (plan.tools.includes('graph_expand')) {
      // 全笔记 RAG：planner 判定可扩图但未指定知识库时，自动反查自有库扩图（见 expandGraphEvidenceAuto），
      // 让 compare 类问题在全笔记范围也能用上图谱邻居证据；仅当无自有库可扩时才提示跳过。
      const auto = await this.knowledgeBases.expandGraphEvidenceAuto(userId, candidates.map((item) => ({ chunkId: item.chunkId, noteId: item.noteId })))
      if (auto.attemptedKbs === 0) warnings.push('未找到可用的知识库图谱，已跳过图谱扩展')
      else candidates.push(...auto.evidence.map((item: any) => ({ ...item, excerpt: item.content.slice(0, 700), content: item.content.slice(0, 1200), score: 0.35, source: 'graph_expand' as RagTool })))
    } else warnings.push('本次未使用知识图谱扩展')
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test -r ts-node/register -r tsconfig-paths/register test/rag-retrieval-orchestration.test.ts`
Expected: PASS（原 2 条 + 新 2 条）。

- [ ] **Step 5: 提交**

```powershell
@'
feat(rag): 全笔记检索接入自动图谱扩展

无 knowledgeBaseId 的 compare 类 RAG 自动反查自有库扩图，替换原先
「未指定知识库，已跳过图谱扩展」的跳过行为；无候选库时才提示跳过。
'@ | Set-Content -Encoding utf8 $env:TEMP\commit-msg.txt
git add notes-backend/src/modules/ai/rag/rag-retrieval.service.ts notes-backend/test/rag-retrieval-orchestration.test.ts
git commit -F $env:TEMP\commit-msg.txt
Remove-Item $env:TEMP\commit-msg.txt
```

---

### Task 3: 全量验证与文档

**Files:**
- Modify: `docs/debug-records.md`（可选，见 Step 4）

**Interfaces:**
- Consumes: Task 1-2 的改动。

- [ ] **Step 1: 后端全量单测**

Run（在 `notes-backend` 下）: `npm run test:unit`
Expected: 全部 PASS（含原 446 条与新增约 7 条）。

- [ ] **Step 2: 后端编译**

Run: `npm run build`
Expected: 无类型错误。

- [ ] **Step 3: 真实链路验收（需后端运行 + 测试账号，可选）**

在小助手界面（不选知识库）提问「我笔记里的二叉搜索树第 k 小元素，递归中序遍历和栈迭代有什么区别？」：
Expected: `complete.planSummary.tools` 含 `graph_expand`、无「未找到可用的知识库图谱」类 warning，回答引用能体现邻居节点内容（函数调用开销/栈溢出/提前终止）。

- [ ] **Step 4: 更新 Debug 记录（用户确认修复后）**

当用户确认该能力可用后，按 `docs/debug-records.md` 格式追加一条：现象（小助手回答从不使用知识图谱扩展）、根因（前端不上送 knowledgeBaseId + 全笔记 RAG 无自动反查）、修复方案（自动反查自有库扩图）、相关文件、经验教训（UI 缺知识库范围入口时，后端可在 ACL 边界内自动反查，避免结构性不可达）。

- [ ] **Step 5: 提交**

```powershell
@'
docs: 记录小助手自动图谱扩展问题
'@ | Set-Content -Encoding utf8 $env:TEMP\commit-msg.txt
git add docs/debug-records.md
git commit -F $env:TEMP\commit-msg.txt   # 仅当 Step 4 产生改动
Remove-Item $env:TEMP\commit-msg.txt
```
