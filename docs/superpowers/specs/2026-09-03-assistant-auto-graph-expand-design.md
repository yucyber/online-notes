# 无知识库 RAG 的自动图谱扩展设计

- **日期**：2026-09-03
- **范围**：notes-backend 后端检索链路
- **状态**：设计稿（待评审）

## 背景与动机

小助手（assistant）的 RAG 回答希望“能够使用知识图谱扩展”。经排查与实测确认：

1. 后端扩图链路在**携带 `knowledgeBaseId`** 时完全可用：对「二叉搜索树第 k 小元素，递归 vs 栈迭代」这类 compare 问题，
   返回 `planSummary.tools: ["chunk_vector", "graph_expand", "rerank"]`、`graphHops: 1`、4 条引用，回答正文用上了
   递归函数调用开销、栈溢出、提前终止等**一跳邻居节点**才带来的证据。
2. 唯一断点是**小助手前端从不发送 `knowledgeBaseId`**（输入区只有“搜索笔记”二元开关，spec 中“选择知识库范围”从未实现），
   因此全笔记 RAG 时 `RagRetrievalService.retrieve()` 走到 `else if (plan.tools.includes('graph_expand'))` 分支，
   直接跳过扩图并提示「未指定知识库，已跳过图谱扩展」。

本设计**不新增 UI**，改为后端在无 `knowledgeBaseId` 的全笔记检索中，自动反查用户自有知识库图谱并做一跳扩展。

## 目标行为

小助手全笔记 RAG（`knowledgeBaseId` 缺省）时，只要 planner 计划含 `graph_expand`（当前即 compare/对比/区别类问题），后端自动：

1. 由种子 chunk 的 `noteId` 反查**当前用户拥有**且**链接了这些笔记**的知识库；
2. 在每个命中的知识库内各做**一跳**图谱扩展（复用现有逐库算法与全部 ACL 校验）；
3. 按 chunkId 去重合并证据（保留最高分与 graphPath，已有 `mergeEvidence`）。

## 数据模型与 ACL 现状（设计依据）

- 知识库归 `userId` 所有（`knowledge_bases.userId`）；库可链接**当前用户可读**的笔记（`knowledge_base_notes`: kbId + noteId + userId）。
- 图节点/边按 `{ knowledgeBaseId, userId }` 归属，`evidenceChunkIds` 绑定笔记 chunk（`knowledge_graph_nodes/edges`）。
- 每次读取图谱证据都重新执行三重校验：KB 归属（`requireKnowledgeBase`）→ 链接笔记 NoteAccess 可读过滤 →
  chunk 存在性 + `userId` 归属 + 可读 noteId allowlist。
- `knowledge_base_notes.userId` 与 KB 所有者一致：**链接行本身就是“自有库”判据**，无需单独成员模型。

## 具体改动

### `knowledge-bases.service.ts`：新增 `expandGraphEvidenceAuto`

```ts
// 全笔记 RAG 自动扩图：从命中 chunk 的 noteId 反查自有知识库，逐库一跳扩展并合并。
// 返回 attemptedKbs 供检索层区分“无库可扩”（提示）与“扩了但为空”（与显式选库路径一致，静默）。
type GraphExpandSeed = { chunkId: string; noteId: string }
type GraphExpandEvidenceItem = { chunkId: string; noteId: string; noteTitle: string; headingPath: string[]; content: string; graphPath: string[] }

async expandGraphEvidenceAuto(
  userId: string,
  seeds: GraphExpandSeed[],
): Promise<{ evidence: GraphExpandEvidenceItem[]; attemptedKbs: number }>
```

实现步骤：

1. 过滤合法 chunkId（`Types.ObjectId.isValid`），取 distinct `noteId`；
2. `knowledge_base_notes.find({ userId, noteId: { $in: noteIds } }).distinct('knowledgeBaseId')` 得候选 kbId；
3. 为控制延迟与范围，候选库取前 `AUTO_GRAPH_EXPAND_KB_CAP = 5`（按 `_id` 升序取前 5，超出部分本轮不扩展）；
4. 对每个候选库调用现有 `expandGraphEvidence(kbId, userId, chunkIds)`（内部自带 KB 归属、NoteAccess、
   chunk 归属三重校验），合并去重后的证据；
5. `attemptedKbs = 实际参与扩展的库数`（即上一步循环的库数，候选为空时为 0）。

复用现有 `expandGraphEvidence` 意味着自动路径与显式选库路径的 ACL 语义**逐字节一致**，无需新增权限分支。
扩图为空（库链接了种子笔记但无图谱/无绑定证据）时与显式选库路径一致：不追加 warning、静默跳过。

### `rag-retrieval.service.ts`：`retrieve()` 分支重构

现状（`rag-retrieval.service.ts:19-23`）：

```ts
if (plan.tools.includes('graph_expand') && knowledgeBaseId) {
  // 显式选库 → 现有 expandGraphEvidence
} else if (plan.tools.includes('graph_expand')) {
  warnings.push('未指定知识库，已跳过图谱扩展')
} else {
  warnings.push('本次未使用知识图谱扩展')
}
```

改为：

```ts
if (plan.tools.includes('graph_expand') && knowledgeBaseId) {
  // 显式选库 → 现有 expandGraphEvidence（不变）
} else if (plan.tools.includes('graph_expand')) {
  // 全笔记 RAG → 自动反查自有知识库扩图
  const seeds = candidates.map((item) => ({ chunkId: item.chunkId, noteId: item.noteId }))
  const auto = await this.knowledgeBases.expandGraphEvidenceAuto(userId, seeds)
  if (auto.attemptedKbs === 0) warnings.push('未找到可用的知识库图谱，已跳过图谱扩展')
  else candidates.push(...auto.evidence.map((item) => ({ ...item, excerpt: item.content.slice(0, 700), content: item.content.slice(0, 1200), score: 0.35, source: 'graph_expand' as RagTool })))
} else {
  warnings.push('本次未使用知识图谱扩展')  // 不变
}
```

- 候选仍受 `mergeEvidence().slice(0,30)` → 最终 `slice(0,10)` 上限保护，扩图不会失控放大回答输入。
- 旧文案「未指定知识库，已跳过图谱扩展」不再出现（它暗示用户需要“选库”，与自动扩图后的语义不符）。

## 边界与约束

- **只扩用户自有知识库**：通过 `knowledge_base_notes.userId = 当前用户` 过滤。共享/公开笔记若不属于自有库则不扩展——无 ACL 泄漏。
- `graphHops` 仍固定 1；每个候选库独立一跳，不做跨库多跳。
- `graphPath` 的 nodeId 是库内字符串、跨库可能重名：仅作展示/调试字段，不参与 ACL 判定，可接受。
- planner 触发条件**不变**（仅 compare 类问题启用 `graph_expand`），不引入“每次提问都扩图”的成本。
- 显式选库路径、其余 warning 文案、rerank、最终证据截断逻辑保持不变。

## 测试计划

### 服务层（`knowledge-bases.service`，新测试文件或扩展现有）

- 只命中自有库：两个库，一个链接种子笔记、一个不链接 → 只扩展前者。
- 仅扩链接了种子笔记的库；他人库（kbNote 行 userId 不同）不命中。
- 失权笔记过滤：候选库链接的笔记中，失权（无法读）的不进结果（复用既有 expandGraphEvidence ACL 语义）。
- 无合法种子 / 无候选库 → `attemptedKbs: 0`、空证据、不抛错。
- 候选库超过 `AUTO_GRAPH_EXPAND_KB_CAP` 时只扩展前 cap 个。

### 检索层（`rag-retrieval.service`）

- 无 `knowledgeBaseId` + plan 含 `graph_expand` → 自动扩图证据并入候选（`source:'graph_expand'`、带 `graphPath`），
  不出现「跳过图谱扩展」类 warning。
- 无库可扩（`attemptedKbs: 0`）→ 出现「未找到可用的知识库图谱，已跳过图谱扩展」，普通候选不受影响。
- 显式选库路径回归：原 orchestration 测试继续通过。

### 验收（真实链路）

小助手界面（不选知识库）提问「我笔记里的二叉搜索树第 k 小元素，递归中序遍历和栈迭代有什么区别？」：
- 不再出现「未指定知识库，已跳过图谱扩展」；
- `complete.planSummary` 含 `graph_expand`、`graphHops: 1`；
- 回答能用上函数调用开销 / 栈溢出 / 提前终止等邻居节点内容（与带 KB 实测结果一致）。

## 非目标（本轮不做）

- 不改前端（不加知识库选择器、不加会话级绑定 UI）。
- 不改 QueryPlanner 触发规则（不扩展 graph_expand 到 explain/lookup）。
- 不做多跳（graphHops > 1）。
- 不新增 API 请求字段；不建 KB 成员/共享模型。
