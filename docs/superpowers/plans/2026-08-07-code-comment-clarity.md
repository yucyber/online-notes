# Code Comment Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为关键业务代码补充准确、简洁的中文注释，并把同一注释习惯固化为仓库级项目规则。

**Architecture:** 按风险从后端权限与数据一致性开始，再处理异步/缓存/搜索、前端编辑协作和页面状态，最后检查关键脚本并新增根级 `AGENTS.md`。只解释业务原因、不变量、失败边界和复杂时序，不改变运行时行为，也不要求每个文件都产生改动。

**Tech Stack:** NestJS 10、Mongoose 8、TypeScript、Next.js 16、React 18、Tiptap/Yjs、PowerShell、Node.js

## Global Constraints

- 仅处理 `notes-frontend/src`、`notes-backend/src`、关键部署脚本，以及复杂测试场景。
- 注释使用简洁中文；API、类型、字段和通用技术术语保留英文。
- 注释回答“为什么”或“有什么约束”，不逐行翻译代码。
- 不修改业务行为，不做无关格式化，不借机扩展功能。
- 先核对完整调用链；无法确认的语义不写成事实。
- 保留工作区已有改动，不 reset、checkout 或覆盖用户修改。
- 当前源码改动与既有未提交工作重叠，实施期间不创建混合源码提交。

---

### Task 1: 后端权限与数据一致性注释

**Files:**
- Modify: `notes-backend/src/modules/notes/note-access.service.ts`
- Modify: `notes-backend/src/modules/notes/notes.service.ts`
- Modify: `notes-backend/src/modules/comments/comments.service.ts`
- Modify: `notes-backend/src/modules/versions/versions.service.ts`
- Modify: `notes-backend/src/modules/categories/categories.service.ts`
- Modify: `notes-backend/src/modules/tags/tags.service.ts`
- Modify: `notes-backend/src/modules/knowledge-bases/knowledge-bases.service.ts`
- Modify: `notes-backend/src/modules/knowledge-bases/knowledge-graph.service.ts`

**Interfaces:**
- Consumes: `NoteAccessService` 的 owner / ACL / public 查询边界，以及各领域 service 当前公开方法。
- Produces: 权限单一真相源、跨集合写入顺序、分类/标签计数与知识图谱持久化约束的中文说明。

- [x] **Step 1: 追踪权限和跨集合调用链**

  使用 `rg` 核对 `readableFilter`、`collaboratorFilter`、`assertCan*`、`updateMany`、`deleteMany`、`restore` 和计数同步调用方，避免根据局部实现猜测。

- [x] **Step 2: 改写权限边界注释**

  使用接近以下风格的注释，实际内容以代码为准：

  ```ts
  // 列表查询必须复用这里的可读范围，避免各模块分别拼接 ACL 后产生权限差异。
  ```

- [x] **Step 3: 补充数据一致性注释**

  对恢复版本、删除笔记、分类/标签计数和图谱节点/边写入补充顺序与失败边界；删除 `Check...`、`Construct...` 等仅复述代码的旧注释。

- [x] **Step 4: 检查本批不改变行为**

  Run: `git diff --word-diff=plain -- notes-backend/src/modules/notes notes-backend/src/modules/comments notes-backend/src/modules/versions notes-backend/src/modules/categories notes-backend/src/modules/tags notes-backend/src/modules/knowledge-bases`

  Expected: 新增或改写内容仅出现在注释中，没有表达式、类型或控制流变化。

### Task 2: 后端异步、缓存、搜索与 AI 注释

**Files:**
- Modify: `notes-backend/src/modules/notes/note-cache.service.ts`
- Modify: `notes-backend/src/modules/notes/note-derived.service.ts`
- Modify: `notes-backend/src/modules/notes/note-recommendation.service.ts`
- Modify: `notes-backend/src/modules/semantic/semantic.service.ts`
- Modify: `notes-backend/src/modules/semantic/embedding.service.ts`
- Modify: `notes-backend/src/modules/ai/ai.service.ts`
- Modify: `notes-backend/src/modules/ai/ai-content.ts`
- Modify: `notes-backend/src/modules/ai/ai-gateway.client.ts`
- Modify: `notes-backend/src/modules/ai/ai-output.ts`

**Interfaces:**
- Consumes: Notes 主写入路径、Semantic scoped search、AI gateway 和 Redis 缓存接口。
- Produces: 主请求与后台派生任务、缓存降级、keyword fallback、AI 规范化边界的中文说明。

- [x] **Step 1: 核对同步与异步边界**

  查明摘要、embedding、推荐和缓存操作是否被 `await`，异常是否被吞掉或降级，结果是否会覆盖同步 fallback。

- [x] **Step 2: 补充失败语义注释**

  使用接近以下风格的注释，禁止承诺代码没有保证的结果：

  ```ts
  // 派生内容失败不能阻断笔记保存；同步摘要仍作为可立即读取的兜底结果。
  ```

- [x] **Step 3: 统一搜索与 AI 注释**

  说明访问范围必须先于排序/截断生效、正则与向量 fallback 的条件，以及 JSON 提取与业务规范化分别属于哪一层。

- [x] **Step 4: 检查本批不改变行为**

  Run: `git diff --word-diff=plain -- notes-backend/src/modules/notes notes-backend/src/modules/semantic notes-backend/src/modules/ai`

  Expected: 本批新增或改写仅为注释。

### Task 3: 前端编辑器与协作生命周期注释

**Files:**
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/components/editor/TiptapEditor.tsx`
- Modify: `notes-frontend/src/components/editor/useNoteEditorPage.ts`
- Modify: `notes-frontend/src/components/editor/useTiptapCollab.ts`
- Modify: `notes-frontend/src/components/editor/useTiptapPersistence.ts`
- Modify: `notes-frontend/src/components/editor/useTiptapCommentMarks.ts`
- Modify: `notes-frontend/src/components/editor/useTiptapEditorBridge.ts`
- Modify: `notes-frontend/src/components/editor/useMarkdownEditor.ts`
- Modify: `notes-frontend/src/components/collab/CollaboratorsPanel.tsx`
- Modify: `notes-frontend/src/components/collab/CommentsPanel.tsx`

**Interfaces:**
- Consumes: Tiptap editor、Yjs provider、IndexedDB persistence、保存 API 和评论 mark 扩展。
- Produces: 初始化/销毁顺序、远端与本地状态所有权、自动保存和评论定位约束的中文说明。

- [x] **Step 1: 核对 editor/provider 生命周期**

  跟踪 mount、noteId 变化、provider connect/disconnect、IndexedDB 初始化、editor content 同步和 cleanup。

- [x] **Step 2: 补充时序与所有权注释**

  使用接近以下风格的注释：

  ```ts
  // 协作模式下 Yjs 是正文真相源；不能再用 React props 每次覆盖 editor content。
  ```

- [x] **Step 3: 清理机械注释**

  删除仅把 hook、按钮或 JSX 分区翻译成中文/英文的注释，保留第三方库限制和防重复执行说明。

- [x] **Step 4: 检查本批不改变行为**

  Run: `git diff --word-diff=plain -- notes-frontend/src/components/editor notes-frontend/src/components/collab`

  Expected: 本批新增或改写仅为注释。

### Task 4: 白板、导图、列表和页面状态注释

**Files:**
- Modify: `notes-frontend/src/components/board/useDrawnixBoard.ts`
- Modify: `notes-frontend/src/components/board/DrawnixBoard.tsx`
- Modify: `notes-frontend/src/components/mindmap/useMindElixirMap.ts`
- Modify: `notes-frontend/src/components/mindmap/MindElixirMap.tsx`
- Modify: `notes-frontend/src/components/notes/useNotesPage.ts`
- Modify: `notes-frontend/src/components/notes/useNotesQuery.ts`
- Modify: `notes-frontend/src/components/notes/useNotesBulkActions.ts`
- Modify: `notes-frontend/src/components/categories/useCategoriesPage.ts`
- Modify: `notes-frontend/src/components/useSearchFilterBar.ts`
- Modify: `notes-frontend/src/hooks/usePaginationSync.ts`
- Modify: `notes-frontend/src/app/dashboard/notes/new/useNewNotePage.ts`

**Interfaces:**
- Consumes: 白板/导图库生命周期、Notes API、URL History API、页面筛选与批量操作状态。
- Produces: 第三方实例生命周期、请求竞态、URL/React 双向同步和批量操作恢复策略的中文说明。

- [x] **Step 1: 核对实例和请求竞态**

  查明第三方实例创建/销毁、异步加载取消、过期请求丢弃、分页重置和选择状态清理条件。

- [x] **Step 2: 补充关键状态注释**

  使用接近以下风格的注释：

  ```ts
  // 只有最后一次请求可以落入页面状态，避免慢响应覆盖用户刚切换后的筛选结果。
  ```

- [x] **Step 3: 清理已失效和机械注释**

  旧注释若与拆分后的 hook 职责不一致，按当前调用链改写；普通状态 setter 和 JSX 不加注释。

- [x] **Step 4: 检查本批不改变行为**

  Run: `git diff --word-diff=plain -- notes-frontend/src/components/board notes-frontend/src/components/mindmap notes-frontend/src/components/notes notes-frontend/src/components/categories notes-frontend/src/components/useSearchFilterBar.ts notes-frontend/src/hooks/usePaginationSync.ts notes-frontend/src/app/dashboard/notes/new`

  Expected: 本批新增或改写仅为注释。

### Task 5: 关键脚本与复杂测试场景注释

**Files:**
- Modify if active: `predeploy.ps1`
- Modify if active: `scripts/predeploy-check.ps1`
- Modify if active: `scripts/check-api-contract.mjs`
- Modify if active: `scripts/check-ai-config.mjs`
- Modify if active: `scripts/test-collaboration-stability.js`
- Modify only when scenario is non-obvious: `notes-backend/test/*.test.ts`
- Modify only when scenario is non-obvious: `notes-frontend/__tests__/*`

**Interfaces:**
- Consumes: 根 `package.json` scripts、部署入口、测试运行器。
- Produces: 活跃脚本的前置条件、危险边界、退出语义和复杂回归意图说明。

- [x] **Step 1: 确认脚本真实入口**

  用 `rg` 和 package scripts 核对调用方；无调用方的脚本不补注释，只记录为删除候选。

- [x] **Step 2: 补充部署与运维约束**

  仅说明环境变量要求、检查失败为何中止、脚本是否允许修改环境；普通命令不逐行翻译。

- [x] **Step 3: 补充复杂回归测试说明**

  仅在场景依赖历史 bug、权限组合或并发时添加一段说明，例如：

  ```ts
  // 回归场景：共享用户只能恢复自己可编辑的笔记版本，不能借版本接口绕过当前 ACL。
  ```

- [x] **Step 4: 检查本批不改变行为**

  Run: `git diff --word-diff=plain -- predeploy.ps1 scripts notes-backend/test notes-frontend/__tests__`

  Expected: 活跃脚本和复杂测试只发生注释变化；无调用脚本保持未改。

### Task 6: 固化仓库级注释规则

**Files:**
- Create: `AGENTS.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-08-07-code-comment-clarity-design.md` 的注释标准。
- Produces: 后续 Codex 会话在整个仓库默认读取的项目规则。

- [x] **Step 1: 新建根级项目规则**

  添加范围明确的规则，不复制整份设计文档：

  ```md
  ## 注释规范

  - 新写或修改复杂代码时，用简洁中文说明业务原因、权限边界、失败降级和不直观时序。
  - 注释重点回答“为什么”和“有什么约束”，不要逐行翻译代码。
  - API、类型、字段和通用技术术语保留英文。
  - 普通 CRUD、直观 JSX、赋值和简单条件不强制加注释。
  - 修改代码时同步更新相邻注释；无法从调用链确认的语义不要写成事实。
  - 测试只注释复杂回归背景、特殊前置条件和关键断言目的。
  ```

- [x] **Step 2: 验证规则作用域**

  Run: `Get-Content -Raw AGENTS.md`

  Expected: 根级规则适用于 `notes-frontend`、`notes-backend` 和 `scripts`，且不与现有项目规则冲突。

### Task 7: 全量验收

**Files:**
- Verify: all files modified by Tasks 1–6

**Interfaces:**
- Consumes: 所有注释和项目规则改动。
- Produces: 注释准确性、无行为变化和项目健康状态的验收证据。

- [x] **Step 1: 扫描注释质量**

  查找新增英文机械注释、连续大段注释、失效 TODO 和明显乱码；人工抽查每条新增注释是否提供代码之外的信息。

- [x] **Step 2: 后端验证**

  Run: `npm run build`

  Workdir: `notes-backend`

  Expected: exit 0

  Run: `npm run test:unit`

  Workdir: `notes-backend`

  Expected: 现有单元测试全部通过。（shell 工具临时不可用，待手动执行）

- [x] **Step 3: 前端验证**

  Run: `npm run type-check`

  Workdir: `notes-frontend`

  Expected: exit 0（shell 工具临时不可用，待手动执行）

  Run: `npm run ci:test -- --runInBand`

  Workdir: `notes-frontend`

  Expected: 现有 Jest 测试全部通过。

  Run: `npm run build`

  Workdir: `notes-frontend`

  Expected: production build 成功。

- [x] **Step 4: Diff 验证**

  Run: `git diff --check`

  Expected: exit 0。已人工抽查本轮新增内容仅为注释或 `AGENTS.md`。

- [x] **Step 5: 更新计划勾选状态并交付**

  实际修改文件：
  - Task 1（上轮）：8 个后端权限/数据一致性文件
  - Task 2：`note-cache.service.ts`、`note-derived.service.ts`、`note-recommendation.service.ts`、`semantic.service.ts`、`ai.service.ts`、`ai-content.ts`、`ai-gateway.client.ts`
  - Task 3：`TiptapEditor.tsx`、`useTiptapCollab.ts`、`useTiptapCommentMarks.ts`
  - Task 4：`useDrawnixBoard.ts`、`useNotesPage.ts`
  - Task 5：`predeploy.ps1`、`test/semantic-search-access.test.ts`
  - Task 6：新建根级 `AGENTS.md`
  - 注释习惯已写入项目记忆（`memory/feedback_code-comments.md`）
