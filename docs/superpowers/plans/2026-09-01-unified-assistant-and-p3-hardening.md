# Unified Assistant and P3 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付统一的小助手对话体验，可靠恢复本地历史，并修复 P3 GraphRAG 的引用定位、共享笔记检索、图谱一跳扩展、无效引用和 Query rewrite 候选融合问题。

**Architecture:** 前端只保留一个连续消息流，通过确定性规则或“搜索笔记”开关路由到现有 pet/RAG 接口；后端仍维持闲聊与带 ACL/证据约束的 RAG 两条链路。P3 修复集中在现有 retrieval、knowledge base 和 answer service 中，不新增万能聊天接口或服务端会话存储。

**Tech Stack:** Next.js 16、React 18、TypeScript、Jest/Testing Library、NestJS 10、Mongoose 8、Node test runner。

## Global Constraints

- 不将宠物和 RAG 合并成同一个后端 prompt；宠物链路不得读取 Chunk。
- 历史使用版本化 localStorage key `ai_assistant_history_v1`，最多保留最近 100 条消息。
- 图谱扩展最多一跳，并在最终 Chunk 查询前重新应用 knowledgeBase 与 NoteAccess 边界。
- 复杂业务原因、权限边界和失败降级使用简洁中文注释；不为普通 JSX 和直观赋值添加注释。
- 所有生产代码修改严格遵循 RED → GREEN；每个任务单独验证后再继续。

---

## File Structure

- `notes-frontend/src/components/ai/assistant-history.ts`：统一消息类型、旧历史迁移、校验、裁剪与路由规则。
- `notes-frontend/src/components/ai/ChatWindow.tsx`：统一对话状态、请求调度和视觉布局。
- `notes-frontend/src/components/ai/RagCitationList.tsx`：RAG 引用卡片和定位 URL。
- `notes-backend/src/modules/semantic/chunk-retrieval.service.ts`：可读 Chunk 的向量和关键词检索。
- `notes-backend/src/modules/ai/rag/rag-retrieval.service.ts`：rewrite、候选融合、图谱与 rerank 降级。
- `notes-backend/src/modules/knowledge-bases/knowledge-bases.service.ts`：一跳图谱证据展开和 ACL 复核。
- `notes-backend/src/modules/ai/rag/rag-answer.service.ts`：回答引用清理、映射和 warning。

---

### Task 1: 修复引用定位参数契约

**Files:**
- Modify: `notes-frontend/src/components/ai/RagCitationList.tsx:10-17`
- Test: `notes-frontend/__tests__/rag-citation-list.spec.tsx`

**Interfaces:**
- Consumes: `RagCitation.chunkId`、笔记详情页查询参数 `chunkId` 与 `heading`。
- Produces: `/dashboard/notes/:noteId?chunkId=:chunkId&heading=:headingPath`。

- [ ] **Step 1: 写失败测试**

```tsx
test('引用链接使用编辑器支持的 chunkId 参数', () => {
  render(<RagCitationList citations={[citation]} />)
  expect(screen.getByRole('link', { name: /React/ })).toHaveAttribute(
    'href',
    '/dashboard/notes/note-1?chunkId=chunk-1&heading=React+%3E+Diff',
  )
})
```

- [ ] **Step 2: 验证 RED**

Run: `cd notes-frontend && npm exec jest -- --runInBand --coverage=false __tests__/rag-citation-list.spec.tsx`

Expected: FAIL，实际 URL 使用 `chunk=`。

- [ ] **Step 3: 最小实现**

将 `URLSearchParams` 的键从 `chunk` 改为 `chunkId`，保留 heading 回退参数。

- [ ] **Step 4: 验证 GREEN**

Run: `cd notes-frontend && npm exec jest -- --runInBand --coverage=false __tests__/rag-citation-list.spec.tsx`

Expected: PASS。

- [ ] **Step 5: 提交**

Commit: `fix(frontend): 修复知识助手引用定位参数`

---

### Task 2: 修复共享笔记关键词检索并消费 rewrite 关键词

**Files:**
- Modify: `notes-backend/src/modules/semantic/chunk-retrieval.service.ts:10-145`
- Modify: `notes-backend/src/modules/ai/rag/rag-retrieval.service.ts:11-46`
- Test: `notes-backend/test/rag-retrieval-access.test.ts`
- Test: `notes-backend/test/rag-retrieval-orchestration.test.ts`

**Interfaces:**
- Produces: `searchKeywordChunks(input: ChunkSearchInput & { keywords?: string[] }, userId: string)`，权限边界只依赖服务端可读 noteId allowlist。
- Produces: rewrite query 用于向量搜索，rewrite keywords 用于关键词搜索。

- [ ] **Step 1: 写共享 reader 失败测试**

构造当前用户可读但 Chunk `userId` 属于笔记创建者的场景，断言 Chunk 查询只包含 `noteId.$in` 和 content 正则，不包含当前阅读者 `userId`。

- [ ] **Step 2: 写 rewrite 关键词失败测试**

stub `query_rewrite` 返回 `{ "query": "React diff algorithm", "keywords": ["React", "Diff"] }`，断言关键词检索收到 `keywords: ['React', 'Diff']`，向量检索收到规范 query。

- [ ] **Step 3: 验证 RED**

Run: `cd notes-backend && node scripts/run-unit-tests.mjs rag-retrieval-access.test.ts rag-retrieval-orchestration.test.ts`

Expected: FAIL，Chunk 查询仍包含当前用户 `userId`，且 keywords 未传递。

- [ ] **Step 4: 最小实现**

- 从 `searchKeywordChunks` 的 Chunk 条件删除当前阅读者 `userId`。
- 为 `ChunkSearchInput` 增加可选 `keywords?: string[]`。
- 对每个关键词 trim、去空、去重、最多三个并转义正则；缺失时回退有限 query tokens。
- retrieval 分别构造 vector input 与 keyword input。

- [ ] **Step 5: 验证 GREEN**

Run: `cd notes-backend && node scripts/run-unit-tests.mjs rag-retrieval-access.test.ts rag-retrieval-orchestration.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

Commit: `fix(rag): 修复共享笔记检索与关键词改写`

---

### Task 3: 实现真正的一跳图谱扩展与安全候选融合

**Files:**
- Modify: `notes-backend/src/modules/knowledge-bases/knowledge-bases.service.ts:390-409`
- Modify: `notes-backend/src/modules/ai/rag/rag-retrieval.service.ts:18-32`
- Test: `notes-backend/test/knowledge-base-graph-evidence.test.ts`
- Test: `notes-backend/test/rag-retrieval-orchestration.test.ts`

**Interfaces:**
- Consumes: seed node IDs、incident edges 的 `source/target`、neighbor nodes 的 `evidenceChunkIds`。
- Produces: `expandGraphEvidence()` 返回 seed、edge、neighbor 的可读 Chunk，并附带有限 `graphPath`。

- [ ] **Step 1: 写邻居节点失败测试**

构造 `seed-node -> neighbor-node`，证据只存在于 neighbor node；断言返回 neighbor Chunk，并断言最终 Chunk 查询不使用当前阅读者 `userId`，只使用 knowledgeBase 中仍可读的 noteId。

- [ ] **Step 2: 写融合失败测试**

同一 chunk 同时来自 vector（score 0.9）和 graph（score 0.35），rerank 失败时断言保留 0.9 和 graphPath，而不是由后到达的低分候选覆盖。

- [ ] **Step 3: 验证 RED**

Run: `cd notes-backend && node scripts/run-unit-tests.mjs knowledge-base-graph-evidence.test.ts rag-retrieval-orchestration.test.ts`

Expected: FAIL，邻居节点证据缺失或低分覆盖高分。

- [ ] **Step 4: 最小实现**

- 从 incident edges 计算不属于 seed 集合的另一端 nodeId。
- 查询邻居节点并合并 seed node、edge、neighbor node 的 evidence IDs。
- 最终 Chunk 查询使用 `_id` 与可读 noteId allowlist，不限制当前阅读者 userId。
- 增加 `mergeEvidence()`：相同 chunk 保留最高 score、非空 graphPath 和最完整内容。
- 图谱计划存在但缺少 knowledgeBaseId 时添加“未指定知识库，已跳过图谱扩展”warning。

- [ ] **Step 5: 验证 GREEN**

Run: `cd notes-backend && node scripts/run-unit-tests.mjs knowledge-base-graph-evidence.test.ts rag-retrieval-orchestration.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

Commit: `fix(rag): 补齐一跳图谱证据扩展`

---

### Task 4: 清理无效引用并保证回答与 citations 一致

**Files:**
- Modify: `notes-backend/src/modules/ai/rag/rag-answer.service.ts:32-59`
- Test: `notes-backend/test/rag-answer-grounding.test.ts`

**Interfaces:**
- Produces: `{ answer, citations, warnings }`，answer 中不存在本次 allowlist 之外的 evidence ID。

- [ ] **Step 1: 写失败测试**

模型返回 `有效 [E1]，伪造 [E999]`，断言 answer 保留 `[E1]`、删除 `[E999]`、citations 仅含 E1，并包含“已忽略无效引用”warning。

- [ ] **Step 2: 写无引用失败测试**

有证据但模型正文未包含引用时，断言 warnings 包含“回答未附带可验证引用”。

- [ ] **Step 3: 验证 RED**

Run: `cd notes-backend && node scripts/run-unit-tests.mjs rag-answer-grounding.test.ts`

Expected: FAIL，正文仍含 E999 且没有 warning。

- [ ] **Step 4: 最小实现**

新增私有 `sanitizeCitations(answer, allowed)`，一次扫描引用标记，返回清理后的 answer、有效 citations、是否存在无效引用；answer 返回清理值，metrics 使用清理后的长度。

- [ ] **Step 5: 验证 GREEN**

Run: `cd notes-backend && node scripts/run-unit-tests.mjs rag-answer-grounding.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

Commit: `fix(rag): 清理回答中的无效证据引用`

---

### Task 5: 统一历史、修复恢复竞态并自动路由

**Files:**
- Create: `notes-frontend/src/components/ai/assistant-history.ts`
- Modify: `notes-frontend/src/components/ai/ChatWindow.tsx`
- Modify: `notes-frontend/__tests__/rag-chat-answer.spec.tsx`
- Create: `notes-frontend/__tests__/assistant-history.spec.ts`

**Interfaces:**
- Produces: `AssistantMessage`、`loadAssistantHistory(storage)`、`saveAssistantHistory(storage, messages)`、`routeAssistantMessage(content, forceNotes)`。
- Consumes: `getRagAnswer()` 与现有 `/api/ai/pet` stream。

- [ ] **Step 1: 写历史恢复失败测试**

预置 `ai_assistant_history_v1`，挂载、关闭并重新挂载 ChatWindow，断言旧消息仍呈现且初始渲染没有把 storage 写成 `[]`。

- [ ] **Step 2: 写旧历史迁移失败测试**

预置 `ai_pet_history` 和 `ai_rag_history`，断言加载结果包含两类 route、最多 100 条，并写入统一 key 后删除旧 key。

- [ ] **Step 3: 写路由失败测试**

断言“帮我找之前 React Diff 的笔记”自动调用 RAG；“今天心情不错”调用 pet；打开“搜索笔记”后普通问题也调用 RAG。

- [ ] **Step 4: 验证 RED**

Run: `cd notes-frontend && npm exec jest -- --runInBand --coverage=false __tests__/assistant-history.spec.ts __tests__/rag-chat-answer.spec.tsx`

Expected: FAIL，统一 helper/历史/路由尚不存在。

- [ ] **Step 5: 最小实现 helper**

- 定义版本化 key、100 条上限和消息校验。
- 读取统一历史，不存在时迁移旧历史。
- 路由规则只识别已确认的检索词；forceNotes 优先。

- [ ] **Step 6: 最小实现 ChatWindow**

- 使用单一 `messages`，每条消息固定 route。
- 增加 `hydrated`；读取完成前不执行持久化 effect。
- 删除双 Tab；增加可访问的“搜索笔记”pressed button。
- RAG 与 pet 都写入同一历史，保留各自请求实现。

- [ ] **Step 7: 验证 GREEN**

Run: `cd notes-frontend && npm exec jest -- --runInBand --coverage=false __tests__/assistant-history.spec.ts __tests__/rag-chat-answer.spec.tsx`

Expected: PASS。

- [ ] **Step 8: 提交**

Commit: `feat(frontend): 统一小助手对话与历史`

---

### Task 6: 完成 UI 打磨与全量验证

**Files:**
- Modify: `notes-frontend/src/components/ai/ChatWindow.tsx`
- Modify: `notes-frontend/src/components/ai/RagCitationList.tsx`
- Modify: `notes-frontend/src/styles/globals.css` 或现有小助手样式所在文件
- Test: `notes-frontend/__tests__/rag-chat-answer.spec.tsx`

**Interfaces:**
- Produces: 单一标题、来源标签、紧凑证据卡、空状态建议、固定输入区与窄屏布局。

- [ ] **Step 1: 写 UI 失败测试**

断言不存在“宠物聊天/知识助手”Tab；存在“小助手”、`搜索笔记` pressed button、消息来源标签；RAG 结果显示引用，pet 结果不显示笔记引用。

- [ ] **Step 2: 验证 RED**

Run: `cd notes-frontend && npm exec jest -- --runInBand --coverage=false __tests__/rag-chat-answer.spec.tsx`

Expected: FAIL，旧 Tab 或缺少来源标签。

- [ ] **Step 3: 最小视觉实现**

沿用现有产品 token，整理 header、空状态、消息 metadata、引用卡和 composer；不引入新依赖、渐变或大面积阴影。确保按钮 focus、`aria-pressed`、Enter/Shift+Enter 和 loading 状态可用。

- [ ] **Step 4: 验证定向测试**

Run: `cd notes-frontend && npm exec jest -- --runInBand --coverage=false __tests__/assistant-history.spec.ts __tests__/rag-chat-answer.spec.tsx __tests__/rag-citation-list.spec.tsx`

Expected: PASS。

- [ ] **Step 5: 验证后端全量测试**

Run: `cd notes-backend && npm run test:unit`

Expected: 0 failures。

- [ ] **Step 6: 验证前端质量门**

Run: `cd notes-frontend && npm run type-check && npm run lint && npm run build`

Expected: exit 0；如 lint/build 暴露既有问题，记录准确输出并区分本次回归。

- [ ] **Step 7: 浏览器验收**

在 `375×812` 与桌面宽度检查浅色/暗色：历史重开仍在、强制搜索状态清晰、长回答可滚动、输入区固定、引用可定位到 Chunk。

- [ ] **Step 8: 提交**

Commit: `style(frontend): 优化统一小助手聊天界面`

---

## Final Acceptance Checklist

- [ ] 统一对话中闲聊与 RAG 自动路由正确，用户可强制搜索笔记。
- [ ] 关闭并重新打开小助手后，最近 100 条历史仍呈现。
- [ ] 宠物链路不读取 Chunk，RAG 链路继续应用 ACL 和引用校验。
- [ ] 共享/公开可读笔记可参与关键词、向量和图谱证据检索。
- [ ] 比较问题最多展开一跳邻居节点。
- [ ] 无效引用不出现在正文或 citations，有效引用能定位原文。
- [ ] 后端全量单测、前端定向测试、type-check、lint 和 build 已运行并记录结果。
