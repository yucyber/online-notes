# 编辑器布局自动保存与设置导航常驻 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留编辑器自由拖拽宽度，并让用户控制是否持久化布局，同时让设置导航在桌面滚动时常驻。

**Architecture:** external store 用独立 key 保存自动保存开关，并在所有布局写入前统一判断。设置页仅消费开关 API，导航直接复用项目现有 sticky rail 模式，不新增公共组件。

**Tech Stack:** React 18、useSyncExternalStore、Next.js、Jest/Testing Library、Tailwind CSS。

## Global Constraints

- `notes:editor-layout:v1` 的已有数据结构保持兼容。
- 自动保存缺省开启；关闭时删除已有布局数据。
- 不限制编辑器拖拽宽度为设置页预设值。

---

### Task 1: 布局自动保存 store

**Files:**
- Modify: `notes-frontend/src/components/editor/editorLayoutStore.ts`
- Modify: `notes-frontend/src/components/editor/useEditorLayoutPreferences.ts`
- Test: `notes-frontend/__tests__/editor-layout-preferences.spec.tsx`

- [ ] 写关闭自动保存会清除布局并阻止后续持久化的失败测试。
- [ ] 运行定向测试确认 RED。
- [ ] 增加 `autoSaveLayout` 与 `setAutoSaveLayout(enabled)`，统一控制布局写入。
- [ ] 运行定向测试确认 GREEN。

### Task 2: 设置页开关与常驻导航

**Files:**
- Modify: `notes-frontend/src/app/dashboard/settings/page.tsx`
- Test: `notes-frontend/__tests__/settings-page.spec.tsx`

- [ ] 写自动保存开关、无宽度预设和 sticky 导航的失败测试。
- [ ] 运行定向测试确认 RED。
- [ ] 移除三档宽度，接入开关并修正桌面 sticky 布局。
- [ ] 运行定向测试、type-check 和 build。

