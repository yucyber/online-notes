# 编辑器 Calm Minimal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将笔记编辑页改造成已确认的 Calm Minimal 界面，统一自动保存、错误反馈、面板控制和 Markdown/富文本体验，同时保持只读权限边界。

**Architecture:** 保留 Next.js、Tailwind、Tiptap、Lucide 和 `react-hot-toast`，以小型 hooks/components 从 `NoteEditorShell` 中拆出布局偏好、保存状态和 Toast 适配。先建立可复用反馈与状态接口，再调整页面布局，最后收敛编辑模式并完成权限与浏览器验收。

**Tech Stack:** Next.js 16、React 18、TypeScript、Tailwind CSS 3.4、Tiptap 2、Lucide React、react-hot-toast、Jest、Testing Library

## Global Constraints

- 视觉仅覆盖编辑器及其直接反馈组件，不重做 Dashboard 信息架构。
- 不新增 UI、Toast 或全局状态库；沿用 Tailwind、Lucide、Tiptap 和 `react-hot-toast`。
- 普通用户不显示 API 延迟、WebSocket 开关或底层诊断信息。
- 图标按钮必须有 `aria-label`，hover 与 focus 使用统一 tooltip。
- 左右面板独立控制；小屏幕默认隐藏右侧，更窄屏幕同时隐藏左侧。
- 只读用户不能从标题、正文、属性、标签、评论或协作入口发起写入。
- 复杂权限、失败降级和时序注释使用简洁中文，只说明原因与边界。
- Commit message 使用中文，格式为 `类型(范围): 简述`。

---

## File Map

- Create `notes-frontend/src/components/ui/AppToaster.tsx`：全局 Toast 容器和统一视觉。
- Create `notes-frontend/src/lib/app-toast.tsx`：错误去重、持续时间和操作按钮接口。
- Create `notes-frontend/src/components/editor/useEditorLayoutPreferences.ts`：左右面板和左栏宽度持久化。
- Create `notes-frontend/src/components/editor/EditorSaveStatus.tsx`：自动保存状态展示。
- Create `notes-frontend/src/components/editor/useEditorAutoSave.ts`：防抖、立即保存、失败重试和本地降级。
- Modify `notes-frontend/src/app/layout.tsx`：挂载唯一 `AppToaster`。
- Modify `notes-frontend/src/components/editor/NoteEditorShell.tsx`：编排新布局并移除编辑模式切换。
- Modify `notes-frontend/src/components/editor/NoteEditorHeader.tsx`：Calm Minimal 标题区、保存状态和面板按钮。
- Modify `notes-frontend/src/components/editor/NoteEditorMetadataPanel.tsx`：右侧辅助信息与收起入口。
- Modify `notes-frontend/src/components/editor/TiptapToolbar.tsx`：插入分组、评论/协作图标和只读禁用。
- Modify `notes-frontend/src/components/editor/TiptapEditor.tsx`：Markdown input rules、粘贴转换和自动保存接入。
- Modify `notes-frontend/src/components/editor/useNoteSave.ts`：返回保存结果，停止在 hook 内制造不同错误表现。
- Modify `notes-frontend/src/styles/editor-tokens.css`：Calm Minimal tokens、面板和焦点样式。
- Modify `notes-frontend/src/app/globals.css`：全局 Toast 层级和响应式保护。
- Modify `notes-frontend/src/app/dashboard/notes/new/page.tsx`：新建笔记统一使用 Tiptap。
- Test `notes-frontend/__tests__/app-toast.spec.tsx`
- Test `notes-frontend/__tests__/editor-auto-save.spec.tsx`
- Test `notes-frontend/__tests__/editor-layout-preferences.spec.tsx`
- Test `notes-frontend/__tests__/editor-unified-input.spec.tsx`
- Modify `notes-frontend/__tests__/readonly-controls.spec.tsx`
- Modify `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`
- Modify `notes-frontend/__tests__/editor.tiptap.spec.tsx`

---

### Task 1: 统一全局 Toast

**Files:**
- Create: `notes-frontend/src/components/ui/AppToaster.tsx`
- Create: `notes-frontend/src/lib/app-toast.tsx`
- Modify: `notes-frontend/src/app/layout.tsx`
- Test: `notes-frontend/__tests__/app-toast.spec.tsx`

**Interfaces:**
- Produces: `appToast.error(options: AppToastOptions): string`、`appToast.dismiss(id?: string): void`
- `AppToastOptions`: `{ id: string; title: string; message?: string; action?: { label: string; onClick: () => void }; persistent?: boolean }`
- Later tasks consume `appToast.error` for save, collaboration, conversion and permission errors.

- [ ] **Step 1: Write the failing Toast tests**

```tsx
it('mounts one top-right toaster with accessible defaults', () => {
  render(<AppToaster />)
  expect(screen.getByTestId('app-toaster')).toHaveAttribute('aria-live', 'polite')
})

it('reuses the supplied id and exposes a named action', () => {
  const retry = jest.fn()
  appToast.error({ id: 'save:n1', title: '保存失败', action: { label: '重新保存', onClick: retry }, persistent: true })
  expect(toast.custom).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ id: 'save:n1', duration: Infinity }))
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- --runInBand --coverage=false __tests__/app-toast.spec.tsx`
Expected: FAIL because `AppToaster` and `appToast` do not exist.

- [ ] **Step 3: Implement the single global adapter**

```tsx
export type AppToastOptions = {
  id: string
  title: string
  message?: string
  action?: { label: string; onClick: () => void }
  persistent?: boolean
}

export const appToast = {
  error(options: AppToastOptions) {
    rememberToastId(options.id) // Set 去重；队列超过 3 条时 dismiss 最早一条
    return toast.custom((instance) => <AppToastCard toastId={instance.id} tone="error" {...options} />, {
      id: options.id,
      duration: options.persistent ? Infinity : 5000,
      position: 'top-right',
    })
  },
  dismiss(id?: string) { toast.dismiss(id) },
}
```

`rememberToastId(id)` 维护模块级 FIFO `activeToastIds`：已有 id 不重复入队；加入第四个不同 id 前调用 `toast.dismiss(activeToastIds.shift())`。`AppToaster` 只渲染一个 `<Toaster />`；卡片统一使用 Lucide 图标、关闭按钮、标题、说明和可选操作。

- [ ] **Step 4: Mount the toaster once and remove competing editor error banners**

在 `RootLayout` 的 `AIProvider` 内、页面内容之后挂载 `<AppToaster />`。仅删除编辑器直接依赖的重复错误表现；其他页面迁移不扩入本任务。

- [ ] **Step 5: Run tests and type-check**

Run: `npm.cmd test -- --runInBand --coverage=false __tests__/app-toast.spec.tsx`
Expected: PASS.
Run: `npm.cmd run type-check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add notes-frontend/src/components/ui/AppToaster.tsx notes-frontend/src/lib/app-toast.tsx notes-frontend/src/app/layout.tsx notes-frontend/__tests__/app-toast.spec.tsx
git commit -m "feat(ui): 统一全局错误提示"
```

---

### Task 2: 自动保存状态与失败恢复

**Files:**
- Create: `notes-frontend/src/components/editor/useEditorAutoSave.ts`
- Create: `notes-frontend/src/components/editor/EditorSaveStatus.tsx`
- Modify: `notes-frontend/src/components/editor/useNoteSave.ts`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Test: `notes-frontend/__tests__/editor-auto-save.spec.tsx`

**Interfaces:**
- Produces: `SaveState = 'idle' | 'saving' | 'saved' | 'local' | 'error'`
- Produces: `useEditorAutoSave({ noteId, title, content, enabled, save, delayMs }): { state: SaveState; saveNow(): Promise<void>; retry(): Promise<void> }`
- `save(title, content)` must resolve on success and reject on failure; it must not swallow ACL or network errors.

- [ ] **Step 1: Write failing hook and status tests**

```tsx
it('debounces changes and reports saved', async () => {
  const save = jest.fn().mockResolvedValue(undefined)
  const { result, rerender } = renderHook((p) => useEditorAutoSave(p), {
    initialProps: { noteId: 'n1', title: 'A', content: 'one', enabled: true, save, delayMs: 400 },
  })
  rerender({ noteId: 'n1', title: 'A', content: 'two', enabled: true, save, delayMs: 400 })
  jest.advanceTimersByTime(400)
  await waitFor(() => expect(result.current.state).toBe('saved'))
  expect(save).toHaveBeenCalledTimes(1)
})

it('does not save when read-only', () => {
  // enabled=false remains idle even after timers run.
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm.cmd test -- --runInBand --coverage=false __tests__/editor-auto-save.spec.tsx`
Expected: FAIL because the hook and status component do not exist.

- [ ] **Step 3: Implement the save state machine**

使用 `useRef` 保存最后一次成功快照，400ms 防抖；相同快照不重复请求。失败时保留待保存快照并调用：

```tsx
appToast.error({
  id: `save:${noteId}`,
  title: '保存失败',
  message: '内容已保留在本地，可重新保存。',
  action: { label: '重新保存', onClick: retry },
  persistent: true,
})
```

离线时不发网络请求，状态为 `local`；监听 `online` 后只触发一次重试。并发保存以递增 request token 保证旧响应不能覆盖新状态。

- [ ] **Step 4: Replace permanent Save/Retry UI**

`NoteEditorShell` 将标题和当前 HTML 交给 `useEditorAutoSave`。删除常驻保存/重试按钮；`EditorSaveStatus` 映射为“正在保存…”、“已自动保存”、“已保存到本地”、“保存失败”。保留 `Ctrl/Cmd + S`，调用 `saveNow()`。

- [ ] **Step 5: Verify focused behavior**

Run: `npm.cmd test -- --runInBand --coverage=false __tests__/editor-auto-save.spec.tsx __tests__/editor.tiptap.spec.tsx`
Expected: PASS with no unhandled promise rejection.
Run: `npm.cmd run type-check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add notes-frontend/src/components/editor/useEditorAutoSave.ts notes-frontend/src/components/editor/EditorSaveStatus.tsx notes-frontend/src/components/editor/useNoteSave.ts notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/__tests__/editor-auto-save.spec.tsx notes-frontend/__tests__/editor.tiptap.spec.tsx
git commit -m "feat(editor): 增加可靠自动保存状态"
```

---

### Task 3: 左右面板与布局偏好

**Files:**
- Create: `notes-frontend/src/components/editor/useEditorLayoutPreferences.ts`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorHeader.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorMetadataPanel.tsx`
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Test: `notes-frontend/__tests__/editor-layout-preferences.spec.tsx`
- Modify: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`

**Interfaces:**
- Produces: `EditorLayoutPreferences = { leftCollapsed: boolean; rightCollapsed: boolean; leftWidth: number }`
- Produces: `{ preferences, toggleLeft(), toggleRight(), setLeftWidth(width: number) }`
- Storage key: `notes:editor-layout:v1`; left width clamp: 220–360px; collapsed rail: 52px.

- [ ] **Step 1: Write failing persistence and clamp tests**

```tsx
it('restores independent panel state and clamps width', () => {
  localStorage.setItem('notes:editor-layout:v1', JSON.stringify({ leftCollapsed: true, rightCollapsed: false, leftWidth: 999 }))
  const { result } = renderHook(() => useEditorLayoutPreferences())
  expect(result.current.preferences).toEqual({ leftCollapsed: true, rightCollapsed: false, leftWidth: 360 })
})
```

增加组件断言：左右按钮名称分别为“收起左侧导航”“收起右侧面板”；收起左侧后主区仍位于内容列，避免设计稿中曾出现的窄列回归。

- [ ] **Step 2: Run tests and verify RED**

Run: `npm.cmd test -- --runInBand --coverage=false __tests__/editor-layout-preferences.spec.tsx __tests__/responsive-editor-ui.spec.tsx`
Expected: FAIL on missing hook and controls.

- [ ] **Step 3: Implement layout preferences**

首次客户端挂载读取 localStorage；解析失败使用桌面默认值。使用 CSS variables：

```tsx
style={{
  '--editor-left-width': `${preferences.leftCollapsed ? 52 : preferences.leftWidth}px`,
  '--editor-right-width': preferences.rightCollapsed ? '0px' : '240px',
} as React.CSSProperties}
```

拖拽只在 pointer move 时更新内存，pointer up 时持久化；支持 `Escape` 取消本次拖拽。

- [ ] **Step 4: Implement accessible panel controls**

左侧按钮使用 `PanelLeftClose/Open`，右侧使用 `PanelRightClose/Open`。设置 `aria-controls`、`aria-expanded` 和明确 tooltip；收起后将焦点移动到恢复按钮。`NoteEditorMetadataPanel` 接收 `collapsed` 与 `onToggle`，不再由含义模糊的 `showSidebar` 同时控制多个区域。

- [ ] **Step 5: Add responsive defaults and verify**

在 1024px 以下默认收起右侧；在 768px 以下左侧导航使用恢复轨道或覆盖层，不挤压正文。用户主动选择优先于断点默认值。

Run: `npm.cmd test -- --runInBand --coverage=false __tests__/editor-layout-preferences.spec.tsx __tests__/responsive-editor-ui.spec.tsx`
Expected: PASS.
Run: `npm.cmd run type-check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add notes-frontend/src/components/editor/useEditorLayoutPreferences.ts notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/src/components/editor/NoteEditorHeader.tsx notes-frontend/src/components/editor/NoteEditorMetadataPanel.tsx notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__/editor-layout-preferences.spec.tsx notes-frontend/__tests__/responsive-editor-ui.spec.tsx
git commit -m "feat(editor): 支持双侧面板收起与宽度记忆"
```

---

### Task 4: Calm Minimal 视觉与工具栏交互

**Files:**
- Modify: `notes-frontend/src/components/editor/NoteEditorHeader.tsx`
- Modify: `notes-frontend/src/components/editor/TiptapToolbar.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Modify: `notes-frontend/src/app/globals.css`
- Modify: `notes-frontend/__tests__/editor.tiptap.spec.tsx`

**Interfaces:**
- Consumes: `EditorSaveStatus` and layout toggle callbacks from Tasks 2–3.
- Produces: toolbar commands remain compatible with existing `exec(command, payload)`; no new command bus.

- [ ] **Step 1: Add failing visual-structure tests**

```tsx
it('groups insertion tools and exposes icon actions by accessible name', () => {
  render(<TiptapToolbar disabled={false} exec={jest.fn()} />)
  expect(screen.getByRole('group', { name: '插入' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '评论' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '协作成员' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '悬浮插入内容' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `npm.cmd test -- --runInBand --coverage=false __tests__/editor.tiptap.spec.tsx`
Expected: FAIL because the insert group and final accessible names differ.

- [ ] **Step 3: Apply the confirmed visual hierarchy**

将颜色、边界、圆角、阴影、焦点环和 150–200ms 动画集中在 `editor-tokens.css`。正文使用居中纸张区域；标题区只保留面包屑、标题、持续状态和自动保存状态。避免在 JSX 写新的散落 hex 值。

- [ ] **Step 4: Rebuild toolbar grouping without changing commands**

将 Plus、Link、Image、Table 放入 `role="group" aria-label="插入"`；删除右下角悬浮 Plus。评论与协作者改为 Lucide icon-only button，并复用项目 Button 的 focus 样式。AI 入口仍独立位于右下角。

- [ ] **Step 5: Verify UI contracts**

Run: `npm.cmd test -- --runInBand --coverage=false __tests__/editor.tiptap.spec.tsx __tests__/readonly-controls.spec.tsx`
Expected: PASS.
Run: `npm.cmd run lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add notes-frontend/src/components/editor/NoteEditorHeader.tsx notes-frontend/src/components/editor/TiptapToolbar.tsx notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/src/styles/editor-tokens.css notes-frontend/src/app/globals.css notes-frontend/__tests__/editor.tiptap.spec.tsx
git commit -m "feat(editor): 应用简洁编辑器视觉与工具栏"
```

---

### Task 5: 收敛为单一 Tiptap 编辑体验

**Files:**
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/components/editor/TiptapEditor.tsx`
- Modify: `notes-frontend/src/components/editor/useTiptapEditorBridge.ts`
- Modify: `notes-frontend/src/app/dashboard/notes/new/page.tsx`
- Test: `notes-frontend/__tests__/editor-unified-input.spec.tsx`
- Modify: `notes-frontend/__tests__/editor.markdown.spec.tsx`
- Modify: `notes-frontend/__tests__/editor.tiptap.spec.tsx`

**Interfaces:**
- Produces: `normalizeEditorContent(raw: string): { html: string; source: 'html' | 'markdown' | 'plain'; preservedRaw?: string }`
- The visible editor always receives HTML and emits HTML; backend payload remains compatible with the current note content field.

- [ ] **Step 1: Write conversion and single-surface failing tests**

```tsx
it.each([
  ['# 标题', '<h1>标题</h1>'],
  ['- 条目', '<ul><li><p>条目</p></li></ul>'],
  ['> 引用', '<blockquote><p>引用</p></blockquote>'],
])('normalizes markdown without exposing a mode switch', (raw, fragment) => {
  expect(normalizeEditorContent(raw).html).toContain(fragment)
})

it('renders no markdown/rich mode selector', () => {
  render(<NoteEditorHeader {...headerProps} />)
  expect(screen.queryByText('富文本（协同）')).not.toBeInTheDocument()
  expect(screen.queryByText('Markdown')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm.cmd test -- --runInBand --coverage=false __tests__/editor-unified-input.spec.tsx __tests__/editor.markdown.spec.tsx`
Expected: FAIL because mode switching remains and normalizer does not exist.

- [ ] **Step 3: Implement safe normalization**

将当前 HTML/Markdown 检测从 `NoteEditorShell` 移入桥接层。HTML 直接通过；明确 Markdown 使用现有 `marked` 转换；普通文本包为段落。转换异常返回经过转义的原始文本，并调用：

```tsx
appToast.error({
  id: `content-conversion:${noteId}`,
  title: '内容格式转换失败',
  message: '已保留原始文本，请检查内容后重试。',
  persistent: true,
})
```

- [ ] **Step 4: Remove visible dual-mode routing**

删除 `editorMode` state、`handleModeChange`、Header selector 和编辑页的 `MarkdownEditor` 分支。新建笔记页也只挂载 `TiptapEditor`。保留 `MarkdownEditor.tsx` 仅供未迁移调用方时，先用 `rg` 证明仍有调用；若无调用则在本任务删除组件、hook 和专属测试。

- [ ] **Step 5: Preserve Markdown shortcuts and paste behavior**

依赖 StarterKit input rules 支持标题、列表、引用和代码块；增加粘贴拦截只在文本具有明确 Markdown 结构时转换，普通文本不转换。覆盖链接、表格、代码块和 HTML 粘贴测试。

- [ ] **Step 6: Verify old-content compatibility**

Run: `npm.cmd test -- --runInBand --coverage=false __tests__/editor-unified-input.spec.tsx __tests__/editor.markdown.spec.tsx __tests__/editor.tiptap.spec.tsx`
Expected: PASS for HTML, Markdown and plain text fixtures.
Run: `npm.cmd run type-check`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/src/components/editor/TiptapEditor.tsx notes-frontend/src/components/editor/useTiptapEditorBridge.ts notes-frontend/src/app/dashboard/notes/new/page.tsx notes-frontend/__tests__/editor-unified-input.spec.tsx notes-frontend/__tests__/editor.markdown.spec.tsx notes-frontend/__tests__/editor.tiptap.spec.tsx
git commit -m "refactor(editor): 统一富文本与 Markdown 编辑体验"
```

---

### Task 6: 收紧只读交互边界

**Files:**
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorHeader.tsx`
- Modify: `notes-frontend/src/components/editor/TiptapToolbar.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorDrawers.tsx`
- Modify: `notes-frontend/__tests__/readonly-controls.spec.tsx`
- Modify: `notes-frontend/__tests__/editor.tiptap.auth.spec.tsx`

**Interfaces:**
- Consumes: `readOnly = !canWriteNote(note, me.id)` as the single UI permission input.
- Consumes: `appToast.error` for one deduplicated permission message with id `permission:noteId`.

- [ ] **Step 1: Extend failing read-only tests**

```tsx
it('viewer cannot trigger any mutating editor action', () => {
  const exec = jest.fn()
  render(<TiptapToolbar disabled exec={exec} />)
  for (const name of ['插入', '插入图片', '插入链接', '保存', '评论']) {
    const control = screen.queryByRole('button', { name })
    if (control) expect(control).toBeDisabled()
  }
  expect(exec).not.toHaveBeenCalled()
})
```

增加 Shell 测试：只读时 title/content/category/tag handlers 不调用 `updateNote`；协作者查看和目录跳转仍可用。

- [ ] **Step 2: Run authorization tests and verify RED**

Run: `npm.cmd test -- --runInBand --coverage=false __tests__/readonly-controls.spec.tsx __tests__/editor.tiptap.auth.spec.tsx`
Expected: at least one FAIL for a remaining mutating entry.

- [ ] **Step 3: Gate controls at the shared permission boundary**

将 `readOnly` 传给 header、toolbar、metadata controls、drawers 和 auto-save hook。事件 handler 开头仍做 guard，防止仅靠 disabled 属性：

```tsx
if (readOnly) {
  appToast.error({ id: `permission:${id}`, title: '当前笔记仅可查看' })
  return
}
```

不要在正常加载时主动弹权限 Toast；仅在快捷键或历史事件等确实尝试写入时提示。

- [ ] **Step 4: Verify frontend and backend boundary tests**

Run: `npm.cmd test -- --runInBand --coverage=false __tests__/readonly-controls.spec.tsx __tests__/editor.tiptap.auth.spec.tsx __tests__/note-permissions.spec.ts`
Expected: PASS, including room-ticket viewer behavior and no write request.
Run: `npm.cmd run type-check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/src/components/editor/NoteEditorHeader.tsx notes-frontend/src/components/editor/TiptapToolbar.tsx notes-frontend/src/components/editor/NoteEditorDrawers.tsx notes-frontend/__tests__/readonly-controls.spec.tsx notes-frontend/__tests__/editor.tiptap.auth.spec.tsx
git commit -m "fix(editor): 阻止只读用户触发写操作"
```

---

### Task 7: 响应式、可访问性与全量验收

**Files:**
- Modify: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`
- Modify: `notes-frontend/__tests__/editor.tiptap.spec.tsx`
- Create: `docs/superpowers/reports/2026-08-11-editor-calm-minimal-ui-validation.md`

**Interfaces:**
- Consumes all deliverables from Tasks 1–6.
- Produces a validation report with exact commands, counts and unverified items.

- [ ] **Step 1: Add final responsive and accessibility assertions**

覆盖以下行为：左右恢复按钮可由键盘聚焦；Toast action 有明确名称；工具栏小屏不横向溢出；`prefers-reduced-motion` 禁用面板动画；正文在左右面板收起后扩展；AI 入口与右上 Toast 不重叠。

- [ ] **Step 2: Run focused regression suite**

Run:

```bash
npm.cmd test -- --runInBand --coverage=false \
  __tests__/app-toast.spec.tsx \
  __tests__/editor-auto-save.spec.tsx \
  __tests__/editor-layout-preferences.spec.tsx \
  __tests__/editor-unified-input.spec.tsx \
  __tests__/responsive-editor-ui.spec.tsx \
  __tests__/readonly-controls.spec.tsx \
  __tests__/editor.tiptap.spec.tsx \
  __tests__/editor.tiptap.auth.spec.tsx
```

PowerShell 执行时将反斜杠续行改成单行命令。Expected: all listed suites PASS, exit 0.

- [ ] **Step 3: Run frontend quality gates**

Run: `npm.cmd run lint`
Expected: exit 0 with no errors.
Run: `npm.cmd run type-check`
Expected: exit 0.
Run: `npm.cmd run ci:test`
Expected: all Jest suites PASS and configured global coverage thresholds pass.
Run: `npm.cmd run build`
Expected: Next.js production build exits 0.

- [ ] **Step 4: Run local browser acceptance**

使用本地账号分别验证可写用户和只读协作者；不得在日志、截图或报告中记录密码。

1. 1440px 桌面：拖拽左栏，分别收起/恢复左右面板，刷新后状态保持。
2. 约 960px（DevTools 挤压场景）：正文不被压成窄列，无 tooltip 越界，无水平滚动。
3. 可写用户：连续输入只产生防抖保存；保存成功显示“已自动保存”。
4. 模拟离线/保存失败：右上角只出现统一 Toast，同类错误不刷屏，重新保存有效。
5. 协作服务不可用：持续状态显示离线编辑，Toast 的“重新连接”可操作。
6. AI 请求失败：复用同一 Toast 样式，操作文案为“重试生成”。
7. 只读用户：正文、标题、属性、标签、评论写入口不可操作，Network 中没有写请求。
8. Markdown 标题、列表、引用、代码块、链接、表格输入/粘贴后以富文本呈现，刷新无内容丢失。

- [ ] **Step 5: Write the validation report**

报告必须记录：commit SHA、测试命令、suite/test 数量、exit code、浏览器视口、通过项和未验证项。不能将未执行的 y-websocket、多用户实时同步或移动真机检查写成通过。

- [ ] **Step 6: Commit**

```bash
git add notes-frontend/__tests__/responsive-editor-ui.spec.tsx notes-frontend/__tests__/editor.tiptap.spec.tsx docs/superpowers/reports/2026-08-11-editor-calm-minimal-ui-validation.md
git commit -m "test(editor): 完成简洁界面全量验收"
```

---

## Final Review Gate

- [ ] 对照 `docs/superpowers/specs/2026-08-11-editor-calm-minimal-ui-design.md` 逐项确认 10 条验收标准均有代码和证据。
- [ ] 运行 `git diff --check origin/master...HEAD`，Expected: no output, exit 0。
- [ ] 检查 `git status --short`，只允许明确排除的本地敏感文件保持 untracked。
- [ ] 使用 `requesting-code-review` 做一次聚焦审查，只修复 Critical/Important；不在本轮扩展 Dashboard 或 AI 对话重设计。
- [ ] 审查修复后重新运行受影响测试和全量质量门禁，再更新验证报告。
