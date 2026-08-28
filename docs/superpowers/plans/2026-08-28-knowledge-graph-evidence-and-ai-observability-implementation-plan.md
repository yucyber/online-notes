# 知识图谱证据体验与 AI 性能观测 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让知识图谱展示可定位的完整 Chunk 证据、生成有证据的跨笔记中文关系，并提供面向当前用户全部 AI task 的阶段耗时面板。

**Architecture:** 证据接口继续在读取时重验 knowledgeBase、NoteAccess 和 NoteChunk 范围，响应同时提供 preview 与完整纯文本 content；前端按 node/edge 懒加载证据并通过 chunkId/headingPath 定位笔记。现有 AiRun 扩展为阶段计时和安全规模指标，业务服务记录上下文阶段，gateway 记录容量、provider attempt 与校验阶段，设置页通过只读聚合 API 展示 P50/P95 和单次瀑布图。

**Tech Stack:** Node.js 22、NestJS 10、Mongoose 8、Next.js 16、React 18、TypeScript、React Flow、Jest、Node Test Runner。

## Global Constraints

- 当前工作区和分支继续使用，不新建 worktree；保留并隔离任何用户未提交改动。
- 严格 TDD：每项行为先写失败测试并确认按预期失败，再写最小实现。
- 完整内容仅指一个 Chunk，不通过证据 API 返回整篇 Note。
- 所有证据、图谱和性能查询只使用认证上下文 userId，并重新应用 ACL 与 knowledgeBase 边界。
- 无可靠跨笔记关系时允许图谱断开，不为连通性编造关系。
- 不保存 prompt、正文、Chunk content、reasoning、API key 或供应商完整响应到 AiRun、日志和 warnings。
- 历史 graph 和历史 AiRun 必须兼容；缺少新字段不得返回 500。
- 普通 CRUD 不写注释；复杂权限、失败降级和计时边界用简洁中文解释原因。
- 不进入 GraphRAG、整理 proposal、自动修改笔记或真实图谱覆盖写入，除非用户另行确认。
- Commit message 使用中文，并通过 UTF-8 文件传给 `git commit -F`。

---

### Task 1：返回完整但受权限约束的 Chunk 证据

**Files:**
- Modify: `notes-backend/src/modules/knowledge-bases/knowledge-bases.service.ts`
- Modify: `notes-backend/openapi.yaml`
- Modify: `notes-frontend/src/lib/api/knowledge-bases.ts`
- Modify: `notes-backend/test/knowledge-graph-evidence-access.test.ts`

**Interfaces:**
- Consumes: `KnowledgeBasesService.getGraphEvidence(id, kind, graphItemId, userId)`。
- Produces: `KnowledgeGraphEvidence { noteId, noteTitle, chunkId, headingPath, preview, content }`；`content` 为完整单 Chunk 纯文本，`preview` 最长 320 字符。

- [ ] **Step 1：写失败测试，证明完整 Chunk 尚未返回**

在 `knowledge-graph-evidence-access.test.ts` 使用超过 800 字符且包含 `<script>`、`<style>`、HTML 标签的 Chunk，断言：

```ts
assert.equal(result.items[0].content.length, expectedPlainText.length)
assert.equal(result.items[0].preview, expectedPlainText.slice(0, 320))
assert.doesNotMatch(result.items[0].content, /<script|<style|<h2|alert\(/i)
assert.equal(result.items[0].chunkId, chunkId)
```

增加当前用户失去 NoteAccess、Note 移出 knowledgeBase、Chunk 删除三种 fixture，断言 `items` 为空且不会抛出 500。

- [ ] **Step 2：运行 RED**

Run:

```powershell
cd notes-backend
& "$env:NVM_HOME\v22.22.3\node.exe" --require ts-node/register --require tsconfig-paths/register --test test/knowledge-graph-evidence-access.test.ts
```

Expected: FAIL，当前响应只有 `excerpt`，没有 `preview/content`。

- [ ] **Step 3：最小实现完整纯文本证据**

将净化 helper 改为不截断的 `graphEvidenceContent`，响应中派生 preview：

```ts
const content = this.graphEvidenceContent(value.content)
return [{
  noteId,
  noteTitle: noteTitleById.get(noteId)!,
  chunkId,
  headingPath: (Array.isArray(value.headingPath) ? value.headingPath : []).map(String),
  preview: content.slice(0, 320),
  content,
}]
```

保留现有 `_id/userId/noteId` 查询求交、稳定排序、去重与失效证据过滤。

- [ ] **Step 4：同步 OpenAPI 与前端类型**

`KnowledgeGraphEvidence` 删除 `excerpt`，增加：

```yaml
preview: { type: string, maxLength: 320 }
content: { type: string }
```

前端类型同步为 `preview: string; content: string`。

- [ ] **Step 5：运行 GREEN 与契约检查**

```powershell
cd notes-backend
& "$env:NVM_HOME\v22.22.3\node.exe" --require ts-node/register --require tsconfig-paths/register --test test/knowledge-graph-evidence-access.test.ts
cd ..
& "$env:NVM_HOME\v22.22.3\node.exe" scripts/check-api-contract.mjs
```

Expected: 定向测试通过；backend/OpenAPI operation 数一致。

- [ ] **Step 6：提交**

Commit: `feat(graph): 返回完整原文证据`

---

### Task 2：node/edge 证据面板与笔记原文定位

**Files:**
- Modify: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphCanvas.tsx`
- Create: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphEvidenceList.tsx`
- Modify: `notes-frontend/src/styles/product-tokens.css`
- Modify: `notes-frontend/src/app/dashboard/notes/[id]/page.tsx`
- Modify as required by existing editor boundary: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-backend/src/modules/notes/notes.controller.ts`
- Modify: `notes-backend/src/modules/notes/notes.service.ts`
- Modify: `notes-backend/openapi.yaml`
- Create: `notes-backend/test/note-chunk-location-access.test.ts`
- Create: `notes-frontend/__tests__/knowledge-graph-evidence-panel.spec.tsx`
- Create: `notes-frontend/__tests__/note-chunk-location.spec.tsx`

**Interfaces:**
- Consumes: `knowledgeBasesAPI.getNodeEvidence`、`getEdgeEvidence` 和 Task 1 的 `KnowledgeGraphEvidenceResult`。
- Produces: `KnowledgeGraphEvidenceList`；URL query 固定为 `chunkId=<id>&heading=<encoded path>`；`GET /notes/:noteId/chunks/:chunkId/location` 返回 `{ chunkId, headingPath, anchorText }`。

- [ ] **Step 1：写证据面板 RED 测试**

测试真实组件行为：选择 node 后请求 node evidence；选择 edge 后请求 edge evidence；默认显示 preview；点击“展开更多”显示完整 content；切换选择时旧请求晚到不能覆盖新证据。

关键断言：

```tsx
expect(mockKnowledgeBasesAPI.getNodeEvidence).toHaveBeenCalledWith('kb-1', 'node-a')
expect(screen.getByText('短预览')).toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: '展开更多' }))
expect(screen.getByText('完整 Chunk 内容')).toBeInTheDocument()
expect(screen.getByRole('link', { name: '定位到原文' })).toHaveAttribute(
  'href',
  '/dashboard/notes/note-1?chunkId=chunk-1&heading=Root%20%3E%20Child',
)
```

- [ ] **Step 2：运行证据面板 RED**

```powershell
cd notes-frontend
$env:Path="$env:NVM_HOME\v22.22.3;$env:Path"
npx jest __tests__/knowledge-graph-evidence-panel.spec.tsx --runInBand
```

Expected: FAIL，当前 `KnowledgeGraphCanvas` 只展示来源笔记 summary。

- [ ] **Step 3：实现独立证据列表与陈旧请求保护**

`KnowledgeGraphEvidenceList` 自己管理 loading/error/expandedChunkIds；父组件传入 `knowledgeBaseId`、`kind`、`graphItemId`。effect 使用 request id 或 AbortController，cleanup 后忽略旧响应。完整 content 仅在用户展开时进入可见 DOM，避免长文本默认渲染。

- [ ] **Step 4：让 React Flow 支持 edge 选择**

在 `KnowledgeGraphCanvas` 增加 `selectedKind` 和 `selectedId`，`onNodeClick`、`onEdgeClick` 互斥选择；详情标题分别显示“节点详情”和“关系详情”。关系详情显示 source、relation、target，并加载 edge evidence。

- [ ] **Step 5：写受权限约束的定位 API RED 测试**

后端测试覆盖 owner、共享 reader、无权限用户、chunk 属于其他 Note、chunk 已删除。合法响应为：

```ts
{
  chunkId: 'chunk-1',
  headingPath: ['Root', 'Child'],
  anchorText: '该 Chunk 净化后开头最多 160 个字符'
}
```

查询必须同时满足 `_id=chunkId`、`noteId=route noteId`，并先通过 `NoteAccess.readScope`；无权限、伪造或跨 Note 均沿用 NotFound 安全语义。

- [ ] **Step 6：运行定位 API RED 并最小实现**

```powershell
cd notes-backend
& "$env:NVM_HOME\v22.22.3\node.exe" --require ts-node/register --require tsconfig-paths/register --test test/note-chunk-location-access.test.ts
```

Expected: FAIL，当前没有 location route。实现后更新 OpenAPI，并重跑至 PASS。

- [ ] **Step 7：写前端原文定位 RED 测试**

覆盖：有效 chunkId 定位并滚动；chunkId 失效后按 headingPath 定位；两者都失败时页面正常渲染且显示“未找到原证据位置”。测试断言目标元素获得临时定位样式或调用 `scrollIntoView`。

- [ ] **Step 8：实现定位降级**

笔记加载与编辑器渲染完成后调用 location API，使用 `anchorText` 在 ProseMirror 纯文本节点中定位对应 DOM 范围并滚动；anchor 不匹配时按 headingPath 定位标题；仍失败时打开笔记顶部并提示。定位过程不得改变 Y.Doc 或 Note content。

- [ ] **Step 9：运行 GREEN**

```powershell
npx jest __tests__/knowledge-graph-evidence-panel.spec.tsx __tests__/note-chunk-location.spec.tsx __tests__/knowledge-bases.spec.tsx --runInBand
npm run type-check
```

Expected: 所有断言通过，type-check 通过。

- [ ] **Step 10：提交**

Commit: `feat(frontend): 展开并定位图谱证据`

---

### Task 3：生成跨笔记中文关系并缩短 proposal 输出

**Files:**
- Modify: `notes-backend/src/modules/ai/graphs/knowledge-graph-build.graph.ts`
- Modify: `notes-backend/src/modules/knowledge-bases/knowledge-graph-normalize.ts`
- Modify: `notes-backend/test/knowledge-graph-build-graph.test.ts`
- Modify: `notes-backend/test/knowledge-graph-normalize.test.ts`

**Interfaces:**
- Consumes: 当前 `KnowledgeGraphBuildInput` 的 note/chunk 候选。
- Produces: 默认最多 24 nodes、36 edges；缺省关系为“相关”；模型 prompt 优先有证据的跨 noteId 中文关系。

- [ ] **Step 1：写跨笔记和中文关系 RED 测试**

fixture 使用两篇笔记的两个 Chunk，gateway 返回一条跨 noteId edge。断言 prompt 包含“优先发现不同 Note ID 之间有证据的关系”“关系使用简洁中文”“没有可靠证据时不要连线”；proposal edge 保留两个合法 evidenceChunkIds。

增加缺 relation 的 edge fixture，断言 fallback 为“相关”而不是 `related to`。增加 30 nodes/50 edges fixture，断言输出限制为 24/36。

- [ ] **Step 2：运行 RED**

```powershell
cd notes-backend
& "$env:NVM_HOME\v22.22.3\node.exe" --require ts-node/register --require tsconfig-paths/register --test test/knowledge-graph-build-graph.test.ts test/knowledge-graph-normalize.test.ts
```

Expected: prompt、中文 fallback 和新上限断言失败。

- [ ] **Step 3：最小修改 prompt 与默认上限**

构造函数默认值改为：

```ts
this.maxNodes = options.maxNodes || 24
this.maxEdges = options.maxEdges || 36
```

调用 `chatTask` 的 `maxTokens` 从 2400 下调到 1400。prompt 明确要求跨笔记比较、中文 relation、证据不足保持断开、合并近义节点，并优先保留跨笔记边和高价值内部边。

- [ ] **Step 4：统一中文 fallback**

`knowledge-graph-build.graph.ts` 和 `knowledge-bases.service.ts` 的本地缺省关系统一为“相关”；不对模型输出做自动翻译。

- [ ] **Step 5：运行 GREEN 与 build**

```powershell
& "$env:NVM_HOME\v22.22.3\node.exe" --require ts-node/register --require tsconfig-paths/register --test test/knowledge-graph-build-graph.test.ts test/knowledge-graph-normalize.test.ts test/knowledge-graph-persistence.test.ts
& "$env:NVM_HOME\v22.22.3\node.exe" node_modules/typescript/bin/tsc
```

Expected: 定向测试和 build 通过。

- [ ] **Step 6：提交**

Commit: `feat(graph): 生成跨笔记中文关系`

---

### Task 4：为全部 AI task 记录安全的阶段耗时

**Files:**
- Modify: `notes-backend/src/modules/ai/schemas/ai-run.schema.ts`
- Modify: `notes-backend/src/modules/ai/ai-run.service.ts`
- Modify: `notes-backend/src/modules/ai/ai-gateway.client.ts`
- Modify: `notes-backend/src/modules/ai/ai.service.ts`
- Modify: `notes-backend/src/modules/ai/graphs/knowledge-graph-build.graph.ts`
- Create: `notes-backend/src/modules/ai/ai-run-timing.ts`
- Modify: `notes-backend/test/ai-run.test.ts`
- Modify: `notes-backend/test/ai-run-routing-audit.test.ts`
- Create: `notes-backend/test/ai-run-stages.test.ts`

**Interfaces:**
- Produces: `AiRunStageName`、`AiRunStage`、`AiRunMetrics`、`AiRunTiming`。
- `AiRunService.addStage(runId, stage)` 原子追加阶段；`mergeMetrics(runId, metrics)` 仅接受数字字段。
- `AiRunService.start` 由业务入口调用并返回 runId；`AiGatewayClient.chatTask({ audit: { runId } })` 复用同一 run，在其中记录 capacity/provider/validation；未传 runId 的旧调用仍由 gateway 创建 run。

- [ ] **Step 1：写阶段计时 RED 测试**

覆盖 primary 成功、一次 retry、quality fallback、provider fallback、validation 失败、AiRun 写失败不影响业务响应。断言 stages 顺序、attempt、provider/model、fallbackType、非负 durationMs；递归断言保存对象不含 `prompt/content/reasoning/apiKey`。

- [ ] **Step 2：运行 RED**

```powershell
cd notes-backend
& "$env:NVM_HOME\v22.22.3\node.exe" --require ts-node/register --require tsconfig-paths/register --test test/ai-run-stages.test.ts test/ai-run.test.ts test/ai-run-routing-audit.test.ts
```

Expected: FAIL，AiRun 尚无 stages/metrics 和追加接口。

- [ ] **Step 3：定义 schema 和纯计时器**

`AiRunStage` 仅包含设计文档允许字段。`AiRunTiming.measure(name, work, metadata)` 使用 `performance.now()`，在成功和失败路径都生成 stage；不捕获 work 的输入或输出。

- [ ] **Step 4：实现原子审计更新**

`addStage` 使用 `$push: { stages: sanitizedStage }`；`mergeMetrics` 白名单只允许 `inputChars/candidateNotes/candidateChunks/outputChars` 且规范为非负整数。审计异常由 gateway 记录安全 warning 后降级，不改变 AI 请求结果。

为防止重复 run，新增明确契约：

```ts
type AiWorkflowAudit = {
  graphName: string
  userId?: string
  runId?: string
}
```

gateway 的 `startTaskRun` 在 `audit.runId` 存在时直接复用；不存在时保持当前自动创建行为。

- [ ] **Step 5：接入 gateway attempt 边界**

在 capacity reserve 前后记录 `capacity_wait`；每次真实 fetch/parse 形成独立 `provider` stage；结构校验形成 `validation` stage。retry 与 fallback 各自产生新的 attempt 序号，不把多个请求合并成一个 provider duration。

- [ ] **Step 6：接入业务上下文阶段**

`AiService.buildKnowledgeGraphProposal` 在调用 `listGraphNotes` 前创建 runId，把 knowledgeBase/ACL/Note/Chunk 查询到 prompt 候选准备记录为 `context_prepare`，再把 runId 传给 `KnowledgeGraphBuildGraph.run` 和 gateway。其他已有 AI task 至少记录 provider/validation；只有确实存在业务准备步骤的调用点才增加 context_prepare。

- [ ] **Step 7：运行 GREEN 与全量相关测试**

```powershell
& "$env:NVM_HOME\v22.22.3\node.exe" --require ts-node/register --require tsconfig-paths/register --test test/ai-run-stages.test.ts test/ai-run.test.ts test/ai-run-routing-audit.test.ts test/ai-gateway.test.ts test/knowledge-graph-build-graph.test.ts
```

Expected: 全部通过，测试输出中没有未关闭的 run/stage。

- [ ] **Step 8：提交**

Commit: `feat(ai): 记录请求阶段耗时`

---

### Task 5：提供当前用户的 AI 性能查询 API

**Files:**
- Modify: `notes-backend/src/modules/ai/ai.controller.ts`
- Modify: `notes-backend/src/modules/ai/ai-run.service.ts`
- Modify: `notes-backend/src/modules/ai/dto/index.ts`
- Modify: `notes-backend/openapi.yaml`
- Create: `notes-backend/test/ai-run-performance-access.test.ts`

**Interfaces:**
- Produces: `GET /ai/runs/performance` 与 `GET /ai/runs/:runId`。
- Query: `from`、`to`、`task`、`provider`、`model`、`status`、`fallbackUsed`、`page`、`size`。
- Summary: `requestCount/successRate/fallbackRate/p50Ms/p95Ms/byTask/recentRuns`。

- [ ] **Step 1：写权限和聚合 RED 测试**

创建两个 userId 的 AiRun fixture，断言认证用户只能看到自己的记录；用手算数组 `[100, 200, 300, 900]` 断言 P50/P95；覆盖 task/provider/status/date 筛选、分页、旧记录无 stages 和伪造 runId。

- [ ] **Step 2：运行 RED**

```powershell
cd notes-backend
& "$env:NVM_HOME\v22.22.3\node.exe" --require ts-node/register --require tsconfig-paths/register --test test/ai-run-performance-access.test.ts
```

Expected: FAIL，controller/service 尚无性能查询方法。

- [ ] **Step 3：实现 DTO 与用户范围查询**

日期窗口默认 7 天、最大 90 天；size 默认 20、最大 100。service 的所有 find/aggregate 首层条件固定包含 `userId: new Types.ObjectId(authenticatedUserId)`。runId 不存在或属于其他用户统一返回 NotFound。

- [ ] **Step 4：实现稳定百分位与阶段聚合**

百分位使用排序后的 nearest-rank：

```ts
const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}
```

旧记录 stages 为空时保留 total duration，不伪造阶段分布。

- [ ] **Step 5：更新 OpenAPI 并运行契约测试**

```powershell
cd ..
& "$env:NVM_HOME\v22.22.3\node.exe" scripts/check-api-contract.mjs
& "$env:NVM_HOME\v22.22.3\node.exe" scripts/check-api-contract.test.mjs
```

Expected: 无新增未登记 drift，契约测试通过。

- [ ] **Step 6：提交**

Commit: `feat(ai): 查询个人性能指标`

---

### Task 6：设置页 AI 性能面板与知识图谱本次耗时

**Files:**
- Create: `notes-frontend/src/lib/api/ai-runs.ts`
- Create: `notes-frontend/src/components/settings/AiPerformancePanel.tsx`
- Create: `notes-frontend/src/components/settings/AiRunWaterfall.tsx`
- Modify: `notes-frontend/src/app/dashboard/settings/page.tsx`
- Modify: `notes-frontend/src/components/knowledge-bases/useKnowledgeBasePage.ts`
- Modify: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphPanel.tsx`
- Create: `notes-frontend/__tests__/ai-performance-panel.spec.tsx`
- Modify: `notes-frontend/__tests__/knowledge-bases.spec.tsx`

**Interfaces:**
- Consumes: Task 5 性能 API。
- Produces: 当前用户概览、筛选、最近请求表、单次阶段瀑布；知识图谱生成完成后显示总耗时和阶段摘要。

- [ ] **Step 1：写性能面板 RED 测试**

mock API 返回 requestCount、成功率、fallback 率、P50/P95、byTask 与 recentRuns，断言概览卡、task/date 筛选、阶段堆叠数据、最近请求、旧记录标记和详情瀑布均可访问。不要断言图表库内部 DOM。

- [ ] **Step 2：运行 RED**

```powershell
cd notes-frontend
$env:Path="$env:NVM_HOME\v22.22.3;$env:Path"
npx jest __tests__/ai-performance-panel.spec.tsx --runInBand
```

Expected: FAIL，面板与 client 尚不存在。

- [ ] **Step 3：实现轻量 CSS 图表和详情抽屉**

不新增图表依赖。阶段堆叠条按总时长比例使用 CSS flex；瀑布图按 stage duration 显示可读毫秒/秒数。列表使用稳定 key 和分页，不在 render 中重复排序大数组。

- [ ] **Step 4：接入设置页**

在现有设置分组增加“AI 性能”，只有用户进入该分组时才请求数据；筛选变化触发新请求并忽略陈旧响应。错误态提供重试，不影响个人资料设置。

- [ ] **Step 5：写知识图谱本次耗时 RED 测试**

`buildGraphProposal` 响应或后续 run 查询返回 timing 摘要，断言生成中显示“准备数据/生成中”，成功后显示“总耗时 19.2 秒 · 模型 17.8 秒”，失败后清除运行状态并保留安全错误。

- [ ] **Step 6：实现本次耗时展示**

只展示后端真实计时；若响应没有 runId/stages，则显示已有总请求耗时并注明“阶段明细不可用”，不得用前端估算冒充服务端阶段数据。

- [ ] **Step 7：运行 GREEN、type-check 与 build**

```powershell
npx jest __tests__/ai-performance-panel.spec.tsx __tests__/knowledge-bases.spec.tsx --runInBand
npm run type-check
npm run build
```

Expected: 定向测试、type-check、build 通过。

- [ ] **Step 8：提交**

Commit: `feat(frontend): 展示 AI 性能面板`

---

### Task 7：全量验证与真实验收门

**Files:**
- Modify: `docs/superpowers/plans/2026-08-27-knowledge-ai-platform-master-execution-plan.md`
- Modify only after user confirms bug resolution: `docs/debug-records.md`

- [ ] **Step 1：运行后端全量单测和 build**

```powershell
cd notes-backend
& "$env:NVM_HOME\v22.22.3\node.exe" scripts/run-unit-tests.mjs
& "$env:NVM_HOME\v22.22.3\node.exe" node_modules/typescript/bin/tsc
```

Expected: 0 failed，build exit 0。

- [ ] **Step 2：运行前端全量测试、type-check 和 build**

```powershell
cd ../notes-frontend
$env:Path="$env:NVM_HOME\v22.22.3;$env:Path"
npm run ci:test
npm run type-check
npm run build
```

Expected: 0 failed；若既有 Tiptap 竞态仍失败，复现并证明与本轮无关后单独报告，不混入本功能提交。

- [ ] **Step 3：运行契约与 diff 检查**

```powershell
cd ..
node scripts/check-api-contract.mjs
node scripts/check-api-contract.test.mjs
git diff --check
git status --short
```

- [ ] **Step 4：真实请求前只读确认范围**

报告将重新生成的 knowledgeBase、node/edge 覆盖范围；未经用户明确确认，不保存或覆盖真实图谱。

- [ ] **Step 5：用户确认后执行真实知识图谱验收**

使用三篇存在明确关联的测试笔记生成 proposal，记录：总耗时、context_prepare、capacity_wait、provider、validation、nodes、edges、跨笔记 edges、中文 relation 比例、evidenceChunkIds 有效率。保存前再次展示覆盖范围并取得确认。

- [ ] **Step 6：验证证据定位和性能面板**

展开完整 Chunk，点击定位到原文；在设置页确认该次 knowledge_graph run 的阶段之和与总耗时一致，并确认其他 AI task 可筛选、其他用户数据不可见。

- [ ] **Step 7：更新总计划和 Debug 记录**

只勾选有自动化或真实证据的项目。用户明确确认“已解决”后，将 59 秒现象、根因、优化和观测方式追加到 `docs/debug-records.md`。

- [ ] **Step 8：提交验收记录**

Commit: `docs(ai): 记录图谱与性能验收结果`
