# Feature Tighten Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按用户指定顺序修复权限/数据一致性问题，清理确定性的死代码，再修复搜索/推荐/标签行为，最后拆分仍然过厚的组件与服务；不修改昨天的扫描报告。

**Architecture:** 权限判断统一落在 `NoteAccessService` 和各自领域服务的 scoped query；派生字段刷新只保留一条 NotesService 入口；知识图谱写入以一次可回滚的快照替换为边界；前端把跨页面复用的纯计算提取为小型 helper，组件拆分只在行为稳定后进行。

**Tech Stack:** NestJS 10, Mongoose 8, TypeScript, Next.js/React, Jest, Node test runner.

---

## 约束与执行顺序

- [x] 不修改 `docs/superpowers/plans/2026-08-06-feature-tighten-scan.md`；它是历史扫描记录。
- [x] 保留当前工作区在本轮之前已有的改动，不做 reset、checkout、格式化或依赖升级。
- [x] 每个行为修复先写最小失败测试，再写最小实现，最后做必要的重构。
- [x] 严格按 Wave 1 → Wave 2 → Wave 3 → Wave 4 执行；每波结束都运行对应的定向测试和类型/构建检查。
- [x] 不新增 P1，不扩展未接线设置页能力，不推远端，不创建提交，除非用户另行要求。

## Wave 1 — BUG01 / BUG03 / BUG04 / BUG06 / BUG08

### Task 1 — BUG01：笔记更新使用同一权限 scope，并限制可见性变更

**Files:**

- `notes-backend/src/modules/notes/notes.service.ts`
- `notes-backend/test/notes-update-access.test.ts`（新增）

**Steps:**

- [x] 写失败测试：editor 更新内容时，读取旧笔记和最终 `findOneAndUpdate` 都带 `writeScope`；更新不存在或已失权的笔记不发生写入。
- [x] 写失败测试：editor 不能携带 `visibility` 改可见性；owner 可以修改可见性。
- [x] 用同一个 scope 完成预读、原子更新和后续派生字段触发；不再用裸 `_id` 更新。
- [x] 对更新 DTO 使用副本；内容为空字符串时也刷新同步 summary 和派生字段触发条件，避免清空内容后旧摘要/向量继续生效。
- [x] 通过测试后再整理局部变量，保持计数器差异计算使用更新前快照。

**Acceptance:** `npm.cmd run test:unit -- --test-name-pattern=NotesService`（若脚本不转发过滤参数，则运行完整 `npm.cmd run test:unit`）通过；至少验证 editor 越权、owner 成功、失权无写入。

### Task 2 — BUG03：创建/更新笔记时校验分类与标签归属

**Files:**

- `notes-backend/src/modules/notes/notes.service.ts`
- `notes-backend/src/modules/notes/dto/index.ts`
- `notes-backend/src/modules/categories/categories.service.ts`
- `notes-backend/src/modules/tags/tags.service.ts`
- `notes-backend/test/notes-taxonomy-access.test.ts`（新增）

**Steps:**

- [x] 写失败测试：跨用户 category/tag ID 在 create 与 update 中被拒绝；当前用户自己的引用可成功保存。
- [x] 在 CategoriesService/TagsService 增加按用户批量确认引用的方法，返回缺失 ID 或抛出明确的 NotFound/BadRequest；NotesService 不直接绕过领域服务访问模型。
- [x] 为 Create/Update DTO 的 tags 增加每项 MongoId 校验；create/update 只校验本次实际提供的字段。
- [x] 在保存笔记和更新计数器之前完成所有引用校验，失败时不保存笔记、不改计数器。

**Acceptance:** 归属测试、`npm.cmd run build`、`npm.cmd run test:unit` 通过。

### Task 3 — BUG04：语义向量搜索统一读取权限、筛选和分页

**Files:**

- `notes-backend/src/modules/semantic/semantic.service.ts`
- `notes-backend/src/modules/semantic/semantic.controller.ts`
- `notes-backend/test/semantic-search-access.test.ts`
- `notes-backend/test/controller-regressions.test.ts`

**Steps:**

- [x] 写失败测试：vector/hybrid 调用把 page、limit、category、tags、threshold 传入 service；vector 聚合结果经过 `NoteAccessService.readableFilter`，不再只允许 owner。
- [x] 扩展 `searchVector` 接受 `SemanticSearchOpts`，去掉硬编码 limit=10；结果统一映射为 `SemanticPage`。
- [x] 采用向量召回后再做 readable scope 与业务筛选的单一边界；候选数按目标页放大并设上限，明确接受“候选集不足时可能少于一页”的可观测行为，不向前端伪造 total。
- [x] controller 只负责模式分流和 hybrid fallback；vector 命中、空命中、异常 fallback 的返回结构保持一致。

**Acceptance:** 定向 semantic/controller 测试、`npm.cmd run build`、`npm.cmd run test:unit` 通过；测试必须覆盖 public/ACL 可读而非 owner 的结果不会被遗漏，以及跨用户私有笔记不出现在结果中。

### Task 4 — BUG06：评论回复前检查笔记成员权限

**Files:**

- `notes-backend/src/modules/comments/comments.service.ts`
- `notes-backend/test/comments-access.test.ts`（新增）

**Steps:**

- [x] 写失败测试：无成员权限的用户不能 create/reply；owner、editor、commenter（按现有 memberScope 语义）可操作。
- [x] create 与 reply 都先通过 `NoteAccessService.memberScope` 查笔记，再写评论/回复；失权时不改变评论文档。
- [x] 保持现有评论结构和 controller 响应不变。

**Acceptance:** 评论权限定向测试和完整 backend unit test 通过。

### Task 5 — BUG08：知识库删除清理图数据，图替换保持一致

**Files:**

- `notes-backend/src/modules/knowledge-bases/knowledge-bases.service.ts`
- `notes-backend/src/modules/knowledge-bases/knowledge-bases.module.ts`（仅在注入 session/模型能力需要时修改）
- `notes-backend/test/knowledge-bases.test.ts`

**Steps:**

- [x] 写失败测试：删除知识库同时删除该用户 scope 下的 graph nodes/edges；删除其他用户知识库不触发清理。
- [x] 写失败测试：替换图时新 nodes/edges 写入失败，旧图仍可读；成功时只保留新快照。
- [x] `remove` 在删除 KB 前清理 nodes/edges，并复用已解析的 KB/user scope。
- [x] `replaceGraph` 使用 Mongoose session transaction；若当前连接不支持事务，在任何删除前直接拒绝替换并保留旧图。由于节点/边有同一 KB 下的唯一键，不采用无法保证回滚的“先插入新图再清理旧图”伪方案。避免引入未验证的 schema 字段或宽泛重试。
- [x] 对缺省 graph model 保持现有明确错误，不静默吞掉配置问题。

**Acceptance:** graph 删除/失败回滚/成功替换测试通过；`npm.cmd run build` 和 backend unit test 通过。

## Wave 1 自检门

- [x] 用 `rg` 复核所有更新/评论/语义/图写入路径没有绕过 `NoteAccessService` 的裸 ID 写操作。
- [x] 用测试确认权限失败不会触发计数器、图清理或评论持久化副作用。
- [x] 用 `git diff --check` 检查本波改动。

## Wave 2 — D11–D15 与确定性 unused/dead code

### Task 6 — 清理已确认的死状态、占位和无调用 import

**Files:**

- `notes-frontend/src/components/editor/NoteEditorShell.tsx`：删除未使用的 `lastFocusRef`；删除从未更新的 `currentHeadingId` 状态及其无效 active 分支，活动标题高亮另列为后续功能，不在本波伪装实现。
- `notes-backend/src/modules/notes/notes.service.ts`：删除空的动态 AuditService require stub。
- `notes-frontend/src/app/layout.tsx`：删除未使用 `apiUrl`、被注释的 preconnect 占位。
- `notes-frontend/src/app/dashboard/notifications/page.tsx`：删除未使用的 `previewInvitation`/`acceptInvitation` import。
- `notes-frontend/src/app/dashboard/page.tsx`：删除未使用的 `Tag` import。
- `notes-frontend/src/app/embed/boards/[id]/page.tsx`、`notes-frontend/src/app/embed/mindmaps/[id]/page.tsx`、`notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx`、`notes-frontend/src/app/invitations/[token]/accept/page.tsx`、`notes-frontend/src/components/collab/CollaboratorsPanel.tsx`、`notes-frontend/src/components/collab/CommentsPanel.tsx`：将确认未使用的 catch binding 改为无 binding；只处理 ESLint 报告的确定性 unused。

**Steps:**

- [x] 先运行 `npm.cmd run lint` 保存基线；只清理确定性的 `@typescript-eslint/no-unused-vars`，不把 hook dependency、a11y 或复杂 catch 行为混入本波。
- [x] 删除上述项目并运行 lint，确认 no-unused-vars 错误归零；若某一项实际被运行时反射/模板使用，撤回该项并记录原因。
- [x] 运行 frontend type-check 和已有 Jest 测试。

**Acceptance:** lint 无 errors；type-check、frontend Jest、backend build/unit test 通过；没有改动昨天的扫描报告。

## Wave 3 — BUG05 / BUG09 / BUG10 / BUG11

### Task 7 — BUG05：保存时使用新建标签 ID

**Files:**

- `notes-frontend/src/app/dashboard/notes/new/useNewNotePage.ts`
- `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- `notes-frontend/src/app/dashboard/notes/new/new-note-utils.ts`（新增纯 helper）
- `notes-frontend/__tests__/note-tag-save.spec.ts`（新增）

**Steps:**

- [x] 先写失败测试：辅助分类生成标签后，最终 create/update payload 包含新标签 ID，而不是旧的 selectedTags 快照；重复 ID 去重。
- [x] 让 `addTagsByNames` 返回实际解析/创建的 ID，同时继续更新 UI state；保存流程用纯 helper 合并旧选中 ID 与本次返回 ID。
- [x] 普通手工添加标签和发布/草稿保存都复用同一 helper。

**Acceptance:** frontend 定向测试和 type-check 通过。

### Task 8 — BUG09：版本恢复刷新派生字段并清除旧 embedding

**Files:**

- `notes-backend/src/modules/notes/notes.service.ts`
- `notes-backend/src/modules/versions/versions.service.ts`
- `notes-backend/src/modules/versions/versions.module.ts`
- `notes-backend/test/versions-restore.test.ts`（新增）

**Steps:**

- [x] 先写失败测试：restore 后同步 summary 与恢复内容一致；旧 embedding 不再可被语义搜索使用；版本恢复仍只允许 owner。
- [x] 将 NotesService 现有派生刷新逻辑收敛为一个可调用入口：同步 fallback summary、异步 AI summary、异步 embedding；异步更新必须再次按 note id/当前版本条件写入，避免旧任务覆盖新内容。
- [x] VersionsService 完成 restore 后调用该入口；通过现有 `NotesModule` 导出注入，避免版本模块复制 AI/embedding 逻辑。
- [x] 恢复时先清除 embedding，再启动新派生任务；审计记录和返回结构保持不变。

**Acceptance:** restore 定向测试、semantic access test、backend build/unit test 通过。

### Task 9 — BUG10：URL 分页与搜索条件保持单一来源

**Files:**

- `notes-frontend/src/components/notes/useNotesPage.ts`
- `notes-frontend/src/components/useSearchFilterBar.ts`
- `notes-frontend/src/components/notes/notes-page-utils.ts`（新增或扩展纯解析 helper）
- `notes-frontend/__tests__/notes-pagination.spec.ts`（新增）

**Steps:**

- [x] 先写失败测试：`?page=3&size=20` 首次请求使用 3/20；修改搜索条件移除/重置旧分页后请求从第 1 页开始。
- [x] 用 URL 作为分页初始/同步来源，统一 clamp page/size；请求参数使用同一解析结果。
- [x] `handleSearch`、清空筛选、应用保存筛选都清除旧 page/size；手动翻页再把当前 page/size 写回 URL。
- [x] 不改变现有搜索事件和 RUM 事件字段。

**Acceptance:** frontend pagination/search tests、type-check、frontend Jest 通过。

### Task 10 — BUG11：推荐结果严格遵守 limit

**Files:**

- `notes-backend/src/modules/notes/note-recommendation.service.ts`
- `notes-backend/test/note-recommendation.test.ts`（新增）

**Steps:**

- [x] 先写失败测试：已有推荐占满 limit 时不追加 drafts；不足时 drafts 只能填充剩余数量；返回数组长度始终不超过 limit。
- [x] 把 drafts 查询 limit 改为剩余容量，并对最终数组做防御性 slice；保留用户 scope、去重和既有排序。

**Acceptance:** recommendation test、backend build/unit test 通过。

## Wave 3 自检门

- [x] 复查 BUG05 的发布、草稿、新建、编辑四条保存路径都使用合并后的 tags。
- [x] 复查 BUG09 的异步派生任务不会覆盖更新后的内容；失败只记录，不破坏 restore 主流程。
- [x] 复查 BUG10 没有由 state 和 URL 同时各自决定分页的第二真相源。
- [x] 用 `git diff --check` 检查本波改动。

## Wave 4 — S11–S16 结构拆分

拆分只在前面三波测试通过后进行；每项保留原有公共 props/返回结构，先移动职责，再改变实现。

### Task 11 — S11：拆分 NoteEditorShell

- [x] 从 `notes-frontend/src/components/editor/NoteEditorShell.tsx` 提取 `useNoteEditorPage.ts` 承担页级布局状态；加载、元数据、保存、锁和派生状态仍留在 facade，避免无行为变化的过度移动。
- [x] 提取 `NoteEditorHeader.tsx`、`NoteEditorMetadataPanel.tsx`、`NoteEditorDrawers.tsx`；shell 只负责布局和组合。
- [x] 复用 BUG05 的标签 helper，不在拆分时引入新的保存逻辑。

### Task 12 — S12：拆分 TiptapEditor

- [x] 提取 `useTiptapEditorBridge.ts`（事件/内容同步）、`useTiptapCommentMarks.ts`（评论标记）和 `TiptapAiActions.tsx`（AI 操作区）。
- [x] 保留现有 `useTiptapCollab.ts`、`useTiptapPersistence.ts`，不重复创建 provider/ydoc 生命周期。

### Task 13 — S13：拆分 NotesService

- [x] 保留 CRUD/access facade；把派生字段刷新落到 `note-derived.service.ts`，让 VersionsService 继续复用它的公共入口。
- [x] 把计数/推荐/缓存保持为现有注入边界，避免把查询逻辑再次分散。

### Task 14 — S14：拆分 KnowledgeBasesService

- [x] 提取 `knowledge-graph.service.ts` 处理 graph 删除与 replace transaction；normalize、get、序列化继续留在 KB facade，避免在已验证权限边界上扩大行为变更。
- [x] 保留 BUG08 的一致性边界和 graph model/session 注入方式。

### Task 15 — S15：拆分 useNotesPage

- [x] 提取 `useNotesQuery.ts` 处理 URL 参数解析、以及 `useNotesBulkActions.ts` 处理删除/选择纯操作；摘要网络编排继续留在页面 facade，避免改变批量摘要时序。
- [x] 保持 `useNotesPage` 对页面的返回字段兼容，先不改页面调用方。

### Task 16 — S16：拆分 MindElixirMap

- [x] 提取 `mind-elixir-factory.ts` 统一实例初始化和节点装饰；提取 `useMindElixirMap.ts` 管理实例状态和保存。
- [x] 删除重复的实例选项/节点装饰分支，补充 unmount 容器清理，保持 readonly 和保存按钮行为。

**Acceptance:** 每个拆分项完成后运行相关 frontend/backend tests；Wave 4 完成后运行全量 frontend lint/type-check/build/Jest、backend build/unit test、`git diff --check`。

## 计划自审结论

- **覆盖性：** 已覆盖用户指定的 5 个 Wave 1 bug、D11–D15 与确定性 unused/dead、4 个 Wave 3 bug 和 S11–S16；未把旧扫描报告中的其他 ID 偷换进执行范围。
- **边界性：** BUG01/03/04/06/08 均以具体 scoped query 或图数据边界为验收；BUG09 明确只有 NotesService 派生刷新入口；BUG10 明确 URL 是分页来源。
- **可验证性：** 每个行为项都有先失败测试、最小实现、定向测试和最终 build/test 命令；Wave 4 仅在行为稳定后拆分。
- **风险控制：** Semantic vector 的候选集不足、Mongo transaction 不可用、版本异步任务竞态都列为显式验收/实现约束；不以“测试通过”替代权限断言。
- **工作区安全：** 计划创建新文件，不修改 `2026-08-06-feature-tighten-scan.md`，不覆盖本轮之前的未提交文件。

## 执行验收记录（2026-08-07）

- Wave 1：BUG01/03/04/06/08 已实现；backend build 通过，backend unit `79/79` 通过。
- Wave 2：D11–D15 与确定性 unused/dead 已清理；lint `0 errors`，未将 hook dependency/a11y 警告混入删除波次。
- Wave 3：BUG05/09/10/11 已实现；frontend Jest `7 suites / 24 tests` 通过，backend unit `79/79` 通过。
- Wave 4：S11–S16 已完成低风险职责抽离；frontend type-check、production build、Jest 通过，backend build 通过。
- 最终 `git diff --check` 通过。lint 仍有 20 条既有 hook/a11y warnings，无 error；这些不属于本轮确定性 unused/dead 清理范围。
- 历史文件 `docs/superpowers/plans/2026-08-06-feature-tighten-scan.md` 未在本轮修改。
