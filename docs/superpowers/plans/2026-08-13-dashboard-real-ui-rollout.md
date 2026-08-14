# Dashboard 全站真实 UI 落地 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的黑灰 Calm Minimal 双主题原型落地到真实 Dashboard 页面，并把 AI Pet 改为墨点助手，同时只统一编辑器暗色令牌而不改变编辑器结构。

**Architecture:** `product-tokens.css` 作为 Dashboard 唯一视觉来源，提供通用页面、面板、列表、工具栏和暗色 token；页面继续使用现有 hooks/API，只替换信息呈现。墨点助手复用现有 AIContext 与 ChatWindow 能力。编辑器保留现有组件树，只调整 `editor-dark`/`dark` token 映射。

**Tech Stack:** Next.js 16、React 18、TypeScript、Tailwind CSS、Jest、Testing Library、lucide-react

## Global Constraints

- 不改变 API、数据模型、ACL、路由、搜索算法、推荐算法和协作流程。
- 不重排 `NoteEditorShell`、`EditorWorkspaceSidebar`、`NoteEditorHeader`、`TiptapToolbar`、`editor-paper` 和 `editor-outline`。
- 暗色使用中性炭黑，不使用 `#0b1220` / `#0f172a` 作为编辑器主背景。
- 不新增第三方依赖，不使用 emoji 图标、渐变主按钮、厚阴影或卡片抬升。
- 复杂代码注释使用简洁中文说明业务原因与边界，不注释直观 JSX。
- 避开并保留工作区中已有的未提交改动。

---

### Task 1: 共享产品令牌与导航壳层

**Files:**
- Modify: `notes-frontend/src/styles/product-tokens.css`
- Modify: `notes-frontend/src/components/dashboard/dashboard-navigation.tsx`
- Modify: `notes-frontend/__tests__/calm-minimal-foundation.spec.ts`

**Interfaces:** Produces `.product-page`, `.product-section`, `.product-data-list`, `.product-stat-strip`, `.product-split-layout` and neutral light/dark tokens.

- [ ] 添加失败契约：深色背景为中性炭黑、导航无 Workspace/在线状态、共享平面列表类存在。
- [ ] 运行聚焦 Jest，确认因契约缺失失败。
- [ ] 实现令牌、页面原语和精简导航。
- [ ] 运行聚焦 Jest，确认通过。

### Task 2: 仪表盘、活动、通知和版本页

**Files:**
- Modify: `notes-frontend/src/app/dashboard/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/activity/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/notifications/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/notes/[id]/versions/page.tsx`
- Create: `notes-frontend/__tests__/dashboard-black-gray-pages.spec.tsx`

**Interfaces:** Consumes shared product classes; preserves current data hooks/API calls.

- [ ] 添加失败渲染契约，断言紧凑统计、中文活动文案、统一收件箱和版本时间线。
- [ ] 运行测试确认失败。
- [ ] 最小修改四个页面的呈现结构。
- [ ] 运行测试确认通过。

### Task 3: 知识库、分类和标签管理

**Files:**
- Modify: `notes-frontend/src/app/dashboard/knowledge-bases/page.tsx`
- Modify: `notes-frontend/src/components/knowledge-bases/KnowledgeBaseList.tsx`
- Modify: `notes-frontend/src/components/knowledge-bases/KnowledgeBaseNotesPanel.tsx`
- Modify: `notes-frontend/src/app/dashboard/categories/page.tsx`
- Modify: `notes-frontend/src/components/categories/CategoryFormPanel.tsx`
- Modify: `notes-frontend/src/components/categories/CategoryOverviewPanel.tsx`
- Modify: `notes-frontend/src/components/categories/CategoryListPanel.tsx`
- Modify: `notes-frontend/src/app/dashboard/tags/page.tsx`
- Modify: `notes-frontend/__tests__/knowledge-bases.spec.tsx`

**Interfaces:** Preserves `useKnowledgeBasePage`, `useCategoriesPage`, tags API and all callback signatures.

- [ ] 添加失败契约，断言知识库主次两栏、分类层级列表和标签上下文合并栏。
- [ ] 运行测试确认失败。
- [ ] 修改呈现结构，不改变 hooks 与 mutation 调用。
- [ ] 运行聚焦测试确认通过。

### Task 4: 墨点助手

**Files:**
- Modify: `notes-frontend/src/components/ai/AIPet.tsx`
- Modify: `notes-frontend/src/components/ai/ChatWindow.tsx`
- Modify: `notes-frontend/src/app/dashboard/layout.tsx`
- Modify: `notes-frontend/__tests__/ai-chat-window.spec.tsx`

**Interfaces:** Reuses `AIContext`; exposes accessible labels `打开墨点助手` / `关闭墨点助手` and page-aware context copy.

- [ ] 添加失败测试，断言墨点名称、无机器人/在线点、快捷动作和上下文。
- [ ] 运行测试确认失败。
- [ ] 实现 44px 入口、桌面浮层和移动底部抽屉样式。
- [ ] 运行测试确认通过。

### Task 5: 编辑器暗色令牌与最终验证

**Files:**
- Modify: `notes-frontend/src/styles/editor-tokens.css`（仅暗色变量块）
- Modify: `notes-frontend/__tests__/editor-css-contract.spec.ts`

**Interfaces:** Existing editor DOM and interaction contracts remain unchanged.

- [ ] 添加失败契约，禁止编辑器主背景使用偏蓝黑值并要求映射产品炭黑层级。
- [ ] 运行聚焦测试确认失败。
- [ ] 仅替换 `editor-dark` 和 `dark` 变量值。
- [ ] 运行编辑器 CSS、响应式和只读聚焦测试。
- [ ] 运行前端 type-check、受影响 Jest、lint 和 production build。
- [ ] 使用真实浏览器抽查浅色／暗色 Dashboard 与暗色编辑器。
