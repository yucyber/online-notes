# 思维导图与笔记归属 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 强制思维导图归属于笔记，提供可编辑的业务面包屑，并安全清理 2026 年 7 月前历史数据及其依赖。

**Architecture:** 后端以 Mindmap `noteId` 必填和 Note 删除 transaction 建立数据不变量；详情 DTO 补充关联笔记信息，PUT 支持标题更新。前端不建设独立列表页，详情导航完全围绕关联笔记。一次性脚本采用 dry-run 默认模式，显式 `--execute` 才删除。

**Tech Stack:** NestJS、Mongoose、Next.js App Router、React、Jest、Testing Library、PowerShell/Node.js。

## Global Constraints

- 截止时间固定为 Asia/Shanghai `2026-07-01 00:00:00`，即 UTC `2026-06-30T16:00:00.000Z`；7 月 1 日及之后保留。
- Mindmap 必须关联 Note；新数据不得产生孤儿记录。
- 标题去除首尾空白，长度为 1–80。
- 不建设 `/dashboard/mindmaps` 列表页；该路径重定向 `/dashboard/notes`。
- 用户已有未提交改动不得覆盖；本任务不创建 Git commit。

---

### Task 1: 后端 Mindmap 归属与标题接口

**Files:**
- Modify: `notes-backend/src/modules/mindmaps/schemas/mindmap.schema.ts`
- Modify: `notes-backend/src/modules/mindmaps/mindmaps.controller.ts`
- Modify: `notes-backend/src/modules/mindmaps/mindmaps.service.ts`
- Test: `notes-backend/test/mindmaps.test.ts`

**Interfaces:**
- Produces: `MindmapsService.create({ title, noteId, userId, content, _id? })`，其中 `noteId` 必填。
- Produces: `MindmapsService.update(id, userId, { title?, content? })`。
- Produces: 详情 `{ id, title, content, noteId, noteTitle, createdAt, updatedAt }`。

- [ ] **Step 1: 写失败测试**

覆盖缺少 `noteId` 被拒绝、无笔记编辑权限被拒绝、详情返回关联标题、PUT 更新并 trim 标题、空标题和超长标题被拒绝。

- [ ] **Step 2: 运行目标测试确认失败**

Run: `npx jest --runInBand test/mindmaps.test.ts`
Expected: FAIL，现有接口允许缺少 `noteId` 且不返回 `noteTitle`。

- [ ] **Step 3: 实现最小后端契约**

将 schema 的 `noteId` 改为 required；controller 校验创建参数和 PUT title；service 使用 `NoteAccessService` 的编辑范围验证 Note，序列化关联字段，并限制 owner 更新。

- [ ] **Step 4: 运行目标测试**

Run: `npx jest --runInBand test/mindmaps.test.ts`
Expected: PASS。

### Task 2: Note 删除级联 Mindmap

**Files:**
- Modify: `notes-backend/src/modules/notes/notes.module.ts`
- Modify: `notes-backend/src/modules/notes/notes.service.ts`
- Test: `notes-backend/test/notes-delete-cascade.test.ts`

**Interfaces:**
- Consumes: Mindmap schema/model。
- Produces: `NotesService.remove(id, userId)` 原签名不变，但 Note 与关联 Mindmap 在同一 session transaction 删除。

- [ ] **Step 1: 写失败测试**

覆盖 owner 删除 Note 时调用 `mindmapModel.deleteMany({ noteId }, { session })`，Note 删除失败时 transaction abort，非 owner 不删除任何资源。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest --runInBand test/notes-delete-cascade.test.ts`
Expected: FAIL，当前 remove 只删除 Note。

- [ ] **Step 3: 实现 transaction 级联**

NotesModule 注册 Mindmap model；remove 在 session transaction 内校验 owner、删除关联 Mindmap、删除 Note，成功后再失效缓存、写审计和更新计数；finally 结束 session。

- [ ] **Step 4: 运行测试**

Run: `npx jest --runInBand test/notes-delete-cascade.test.ts`
Expected: PASS。

### Task 3: 前端 API、业务面包屑与返回行为

**Files:**
- Modify: `notes-frontend/src/lib/api/boards-mindmaps.ts`
- Modify: `notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx`
- Modify: `notes-frontend/src/components/dashboard/dashboard-navigation.tsx`
- Create: `notes-frontend/src/app/dashboard/mindmaps/page.tsx`
- Test: `notes-frontend/__tests__/mindmap-detail-page.spec.tsx`
- Test: `notes-frontend/__tests__/mindmap-index-redirect.spec.tsx`

**Interfaces:**
- Consumes: `mindmapsAPI.get(id)` 返回 `noteId`、`noteTitle`、`title`。
- Consumes: `mindmapsAPI.save(id, content, title?)` 或独立 `update(id, payload)`，避免传参歧义。

- [ ] **Step 1: 写失败测试**

覆盖面包屑 `我的笔记 > 笔记标题 > 思维导图标题`、笔记链接、标题点击编辑、Enter/blur 保存、Esc 取消、失败恢复并 Toast、返回到笔记详情、opener 场景关闭窗口、404 不再自动创建、索引路由重定向 notes。

- [ ] **Step 2: 运行目标测试确认失败**

Run: `npx jest --runInBand --coverage=false __tests__/mindmap-detail-page.spec.tsx __tests__/mindmap-index-redirect.spec.tsx`
Expected: FAIL，当前显示 ID、调用 router.back 且 404 自动创建。

- [ ] **Step 3: 实现导航和标题编辑**

新增类型化 update API；详情页维护 draft title/editing/saving 状态；公共 Toast 处理失败；索引页调用 `redirect('/dashboard/notes')`；面包屑生成逻辑对 mindmap 详情隐藏通用 ID 段，由页面提供业务面包屑或布局扩展点。

- [ ] **Step 4: 运行目标测试与类型检查**

Run: `npx jest --runInBand --coverage=false __tests__/mindmap-detail-page.spec.tsx __tests__/mindmap-index-redirect.spec.tsx __tests__/mindmap-save.spec.ts`

Run: `npm run type-check`

Expected: 全部 PASS。

### Task 4: 一次性历史数据清理

**Files:**
- Create: `notes-backend/scripts/cleanup-pre-july-2026.ts`
- Modify: `notes-backend/package.json`
- Test: `notes-backend/test/cleanup-pre-july-2026.test.ts`

**Interfaces:**
- Produces: `npm run cleanup:pre-july-2026`（dry-run）。
- Produces: `npm run cleanup:pre-july-2026 -- --execute`（正式删除）。

- [ ] **Step 1: 写失败测试**

以 fake collections 覆盖默认不写、固定 cutoff、按集合统计、显式 execute 删除旧记录，并级联删除旧用户/旧 Note 的依赖记录。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest --runInBand test/cleanup-pre-july-2026.test.ts`
Expected: FAIL，脚本尚不存在。

- [ ] **Step 3: 实现清理器**

将计划与执行逻辑拆为可测试函数；连接数据库前加载现有 DNS bootstrap；输出 cutoff、集合、匹配数和删除数；任何集合失败时退出码非零。

- [ ] **Step 4: 运行测试和 dry-run**

Run: `npx jest --runInBand test/cleanup-pre-july-2026.test.ts`

Run: `npm run cleanup:pre-july-2026`

Expected: 测试 PASS；dry-run 与已确认的 12 个集合统计一致，不写数据库。

- [ ] **Step 5: 执行不可恢复清理并复查**

Run: `npm run cleanup:pre-july-2026 -- --execute`

Run: `npm run cleanup:pre-july-2026`

Expected: 首次输出实际删除量；复查旧数据与相关孤儿引用均为 0。向用户明确说明删除不可恢复。

### Task 5: 全量验证与运行时验收

**Files:**
- Verify only; no planned production edits.

**Interfaces:**
- Consumes: Tasks 1–4 全部产物。

- [ ] **Step 1: 后端验证**

Run: `npm run test:unit`

Run: `npm run build`

Expected: 全部 PASS。

- [ ] **Step 2: 前端验证**

Run: `npm run type-check`

Run: `npm run ci:test`

Expected: 新增/相关测试 PASS；如既有无关失败，记录精确测试名和证据。

- [ ] **Step 3: 代码卫生**

Run: `git diff --check`

Expected: 无 whitespace error；只报告已有 CRLF warning。

- [ ] **Step 4: 浏览器验收**

从笔记创建思维导图，验证业务面包屑、笔记跳转、标题编辑持久化、返回行为、`/dashboard/mindmaps` 重定向及 404 不创建新数据。

- [ ] **Step 5: 数据不变量复查**

查询 Mindmap 缺失 `noteId` 或引用不存在 Note 的数量。

Expected: 两类孤儿数量均为 0。
