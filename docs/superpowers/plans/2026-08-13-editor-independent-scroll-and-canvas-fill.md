# 编辑器独立滚动与满高画布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让正文和大纲分别滚动、编辑区填满视口且无横向滚动条，并只在编辑器左侧栏恢复原型配色，同时统一正文与外层画布颜色。

**Architecture:** 保留 `NoteEditorShell` 现有 DOM 与功能，只重建编辑区的尺寸和 overflow 边界：`.editor-rich-editor` 负责两列满高网格，不再承担纵向滚动；`.editor-paper` 与 `.editor-outline__view` 各自成为独立纵向滚动区。隐藏大纲时用绝对定位的 18px 右侧触点从网格列中移除，通过覆盖方式展开，避免改变正文宽度或产生横向溢出。

**Tech Stack:** Next.js、React、TypeScript、Tiptap、CSS、Jest/Testing Library

## Global Constraints

- 只修改编辑器布局与样式，不改变工具栏、正文内容、保存和协作逻辑。
- 左侧栏配色调整不得影响 Dashboard 及其他页面。
- 正文与大纲必须能独立滚动；关闭大纲后不得出现横向滚动条。
- 正文编辑框与外层编辑画布使用同一背景色。
- 先写失败测试，再做最小实现。

---

### Task 1: 固化滚动和满高布局契约

**Files:**
- Modify: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`
- Modify: `notes-frontend/src/styles/editor-tokens.css`

**Interfaces:**
- Consumes: 现有 `.editor-rich-editor`、`.editor-paper`、`.editor-outline` 和 `.editor-outline__view` DOM 类名。
- Produces: 正文和大纲独立纵向滚动、父网格隐藏溢出、画布占满剩余高度的 CSS 契约。

- [ ] **Step 1: Write the failing test**

在响应式编辑器测试中断言：父网格 `overflow: hidden` 且使用 `minmax(0, 1fr)`；正文区域和大纲内容分别 `overflow-y: auto`；正文不再使用造成额外空白的视口 `min-height`。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd run ci:test -- --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx`
Expected: FAIL，因为大纲当前是 `overflow: visible`，父网格当前是 `overflow-y: auto`。

- [ ] **Step 3: Write minimal implementation**

将 `.editor-rich-editor` 改为工具栏加满高内容行；将 `.editor-paper` 和 `.editor-outline__view` 分别设为独立滚动容器；使用 `height: 100%`、`min-height: 0` 和 `box-sizing: border-box` 填满剩余空间。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd run ci:test -- --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx`
Expected: PASS。

### Task 2: 消除隐藏大纲后的横向溢出

**Files:**
- Modify: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`
- Modify: `notes-frontend/src/styles/editor-tokens.css`

**Interfaces:**
- Consumes: `data-pinned="false"` 状态。
- Produces: 隐藏状态宽度为 `0` 的网格列，以及不参与布局的右侧展开触点。

- [ ] **Step 1: Write the failing test**

断言隐藏大纲不保留网格列宽，父容器禁止横向滚动，18px 触点及展开态采用覆盖定位而不是扩展网格。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd run ci:test -- --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx`
Expected: FAIL，因为当前隐藏态仍占 18px，hover 会把网格列扩展到 220px。

- [ ] **Step 3: Write minimal implementation**

隐藏态将 18px 大纲触点绝对定位到右侧且不占网格宽度；展开时覆盖正文边缘；在编辑器根、正文和工具栏层明确 `overflow-x: hidden` 或 `min-width: 0`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd run ci:test -- --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx`
Expected: PASS。

### Task 3: 对齐左侧栏配色并统一正文画布

**Files:**
- Modify: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`
- Modify: `notes-frontend/src/styles/editor-tokens.css`

**Interfaces:**
- Consumes: `--product-panel-muted`、`--product-panel` 和编辑器专用选择器。
- Produces: 仅编辑器左栏使用原型侧栏背景；正文纸张与编辑区使用同一画布背景。

- [ ] **Step 1: Write the failing test**

断言左栏和其输入/项目使用原型侧栏 token，`.editor-rich-editor` 与 `.editor-paper` 使用同一个画布 token。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd run ci:test -- --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx`
Expected: FAIL，因为正文纸张当前没有显式继承外层画布色，左栏内部表面仍混用 panel token。

- [ ] **Step 3: Write minimal implementation**

在编辑器局部定义 `--editor-sidebar-bg` 与 `--editor-canvas-bg`，统一左栏内部表面和正文/外层背景，不修改全局 product token。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd run ci:test -- --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx`
Expected: PASS。

### Task 4: 真实页面与静态质量验证

**Files:**
- Verify: `notes-frontend/src/styles/editor-tokens.css`
- Verify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`

**Interfaces:**
- Consumes: 完成后的编辑器页面。
- Produces: 可复核的测试、类型、Lint 和浏览器交互证据。

- [ ] **Step 1: Run focused regression tests**

Run: `npm.cmd run ci:test -- --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx __tests__/editor-toolbar-state.spec.tsx __tests__/editor.tiptap.spec.tsx`
Expected: PASS。

- [ ] **Step 2: Run static checks**

Run: `npm.cmd run type-check`

Run: `npm.cmd run lint -- --quiet`

Expected: 两条命令均退出码 0。

- [ ] **Step 3: Verify in browser**

在实际编辑器页确认：鼠标位于大纲时只滚动大纲；鼠标位于正文时只滚动正文；关闭大纲无水平滚动条；左右区域填满窗口；左栏颜色与原型一致；正文和外层无色差。

- [ ] **Step 4: Review scoped diff**

Run: `git diff --check -- notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__/responsive-editor-ui.spec.tsx`
Expected: 无 whitespace error，并确认没有修改编辑器以外页面。
