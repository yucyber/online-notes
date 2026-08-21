# New Note Detail UI Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让新建笔记页真正复用详情页完整 UI 骨架，同时保持创建前本地编辑和默认私有。

**Architecture:** 提取详情页共享的大纲和创建态 header 接口，直接复用 `EditorWorkspaceSidebar`、`editor-layout-grid`、toolbar 与 paper。`useNewNotePage` 管理创建前状态和目录数据，不进入 `NoteEditorShell` 的 ACL、自动保存与协作数据流。

**Tech Stack:** Next.js 16、React 18、TypeScript、Tiptap、Jest、Testing Library、CSS tokens

## Global Constraints

- 不修改后端接口，不为未保存笔记增加协作能力。
- 新建请求固定提交 `visibility: 'private'`。
- 分类和标签只通过详情页同款“笔记属性”面板设置。
- 不渲染“仅本地”、评论、协作、历史版本或可见性入口。
- 不引入依赖；复杂约束只写简洁中文注释。
- Commit message 使用中文 `类型(范围): 简述` 格式。

---

### Task 1: 用失败测试锁定详情页骨架契约

**Files:**
- Modify: `notes-frontend/__tests__/new-note-page.spec.tsx`
- Modify: `notes-frontend/__tests__/new-note-page.logic.spec.tsx`

**Interfaces:**
- Consumes: 当前 `NewNotePage`、`useNewNotePage`。
- Produces: 共享骨架、精简入口、默认 private 与目录导航的回归契约。

- [ ] **Step 1: 更新页面测试**

断言 `editor-layout-grid`、编辑器导航、`editor-header`、`editor-paper` 和大纲存在；断言“仅本地”、评论、协作和可见性控件不存在。打开属性后分类和标签存在、历史版本链接不存在。

- [ ] **Step 2: 更新 Hook 测试**

断言 `createNote` 收到 `visibility: 'private'`，目录通过 `fetchNotes` 加载，点击目录项经未保存确认后导航。

- [ ] **Step 3: 运行测试确认 RED**

Run: `npx jest --runInBand __tests__/new-note-page.spec.tsx __tests__/new-note-page.logic.spec.tsx`

Expected: 因当前页面没有左侧导航/大纲且仍显示本地文案和可见性而失败。

### Task 2: 提取详情页共享展示单元

**Files:**
- Create: `notes-frontend/src/components/editor/EditorOutline.tsx`
- Create: `notes-frontend/src/components/editor/editor-outline-utils.ts`
- Modify: `notes-frontend/src/components/editor/NoteEditorHeader.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorMetadataPanel.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`

**Interfaces:**
- Produces: `EditorOutline({ toc, pinned, onPinnedChange })`、`extractEditorHeadings(html)`；header 支持创建态 action；metadata 支持 `showVersions?: boolean` 且默认 `true`。

- [ ] **Step 1: 实现最小共享组件**

从详情页原样迁移大纲 DOM 和 heading 提取逻辑；扩展 header/metadata 时保持详情页默认行为不变。

- [ ] **Step 2: 运行详情页相关测试**

Run: `npx jest --runInBand __tests__/editor-shell.spec.tsx __tests__/editor-header.spec.tsx`

Expected: PASS。

### Task 3: 用详情页骨架重建新建页

**Files:**
- Modify: `notes-frontend/src/app/dashboard/notes/new/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/notes/new/useNewNotePage.ts`
- Modify: `notes-frontend/src/styles/editor-tokens.css`

**Interfaces:**
- Consumes: Task 2 的共享 header、outline、metadata 和现有 `<TiptapEditor localOnly />`。
- Produces: Hook 新增 `directoryNotes`、`directorySearch`、`setDirectorySearch`、`handleOpenNote(id)`。

- [ ] **Step 1: 扩展创建 Hook**

加载 `fetchNotes`、分类和标签；创建 payload 固定 `visibility: 'private'` 并删除可变 visibility 状态。目录导航复用未保存确认语义。

- [ ] **Step 2: 重建页面 JSX**

使用详情页 grid、sidebar、共享 header、toolbar、paper 与 outline。属性面板传 `showVersions={false}`；toolbar 屏蔽评论和依赖真实 id 的资源命令。

- [ ] **Step 3: 删除伪一致样式**

移除本地状态、可见性和独立 header/property 定位规则，只保留标题输入与正文必要样式。

- [ ] **Step 4: 运行目标测试确认 GREEN**

Run: `npx jest --runInBand __tests__/new-note-page.spec.tsx __tests__/new-note-page.logic.spec.tsx __tests__/editor.tiptap.auth.spec.tsx`

Expected: PASS。

### Task 4: 静态与浏览器验收

**Files:** Verify only，除非验证暴露本任务回归。

- [ ] **Step 1: 运行静态检查**

Run: `npm run type-check`, `npm run lint`, `git diff --check`。

- [ ] **Step 2: 运行编辑器回归**

Run: `npx jest --runInBand __tests__/new-note-page.spec.tsx __tests__/new-note-page.logic.spec.tsx __tests__/editor.tiptap.auth.spec.tsx __tests__/editor.tiptap.spec.tsx`。

- [ ] **Step 3: 浏览器对照**

相同桌面视口对照新建页与详情页的 sidebar、header、toolbar、paper、outline，再检查窄屏；确认没有 `notes/new/room-ticket` 和控制台应用错误。

- [ ] **Step 4: 提交实现**

Run: `git add -- <本任务文件>`，然后 `git commit -m "fix(editor): 对齐新建页与详情页界面"`。
