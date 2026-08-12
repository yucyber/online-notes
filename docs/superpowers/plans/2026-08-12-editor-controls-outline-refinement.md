# 编辑器控件与大纲收敛实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除编辑器重复操作入口，完成轻量属性/插入弹层、可靠评论标记、响应式大纲和可滚动全屏。

**Architecture:** 页头承载页面级操作，工具栏只负责格式与插入；属性与插入菜单复用轻量 Popover；大纲独立于属性，通过宽屏侧区或窄屏抽屉展示。评论标记以服务端真实评论为唯一来源。

**Tech Stack:** Next.js 16、React、TypeScript、Tiptap、Tailwind/CSS、Jest/Testing Library。

## Global Constraints

- 在当前用户已确认的分支内原地实施，不创建 worktree。
- 不新增第三方依赖，不复制 Dialog、Drawer、Toast 能力。
- 普通 JSX 不添加解释性注释；只为评论持久化边界和滚动恢复写简洁中文注释。
- 每个任务只运行相关测试；最后统一运行完整测试、类型检查、Lint 和构建。

---

### Task 1: 收敛页头、侧栏与属性入口

**Files:**
- Modify: `notes-frontend/src/components/editor/EditorWorkspaceSidebar.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorHeader.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorMetadataPanel.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Test: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`
- Test: `notes-frontend/__tests__/calm-minimal-foundation.spec.ts`

**Interfaces:**
- `NoteEditorHeader` 产出评论、协作、属性三个页面级回调。
- `EditorWorkspaceSidebar` 的返回目标由 Shell 统一路由到 `/dashboard/notes`。
- 属性面板由常驻 `aside` 改为页头锚定的 `role="dialog"` 轻量 Popover。

- [ ] 写失败测试：断言返回入口位于搜索框之前、无“持续保存”、工具栏无评论/协作、属性可由页头打开且 Esc/外部点击关闭。
- [ ] 运行 `npx.cmd jest --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx __tests__/calm-minimal-foundation.spec.ts`，确认因旧布局失败。
- [ ] 实现紧凑面包屑、页头操作组、属性 Popover、上移返回入口，以及 hover/focus 边界收起触点。
- [ ] 删除右侧常驻属性轨道；历史版本链接置于属性 Popover 底部。
- [ ] 重新运行上述测试和 `npm.cmd run type-check`。
- [ ] 提交 `feat(editor): 收敛页头与笔记属性入口`。

### Task 2: 改造插入菜单与文本选择浮层

**Files:**
- Modify: `notes-frontend/src/components/editor/TiptapToolbar.tsx`
- Modify: `notes-frontend/src/components/editor/TiptapEditor.tsx`
- Modify: `notes-frontend/src/components/editor/SelectionToolbar.tsx`（若现有选择浮层位于其他文件，则修改实际实现文件）
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Test: `notes-frontend/__tests__/editor-unified-input.spec.tsx`
- Test: `notes-frontend/__tests__/editor.tiptap.spec.tsx`

**Interfaces:**
- 插入菜单通过现有 `exec(command, payload?)` 分发 `taskList`、`blockquote`、`codeBlock`、`horizontalRule`、`table`、`image`、`link`。
- 选择浮层只暴露 `ai`、`copy`、`comments`，不直接创建评论标记。

- [ ] 写失败测试：断言“+”菜单锚定工具栏，支持外部点击/Esc 关闭，且选择浮层不含粗体、斜体、下划线。
- [ ] 运行两项相关测试，确认因旧 Toast/浮层行为失败。
- [ ] 使用现有弹层基础样式实现插入 Popover，复用已有命令，不引入新状态库。
- [ ] 精简选择浮层视觉与操作项，并从工具栏删除评论和协作按钮。
- [ ] 重新运行相关测试和类型检查。
- [ ] 提交 `feat(editor): 轻量化插入与文本操作浮层`。

### Task 3: 以真实评论驱动文本标记

**Files:**
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorDrawers.tsx`
- Modify: `notes-frontend/src/components/editor/useTiptapCommentMarks.ts`
- Modify: `notes-frontend/src/components/collab/CommentsPanel.tsx`
- Test: `notes-frontend/__tests__/editor.tiptap.spec.tsx`
- Test: `notes-frontend/__tests__/readonly-leaf-guards.spec.tsx`

**Interfaces:**
- 评论面板成功创建评论后派发 `comments:created`，detail 包含真实 `commentId` 与选区范围。
- Tiptap 仅监听 `comments:created` 创建标记；取消、关闭、失败不派发该事件。
- 回放仅渲染 API 返回且仍存在的评论标记。

- [ ] 写失败测试：点击评论但未提交不产生 mark；提交失败不产生 mark；成功提交后产生真实 ID 的 mark。
- [ ] 运行相关测试并确认旧的 `comments:mark` 提前执行导致失败。
- [ ] 将标记创建移动到评论成功回调，删除打开抽屉时的临时 `local-*` 标记。
- [ ] 调整回放逻辑，忽略没有真实评论记录的遗留标记。
- [ ] 重新运行相关测试和类型检查。
- [ ] 提交 `fix(editor): 以真实评论驱动文本标记`。

### Task 4: 独立大纲与全屏滚动

**Files:**
- Modify: `notes-frontend/src/components/editor/NoteEditorMetadataPanel.tsx`
- Modify: `notes-frontend/src/components/editor/OutlinePanel.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Modify: `notes-frontend/src/app/globals.css`
- Test: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`
- Test: `notes-frontend/__tests__/editor-css-contract.spec.ts`

**Interfaces:**
- `OutlinePanel` 接收 Shell 已生成的 `toc`，点击项以标题 ID 定位并使用 `scroll-margin-top` 避让工具栏。
- Shell 管理 `outlinePinned` 与窄屏抽屉状态；隐藏后边缘 hover/focus 临时显示。
- 全屏容器记录进入前滚动位置，退出时恢复。

- [ ] 写失败测试：宽屏大纲独立于属性，支持隐藏/边缘恢复/点击定位；全屏容器具备纵向滚动规则。
- [ ] 运行相关测试，确认旧常驻属性/大纲与全屏样式失败。
- [ ] 实现宽屏侧区、隐藏提示边缘和中窄屏抽屉，不改变正文内容宽度。
- [ ] 为正文标题设置滚动偏移；全屏容器设置 `overflow-y: auto` 并恢复滚动位置。
- [ ] 重新运行相关测试和类型检查。
- [ ] 提交 `feat(editor): 优化大纲导航与全屏滚动`。

### Task 5: 集中审核与验收

**Files:**
- Review: all files changed by Tasks 1–4

- [ ] 对照设计文档逐项检查重复入口、返回路径、Popover 关闭方式、评论真实性、大纲定位和全屏滚动。
- [ ] 运行 `git diff --check` 并检查未跟踪的 `.superpowers/`、`account-test` 未被修改。
- [ ] 运行 `npm.cmd run ci:test`。
- [ ] 运行 `npm.cmd run type-check`、`npm.cmd run lint`。
- [ ] 运行 `npm.cmd run build`。
- [ ] 使用项目可用的浏览器验收工具检查 1440px、1024px、768px 三种视口；若环境缺少浏览器能力，明确记录而不安装新依赖。
- [ ] 仅在所有新失败已解决后报告结果。
