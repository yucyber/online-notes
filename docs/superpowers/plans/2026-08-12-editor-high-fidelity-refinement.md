# 编辑器高还原精修实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让真实笔记编辑器采用与 Calm Minimal 设计稿一致的单侧栏专用工作区，并收敛属性、工具栏和响应式交互。

**Architecture:** `DashboardLayout` 只负责认证并在编辑器路由跳过常规 Dashboard 壳层；`NoteEditorShell` 编排专用编辑器侧栏、紧凑页头、正文和右侧属性。通用控件继续由 `components/ui` 与 product tokens 管理，编辑器独有布局留在 `components/editor` 和 `editor-tokens.css`。

**Tech Stack:** Next.js 16、React 18、TypeScript、Tailwind CSS、PostCSS、Jest、Testing Library、Tiptap

## Global Constraints

- 不修改保存、Yjs、ACL、协同 ticket 或 Tiptap 命令协议。
- 不新增第三方 UI、动画或状态管理依赖。
- `components/ui` 只接收两个以上业务场景复用的基础控件；编辑器专用组件留在 `components/editor`。
- 通用颜色、边线、圆角、阴影、控件高度和动效来自 `product-tokens.css`；编辑器尺寸和排版来自 `editor-tokens.css`。
- 每个任务只运行受影响测试和 `type-check`；全部任务完成后再统一运行全量门禁。
- 复杂注释只用简洁中文解释业务原因、权限边界或非直观时序。

---

### Task 1: 编辑器路由退出常规 Dashboard 壳层

**Files:**
- Modify: `notes-frontend/src/app/dashboard/layout.tsx`
- Modify: `notes-frontend/__tests__/calm-minimal-foundation.spec.ts`

**Interfaces:**
- Consumes: `usePathname()` 返回的 `/dashboard/notes/new`、`/dashboard/notes/:id`、`/dashboard/notes/:id/edit`。
- Produces: `isEditorWorkspaceRoute(pathname: string | null): boolean`，供布局分支和测试使用。

- [ ] **Step 1: 写失败测试**

在 `calm-minimal-foundation.spec.ts` 增加源代码契约，要求编辑器路由分支在渲染 `DashboardSidebar`、`DashboardHeader` 和 `AIPet` 前直接返回专用工作区：

```ts
test('编辑器路由使用专用工作区而不叠加 Dashboard 壳层', () => {
  const layout = read('src/app/dashboard/layout.tsx')
  expect(layout).toContain('isEditorWorkspaceRoute')
  expect(layout).toContain('editor-workspace-route')
  expect(layout.indexOf('editor-workspace-route')).toBeLessThan(layout.indexOf('<DashboardSidebar'))
})
```

- [ ] **Step 2: 验证测试按预期失败**

Run: `npm.cmd test -- --runInBand __tests__/calm-minimal-foundation.spec.ts --coverage=false`  
Expected: FAIL，缺少 `isEditorWorkspaceRoute` 或 `editor-workspace-route`。

- [ ] **Step 3: 实现最小路由分支**

导出纯函数并在认证 ready 后返回：

```tsx
export const isEditorWorkspaceRoute = (pathname: string | null) => (
  Boolean(pathname && /^\/dashboard\/notes\/(new|[^/]+(?:\/edit)?)$/.test(pathname))
)

if (isEditorWorkspaceRoute(pathname)) {
  return <div className="editor-workspace-route">{children}</div>
}
```

认证、快捷键注册和主题初始化继续复用现有布局逻辑；编辑器分支不请求通知数量，不渲染常规导航或 AI 浮动入口。

- [ ] **Step 4: 运行聚焦测试与类型检查**

Run: `npm.cmd test -- --runInBand __tests__/calm-minimal-foundation.spec.ts --coverage=false`  
Expected: PASS。  
Run: `npm.cmd run type-check`  
Expected: exit 0。

- [ ] **Step 5: 提交**

```bash
git add notes-frontend/src/app/dashboard/layout.tsx notes-frontend/__tests__/calm-minimal-foundation.spec.ts
git commit -m "feat(editor): 启用专用编辑工作区"
```

### Task 2: 用设计稿侧栏和右侧属性替换重复结构

**Files:**
- Create: `notes-frontend/src/components/editor/EditorWorkspaceSidebar.tsx`
- Create: `notes-frontend/src/components/editor/EditorNoteProperties.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorMetadataPanel.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorHeader.tsx`
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Modify: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`

**Interfaces:**
- Produces: `EditorWorkspaceSidebar({ collapsed, width, onToggle, onBack, onResizeStart })`。
- Produces: `EditorNoteProperties` 接收现有分类、标签、只读状态和事件回调，不自行请求或保存数据。
- `NoteEditorMetadataPanel` 新增 `properties: React.ReactNode`，统一承载目录与属性。

- [ ] **Step 1: 写失败测试**

更新编辑器布局测试，断言展开侧栏出现品牌、搜索和返回工作台入口，右栏包含“笔记属性”，正文上方不再存在横跨页面的属性折叠卡：

```tsx
expect(within(screen.getByRole('complementary', { name: '编辑器导航' }))
  .getByRole('button', { name: '返回工作台' })).toBeInTheDocument()
expect(screen.getByRole('searchbox', { name: '搜索笔记' })).toBeInTheDocument()
expect(within(screen.getByRole('complementary', { name: '笔记属性' }))
  .getByText('选择分类')).toBeInTheDocument()
expect(container.querySelector('.editor-top-properties')).not.toBeInTheDocument()
```

- [ ] **Step 2: 验证测试按预期失败**

Run: `npm.cmd test -- --runInBand __tests__/responsive-editor-ui.spec.tsx --coverage=false`  
Expected: FAIL，缺少专用侧栏和右侧属性内容。

- [ ] **Step 3: 提取纯展示属性组件**

把 `NoteEditorShell` 当前 `showMeta` 区域中的分类、附属分类、标签和只读控制原样移动到 `EditorNoteProperties`。所有数据和回调由 props 注入；不得把 `updateNote`、保存队列或权限判断移入展示组件。

- [ ] **Step 4: 建立设计稿侧栏**

实现 `EditorWorkspaceSidebar`：品牌标识、搜索框、当前笔记入口、最近笔记/全部笔记入口和返回工作台。导航使用现有 `Button`，不新增通用 Sidebar 组件；搜索首批只作为本地可访问入口，不虚构后端搜索行为。

- [ ] **Step 5: 重组编辑器区域**

`NoteEditorShell` 删除顶部属性大卡片，把 `EditorNoteProperties` 传给右侧面板；左轨改用 `EditorWorkspaceSidebar`。默认尺寸调整为左栏 236px、右栏 280px、折叠轨 52px，同时保留现有 resize、焦点恢复和 localStorage 行为。

- [ ] **Step 6: 收敛页头**

`NoteEditorHeader` 删除重复面包屑，只保留返回、标题、轻量保存状态、左右面板和协作动作。按钮继续使用共享 `Button` 的 44px 点击区域与 focus ring。

- [ ] **Step 7: 运行聚焦测试与类型检查**

Run: `npm.cmd test -- --runInBand __tests__/responsive-editor-ui.spec.tsx __tests__/editor-layout-preferences.spec.tsx __tests__/readonly-controls.spec.tsx --coverage=false`  
Expected: PASS。  
Run: `npm.cmd run type-check`  
Expected: exit 0。

- [ ] **Step 8: 提交**

```bash
git add notes-frontend/src/components/editor notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__/responsive-editor-ui.spec.tsx
git commit -m "feat(editor): 对齐设计稿工作区布局"
```

### Task 3: 精简工具栏并固定桌面无滚动契约

**Files:**
- Create: `notes-frontend/src/components/editor/EditorToolbarMoreMenu.tsx`
- Modify: `notes-frontend/src/components/editor/TiptapToolbar.tsx`
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Modify: `notes-frontend/__tests__/editor-css-contract.spec.ts`
- Modify: `notes-frontend/__tests__/editor.tiptap.spec.tsx`

**Interfaces:**
- `EditorToolbarMoreMenu({ disabled, exec })` 复用原 `exec(cmd, payload?)` 命令接口。
- 高频区保留正文样式、粗体/斜体/下划线、列表、链接、撤销/重做；表格、颜色、上下标、分隔线等进入“更多格式”。

- [ ] **Step 1: 写失败测试**

增加交互测试，点击“更多格式”后能执行原命令；增加 CSS 契约，桌面 `.editor-toolbar__tools` 为 `overflow: visible`，只在 767px 以下允许内部横向滚动：

```ts
expect(screen.getByRole('button', { name: '更多格式' })).toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: '更多格式' }))
fireEvent.click(screen.getByRole('menuitem', { name: '上标' }))
expect(exec).toHaveBeenCalledWith('sup')
```

- [ ] **Step 2: 验证测试按预期失败**

Run: `npm.cmd test -- --runInBand __tests__/editor-css-contract.spec.ts __tests__/editor.tiptap.spec.tsx --coverage=false`  
Expected: FAIL，缺少更多菜单且桌面仍为 `overflow-x: auto`。

- [ ] **Step 3: 实现低频命令菜单**

使用现有 Button、语义化 `role="menu"`/`menuitem` 和 editor tokens 实现菜单；Escape 关闭并把焦点还给触发按钮。不要新增通用 Dropdown，除非实施时确认已有第二个业务复用点。

- [ ] **Step 4: 收敛工具栏 CSS**

桌面单行排列并隐藏提示性长文案；移动端在工具栏自身启用滚动。菜单层使用 product panel、line、shadow token，不写 raw hex。

- [ ] **Step 5: 运行聚焦测试与类型检查**

Run: `npm.cmd test -- --runInBand __tests__/editor-css-contract.spec.ts __tests__/editor.tiptap.spec.tsx --coverage=false`  
Expected: PASS。  
Run: `npm.cmd run type-check`  
Expected: exit 0。

- [ ] **Step 6: 提交**

```bash
git add notes-frontend/src/components/editor notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__
git commit -m "feat(editor): 收敛编辑器工具栏层级"
```

### Task 4: 响应式、UI 库治理与集中验收

**Files:**
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Modify: `notes-frontend/src/styles/product-tokens.css`
- Modify: `notes-frontend/__tests__/editor-css-contract.spec.ts`
- Modify: `notes-frontend/__tests__/calm-minimal-foundation.spec.ts`
- Modify: `docs/superpowers/plans/2026-08-12-editor-high-fidelity-refinement.md`

**Interfaces:**
- 复用现有 Drawer/对话框实现移动端面板，不新增新的通用 UI 层。
- 新 token 只有在 product 与 editor 至少两个区域共享时进入 `product-tokens.css`。

- [ ] **Step 1: 写失败契约测试**

断言 1024px 默认收起右栏，768px 以下左右栏使用 overlay/Drawer，375px 页面容器为 `overflow-x: clip`；扫描本轮编辑器组件，不允许新增 raw hex、`shadow-xl`、`rounded-2xl` 或自定义 `transition-all`。

- [ ] **Step 2: 验证测试按预期失败**

Run: `npm.cmd test -- --runInBand __tests__/editor-css-contract.spec.ts __tests__/calm-minimal-foundation.spec.ts --coverage=false`  
Expected: FAIL，缺少新断点或仍存在临时样式。

- [ ] **Step 3: 完成响应式和样式归位**

将通用状态值提升到 product tokens，编辑器尺寸留在 editor tokens；清除本轮产生的重复内联样式。确保 `prefers-reduced-motion`、focus-visible 和 44px 点击区域继续生效。

- [ ] **Step 4: 运行集中自动化门禁**

Run: `npm.cmd run ci:test`  
Expected: 21 个以上 suites 全部 PASS，覆盖率阈值通过。  
Run: `npm.cmd run type-check`  
Expected: exit 0。  
Run: `npm.cmd run lint`  
Expected: exit 0。  
Run: `npm.cmd run build`  
Expected: production build exit 0。

- [ ] **Step 5: 真实浏览器验收**

在 `http://localhost:3000/dashboard/notes/<真实笔记 id>` 检查 1440、1024、768、375px：

- 只出现一套编辑器侧栏；
- 1440px 工具栏无横向滚动；
- 375px 页面无横向溢出；
- 左右面板折叠、更多菜单、主题、返回工作台、只读状态均可操作；
- 浅色/深色正文和属性文字可读；
- 控制台无新增 error/warn，保存与协同状态正常。

- [ ] **Step 6: 更新计划状态并提交**

```bash
git add notes-frontend docs/superpowers/plans/2026-08-12-editor-high-fidelity-refinement.md
git commit -m "feat(ui): 完成编辑器高还原精修"
```
