# Tag Input and ID Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一前端实体 ID 为 `id`，复用标签解析/创建逻辑，并支持中英文逗号分隔标签。

**Architecture:** 在 `src/lib` 新增纯函数模块，集中处理标签名称解析和已有/新建标签解析。页面与 hook 保留各自失败策略，只向公共函数注入实际的创建函数；业务组件不再读取 `_id`。

**Tech Stack:** React 18、TypeScript、Jest、Testing Library。

## Global Constraints

- 前端只使用 `id`，不保留 `_id` 兼容。
- 标签支持中文逗号 `，`、英文逗号 `,` 和空白分隔。
- 新建页单标签失败继续；编辑页失败抛出。
- 不改动无关业务行为。

---

### Task 1: 公共标签工具

**Files:**
- Create: `notes-frontend/src/lib/tag-utils.ts`
- Modify: `notes-frontend/__tests__/note-tag-save.spec.ts`

**Interfaces:**
- Produces: `parseTagNames(input: string): string[]`
- Produces: `resolveTagIdsByNames(names: string[], tags: Tag[], create: (name: string) => Promise<Tag | null>): Promise<{ ids: string[]; created: Tag[] }>`

- [x] 增加中文/英文逗号解析、去重、已有标签复用和缺失标签创建测试。
- [x] 运行测试，确认因公共函数不存在而失败。
- [x] 实现最小纯函数，实体只读取 `id`。
- [x] 运行测试并确认通过。

### Task 2: 迁移新建页与编辑页

**Files:**
- Modify: `notes-frontend/src/components/editor/EditorNoteProperties.tsx`
- Modify: `notes-frontend/src/components/editor/useNoteSave.ts`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/app/dashboard/notes/new/useNewNotePage.ts`

**Interfaces:**
- Consumes: Task 1 的 `parseTagNames` 与 `resolveTagIdsByNames`

- [x] 用 `parseTagNames` 替换组件内分隔正则。
- [x] 两条保存链路复用 `resolveTagIdsByNames`，分别保留原有错误策略。
- [x] 删除上述文件中的全部 `_id` 回退。
- [x] 运行相关 Jest、TypeScript 和 ESLint。

### Task 3: 验证、提交与推送

**Files:**
- Verify: 当前工作区全部未推送改动

- [x] 运行前端相关回归测试、类型检查和构建。
- [x] 运行后端构建并记录既有测试状态。
- [x] 运行 `git diff --check` 并审查提交范围。
- [ ] 使用中文规范提交信息提交全部当前改动。
- [ ] 推送当前 `master` 到 `origin`。

### Task 4: 修复全量测试基线

**Files:**
- Modify: `notes-frontend/__tests__/editor.tiptap.spec.tsx`
- Modify: `notes-frontend/__tests__/readonly-controls.spec.tsx`
- Modify: `notes-frontend/__tests__/knowledge-bases.spec.tsx`
- Modify: `notes-frontend/__tests__/prototype-interaction-regressions.spec.ts`
- Modify: `notes-frontend/src/components/collab/CommentsPanel.tsx`
- Modify: `notes-backend/test/*.test.ts`

- [x] Tiptap 测试重新查询 provider 切换后生成的当前 DOM。
- [x] 更新已过期的工具栏、知识库和视觉契约断言。
- [x] 为评论提交动作补明确 accessible name，并等待协作数据加载完成。
- [x] 同步后端服务测试夹具与当前构造函数、权限模型。
- [x] 前后端全量测试均为绿色后才进入提交推送。
