# 知识库笔记选择衔接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让知识库入口自动进入对应知识库的笔记选择流程，并消除选择圆圈遮挡标题的问题。

**Architecture:** 使用 URL 查询参数在知识库页与笔记页之间传递选择意图和知识库 ID。选择状态由现有 `useNotesPage` 管理，目标知识库作为受控初始值传给现有加入面板；列表项仅调整选择控件的布局语义。

**Tech Stack:** Next.js App Router、React、TypeScript、Tailwind CSS

## Global Constraints

- 不修改后端 API 或数据模型。
- 保留普通笔记浏览与手动批量管理流程。
- 复杂业务原因和不直观约束使用简洁中文注释。
- 按用户要求不新增或运行自动化测试。

---

### Task 1: 传递知识库选择上下文

**Files:**
- Modify: `notes-frontend/src/app/dashboard/knowledge-bases/page.tsx`
- Modify: `notes-frontend/src/components/notes/useNotesPage.ts`

**Interfaces:**
- Produces: `knowledgeBaseId: string`，来自查询参数并由页面消费。

- [ ] 将“从笔记选择”链接改为带 `select=knowledge-base` 和 `knowledgeBaseId` 的 URL。
- [ ] 在 `useNotesPage` 初始化时识别选择意图并开启批量选择状态。
- [ ] 向页面返回来源知识库 ID。

### Task 2: 预选目标知识库

**Files:**
- Modify: `notes-frontend/src/app/dashboard/notes/page.tsx`
- Modify: `notes-frontend/src/components/knowledge-bases/AddToKnowledgeBasePanel.tsx`

**Interfaces:**
- Consumes: `preferredKnowledgeBaseId?: string`。
- Produces: 加载知识库后优先匹配目标 ID，否则选择第一项。

- [ ] 给加入面板增加可选的目标知识库属性。
- [ ] 加载完成时验证并应用目标 ID。
- [ ] 从笔记页把查询参数解析出的 ID 传入面板。

### Task 3: 修复选择控件遮挡

**Files:**
- Modify: `notes-frontend/src/components/notes/NotesListCard.tsx`

**Interfaces:**
- Consumes: 现有 `isSelectionMode`、`selectedNoteIds` 和 `onToggleSelection`。
- Produces: 行内选择按钮，不覆盖标题并暴露可访问选中状态。

- [ ] 将圆圈从绝对定位覆盖层移入主行最左侧。
- [ ] 保持整行选择覆盖层，但让圆圈和标题拥有正确的视觉间距。
- [ ] 检查 diff，确认没有修改无关文件或交互。

