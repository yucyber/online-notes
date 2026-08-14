# 设置页功能补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让设置页真实控制编辑器布局并支持当前用户修改显示名称。

**Architecture:** 编辑器偏好迁移到 `useSyncExternalStore` 驱动的模块级 store，保持现有 hook API 与 localStorage 兼容。用户资料通过受 JWT 保护的 `PATCH /users/me` 更新，并在前端同步本地登录态。

**Tech Stack:** Next.js 16、React 18、Jest/Testing Library、NestJS 10、Mongoose、class-validator。

## Global Constraints

- 不实现头像上传、账户删除、邮件通知或新的自动保存偏好。
- 复杂业务原因、权限边界与失败降级只使用简洁中文注释。
- 保持 `notes:editor-layout:v1` 和现有 hook 返回形状兼容。
- 显示名称去除首尾空白后长度为 1–32。

---

### Task 1: 模块级编辑器布局 store

**Files:**
- Create: `notes-frontend/src/components/editor/editorLayoutStore.ts`
- Modify: `notes-frontend/src/components/editor/useEditorLayoutPreferences.ts`
- Test: `notes-frontend/__tests__/editor-layout-preferences.spec.tsx`

**Interfaces:**
- Produces: `useEditorLayoutPreferences(): { preferences, toggleLeft, toggleRight, setLeftWidth }`

- [ ] 增加两个 hook 实例即时同步且仅写入一次持久化状态的失败测试。
- [ ] 运行定向 Jest，确认因实例状态隔离而失败。
- [ ] 实现 external store、SSR snapshot、resize 生命周期和 localStorage 降级；旧 hook 改为 re-export。
- [ ] 运行定向 Jest，确认新旧布局行为全部通过。

### Task 2: 后端用户资料更新

**Files:**
- Create: `notes-backend/src/modules/users/dto/update-profile.dto.ts`
- Create: `notes-backend/src/modules/users/users.controller.ts`
- Modify: `notes-backend/src/modules/users/dto/index.ts`
- Modify: `notes-backend/src/modules/users/schemas/user.schema.ts`
- Modify: `notes-backend/src/modules/users/users.service.ts`
- Modify: `notes-backend/src/modules/users/users.module.ts`
- Modify: `notes-backend/src/modules/auth/auth.service.ts`
- Test: `notes-backend/test/users-profile.test.ts`

**Interfaces:**
- Consumes: JWT `req.user.id`
- Produces: `PATCH /users/me`、`UsersService.updateProfile(userId, dto)`、auth user 的 `displayName`

- [ ] 增加 DTO 边界、service 更新和 controller 当前用户路由的失败测试。
- [ ] 运行后端定向测试，确认缺少 DTO/service/controller 时失败。
- [ ] 增加 schema 字段、DTO、service、JWT controller 注册与 auth 响应字段。
- [ ] 运行定向测试和后端 build。

### Task 3: 前端资料 API 与缓存同步

**Files:**
- Create: `notes-frontend/src/lib/api/users.ts`
- Modify: `notes-frontend/src/lib/api/client.ts`
- Modify: `notes-frontend/src/lib/api.ts`
- Modify: `notes-frontend/src/lib/auth.ts`
- Modify: `notes-frontend/src/types/index.ts`
- Test: `notes-frontend/__tests__/settings-profile.spec.tsx`

**Interfaces:**
- Produces: `usersAPI.updateProfile({ displayName }): Promise<User>`、`setCurrentUser(user)`

- [ ] 增加成功更新本地用户并触发 auth 事件的失败测试。
- [ ] 运行定向 Jest，确认 API/缓存能力缺失。
- [ ] 增加 `patchTyped`、users API、类型与缓存同步函数。
- [ ] 运行定向测试和 type-check。

### Task 4: 功能化设置页

**Files:**
- Modify: `notes-frontend/src/app/dashboard/settings/page.tsx`
- Test: `notes-frontend/__tests__/settings-profile.spec.tsx`

**Interfaces:**
- Consumes: `usersAPI.updateProfile`、`setCurrentUser`、`useEditorLayoutPreferences`

- [ ] 增加账户保存成功/失败、保存中禁用和布局控件联动的失败测试。
- [ ] 运行定向 Jest，确认现有空设置页不满足行为。
- [ ] 按 calm-minimal 原稿实现账户、编辑偏好、危险操作三块和响应式锚点导航。
- [ ] 运行定向测试、lint、type-check 与前端 build。

### Task 5: 全量回归

- [ ] 检查 diff，只保留本需求直接相关修改并核对中文注释。
- [ ] 运行前后端完整测试、type-check/build；记录任何仓库既有失败。
- [ ] 对照设计逐项确认范围和失败路径。

