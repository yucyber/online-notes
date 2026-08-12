# Dashboard 全站简洁界面统一实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一所有登录后 Dashboard 页面与编辑器的简洁信息架构、组件边界和响应式行为。

**Architecture:** 先收敛 `dashboard-navigation` 与产品令牌，再让各页面复用统一的页面骨架和内容表面；编辑器保持独立工作区，但复用同一套导航视觉规则。业务 API、权限、路由和表单行为不变。

**Tech Stack:** Next.js 16、React 18、TypeScript、Tailwind CSS、Jest、Testing Library、Tiptap。

## Global Constraints

- 不新增第三方 UI 库。
- `components/ui` 只保留跨业务基础原语；工作台共享结构位于 `components/dashboard`；编辑器专属结构位于 `components/editor`。
- 不新增分类、标签或其他业务流程。
- 只在任务结束时集中运行一次全量测试、lint 和 build；每个任务只运行相关测试与 type-check。
- 复杂业务原因和不直观时序使用简洁中文注释，直观 JSX 不写解释性注释。

---

### Task 1: 统一工作台侧栏与顶部栏

**Files:**
- Modify: `notes-frontend/src/components/dashboard/dashboard-navigation.tsx`
- Modify: `notes-frontend/src/app/dashboard/layout.tsx`
- Modify: `notes-frontend/src/styles/product-tokens.css`
- Test: `notes-frontend/__tests__/calm-minimal-foundation.spec.ts`

**Interfaces:**
- Produces: 平面分组侧栏、紧凑顶部栏、用户菜单中的退出登录与轻量网络状态入口。
- Preserves: `DashboardSidebar`、`DashboardHeader` 和 `shouldUseOverlaySidebar` 的导出名称。

- [ ] **Step 1: 写失败契约**

断言导航源码包含主导航/管理分组，且不包含侧栏装饰竖线、副标题和持续展开的 `NetworkStatus`。

- [ ] **Step 2: 验证测试因现有卡片式导航失败**

Run: `npx.cmd jest --runInBand --coverage=false __tests__/calm-minimal-foundation.spec.ts`

- [ ] **Step 3: 最小实现共享框架**

保留现有路由数组和回调接口，改为平面列表；将设置固定到底部，将退出登录移入用户菜单；顶部栏只保留必要操作。

- [ ] **Step 4: 运行相关测试与类型检查**

Run: `npx.cmd jest --runInBand --coverage=false __tests__/calm-minimal-foundation.spec.ts && npm.cmd run type-check`

- [ ] **Step 5: 提交**

Commit: `feat(ui): 统一工作台导航框架`

### Task 2: 统一页面骨架与核心管理页

**Files:**
- Modify: `notes-frontend/src/app/dashboard/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/notes/page.tsx`
- Modify: `notes-frontend/src/components/notes/NotesListCard.tsx`
- Modify: `notes-frontend/src/components/SearchFilterBar.tsx`
- Modify: `notes-frontend/src/app/globals.css`
- Test: `notes-frontend/__tests__/calm-minimal-foundation.spec.ts`
- Test: `notes-frontend/__tests__/notes-pagination.spec.ts`

**Interfaces:**
- Produces: `.product-page-header`、`.product-toolbar`、`.product-list-surface` 三类共享页面样式。
- Preserves: 笔记搜索、筛选、批量操作、分页、编辑与删除处理器。

- [ ] **Step 1: 写失败契约**

断言“我的笔记”不含渐变主按钮和卡片抬升样式，搜索与分页使用统一紧凑容器。

- [ ] **Step 2: 验证测试失败**

Run: `npx.cmd jest --runInBand --coverage=false __tests__/calm-minimal-foundation.spec.ts __tests__/notes-pagination.spec.ts`

- [ ] **Step 3: 实现紧凑文档管理页**

将标题、操作、搜索、分页和笔记项收敛为平面层级；辅助推荐区域降级并在窄屏落到主列表下方。

- [ ] **Step 4: 运行相关测试与类型检查**

Run: `npx.cmd jest --runInBand --coverage=false __tests__/calm-minimal-foundation.spec.ts __tests__/notes-pagination.spec.ts && npm.cmd run type-check`

- [ ] **Step 5: 提交**

Commit: `feat(ui): 收敛仪表盘与笔记管理页`

### Task 3: 迁移其余 Dashboard 页面

**Files:**
- Modify: `notes-frontend/src/app/dashboard/activity/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/categories/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/knowledge-bases/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/notifications/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/settings/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/tags/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/boards/[id]/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx`
- Modify: `notes-frontend/src/components/categories/*.tsx`
- Modify: `notes-frontend/src/components/knowledge-bases/*.tsx`
- Test: `notes-frontend/__tests__/calm-minimal-foundation.spec.ts`
- Test: `notes-frontend/__tests__/knowledge-bases.spec.tsx`

**Interfaces:**
- Consumes: Task 2 的共享页面样式。
- Preserves: 所有页面现有 API、表单、删除确认、权限和通知处理器。

- [ ] **Step 1: 写失败契约**

逐页断言采用产品背景、正文令牌和共享页面标题，且不使用渐变、厚阴影或卡片抬升。

- [ ] **Step 2: 验证测试失败**

Run: `npx.cmd jest --runInBand --coverage=false __tests__/calm-minimal-foundation.spec.ts __tests__/knowledge-bases.spec.tsx`

- [ ] **Step 3: 最小迁移页面视觉**

只替换页面结构类名和表面层级；设置页改为清晰两栏，活动与通知改为平面列表，管理页统一工具栏和空状态；白板与思维导图保留沉浸式画布并精简其工作台入口控制。

- [ ] **Step 4: 运行相关测试与类型检查**

Run: `npx.cmd jest --runInBand --coverage=false __tests__/calm-minimal-foundation.spec.ts __tests__/knowledge-bases.spec.tsx && npm.cmd run type-check`

- [ ] **Step 5: 提交**

Commit: `feat(ui): 统一工作台管理页面`

### Task 4: 精简编辑器目录、画布与窄屏抽屉

**Files:**
- Modify: `notes-frontend/src/components/editor/EditorWorkspaceSidebar.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorHeader.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/components/editor/TiptapEditor.tsx`
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Test: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`
- Test: `notes-frontend/__tests__/editor.tiptap.spec.tsx`

**Interfaces:**
- Produces: 可搜索和切换的笔记目录、唯一“返回工作台”出口、开放式正文画布。
- Preserves: Tiptap 编辑、自动保存、评论、协作、权限和全屏行为。

- [ ] **Step 1: 写失败行为测试**

断言目录展示当前笔记并可切换；不渲染“当前笔记 / 全部笔记 / 返回笔记”；窄屏打开一侧时关闭另一侧；正文无卡片边框与阴影。

- [ ] **Step 2: 验证测试失败**

Run: `npx.cmd jest --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx __tests__/editor.tiptap.spec.tsx`

- [ ] **Step 3: 实现目录与开放画布**

复用现有 notes API 加载轻量目录；搜索仅过滤已加载标题；删除重复返回入口；中间结构保持透明；1024px 以下左右抽屉互斥。

- [ ] **Step 4: 运行编辑器相关测试与类型检查**

Run: `npx.cmd jest --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx __tests__/editor.tiptap.spec.tsx __tests__/editor-css-contract.spec.ts && npm.cmd run type-check`

- [ ] **Step 5: 提交**

Commit: `feat(editor): 精简目录与开放画布`

### Task 5: 多端验收与集中质量门禁

**Files:**
- Modify only when an observed regression requires a scoped fix.

**Interfaces:**
- Consumes: Tasks 1–4 的完成状态。
- Produces: Dashboard 全站 UI 验收证据。

- [ ] **Step 1: 浏览器抽查**

在 1440、1024、768、375px 检查仪表盘、我的笔记、知识库、分类、设置和编辑器：页面无横向溢出，抽屉不遮挡控制，按钮不重叠，工具栏行为正确。

- [ ] **Step 2: 交互抽查**

验证侧栏导航、用户菜单、笔记搜索/分页、编辑器目录切换、左右抽屉互斥和更多格式菜单。

- [ ] **Step 3: 集中运行全量门禁**

Run: `npm.cmd run ci:test`

Run: `npm.cmd run type-check`

Run: `npm.cmd run lint`

Run: `npm.cmd run build`

- [ ] **Step 4: 检查工作区边界**

Run: `git diff --check && git status --short`

确认不纳入既有未跟踪项 `.superpowers/` 和 `account-test`。

- [ ] **Step 5: 提交验收修正**

仅在 Step 1–3 产生必要修正时提交：`fix(ui): 收尾工作台多端验收问题`。
