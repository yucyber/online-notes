# Editor Full-Height Layout and Toolbar State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对齐编辑器左侧目录原型，让编辑器主体使用全高单层滚动，并让工具栏实时反映光标所在文本格式。

**Architecture:** 保持现有 `NoteEditorShell` 三栏结构和命令事件不变。`TiptapEditor` 负责从 editor selection/transaction 派生纯数据格式快照，`NoteEditorShell` 保存快照并传给受控的 `TiptapToolbar`；布局仅通过编辑器专属 CSS 调整为一个主体滚动容器和 sticky 大纲。

**Tech Stack:** Next.js、React、TypeScript、Tiptap、Jest、Testing Library、CSS。

## Global Constraints

- 只修改编辑器页面，不影响 Dashboard 其他页面。
- 不改变编辑器顶栏、工具栏按钮顺序、正文内容、属性面板和现有命令行为。
- 浅色和暗色均使用现有 product token，不写死单主题颜色。
- 左侧目录内容超长时可独立滚动；正文和大纲共用位于页面最右侧的唯一主体滚动条。
- 复杂时序或格式派生仅用简洁中文注释说明业务原因，不注释直观 JSX。

---

### Task 1: 对齐左侧笔记目录

**Files:**
- Modify: `notes-frontend/src/components/editor/EditorWorkspaceSidebar.tsx`
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Test: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`

**Interfaces:**
- Consumes: 现有 `notes`、`currentNoteId`、`onOpenNote`、`onSearchChange` props。
- Produces: DOM class 保持 `editor-note-directory__item`，目录项不再渲染文件 glyph。

- [ ] **Step 1: 写失败测试**

在 `responsive-editor-ui.spec.tsx` 增加源码与样式断言：

```ts
test('编辑器笔记目录与原型保持一致', () => {
  const sidebar = read('src/components/editor/EditorWorkspaceSidebar.tsx')
  const css = read('src/styles/editor-tokens.css')
  expect(sidebar).not.toContain('<PrototypeGlyph name="file"')
  expect(css).toMatch(/\.editor-note-directory__item\s*\{[^}]*min-height:\s*40px/s)
  expect(css).toMatch(/\.editor-note-directory__item\[data-active="true"\]\s*\{[^}]*border:\s*1px solid/s)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.\\node_modules\\.bin\\jest.cmd --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx`

Expected: FAIL，提示文件 glyph 仍存在或 active item 没有独立细边框。

- [ ] **Step 3: 实现最小改动**

删除目录项内的文件图标 JSX；仅调整以下选择器：

```css
.editor-workspace-sidebar__back { min-height: 32px; padding: 0 10px; }
.editor-workspace-sidebar__search { min-height: 40px; border-radius: 8px; }
.editor-note-directory__heading { padding: 6px 10px 8px; letter-spacing: 0; }
.editor-note-directory__item { min-height: 40px; padding: 8px 10px; border: 1px solid transparent; }
.editor-note-directory__item[data-active="true"] { border: 1px solid var(--product-line-strong, var(--border)); background: var(--product-surface-muted, var(--surface-2)); color: var(--product-text, var(--on-surface)); }
```

- [ ] **Step 4: 运行定向测试**

Run: `.\\node_modules\\.bin\\jest.cmd --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add -- notes-frontend/src/components/editor/EditorWorkspaceSidebar.tsx notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__/responsive-editor-ui.spec.tsx
git commit -m "fix(editor): 对齐左侧笔记目录样式"
```

### Task 2: 建立全高单层滚动布局

**Files:**
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Test: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`

**Interfaces:**
- Consumes: `editor-layout-main`、`editor-edit-row`、`editor-rich-editor`、`editor-paper`、`editor-outline` 现有 DOM。
- Produces: `.editor-rich-editor` 为唯一主体滚动容器；`.editor-outline` 使用 sticky，不建立独立滚动上下文。

- [ ] **Step 1: 写失败测试**

```ts
test('编辑器使用全高单层主体滚动', () => {
  const css = read('src/styles/editor-tokens.css')
  expect(css).toMatch(/\.editor-rich-editor\s*\{[^}]*overflow-y:\s*auto/s)
  expect(css).toMatch(/\.editor-paper\s*\{[^}]*min-height:\s*calc\(100dvh\s*-\s*var\(--editor-header-height\)\s*-\s*48px\)/s)
  expect(css).toMatch(/\.editor-outline\s*\{[^}]*position:\s*sticky/s)
  expect(css).not.toMatch(/\.editor-outline\s*\{[^}]*border-left:/s)
  expect(css).not.toMatch(/\.editor-outline__view\s*\{[^}]*overflow-y:\s*auto/s)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.\\node_modules\\.bin\\jest.cmd --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx`

Expected: FAIL，现有画布仍为 `520px`，大纲仍有 border 和内部滚动。

- [ ] **Step 3: 实现全高与单滚动**

将 `TiptapEditor` 的固定 Tailwind 最小高度 class 移除，改由局部 CSS 控制：

```css
.editor-edit-row .editor-rich-editor {
  display: grid;
  grid-template-rows: auto minmax(calc(100dvh - var(--editor-header-height) - 48px), auto);
  overflow-y: auto;
  align-content: start;
}
.editor-paper {
  min-height: calc(100dvh - var(--editor-header-height) - 48px);
  margin: 28px auto 0;
  overflow: visible;
}
.editor-outline {
  position: sticky;
  top: 48px;
  align-self: start;
  height: calc(100dvh - var(--editor-header-height) - 48px);
  border-left: 0;
}
.editor-outline__view { overflow: visible; }
```

移动端沿用现有 media query；如其覆盖桌面 grid，保留移动端已有单列规则。

- [ ] **Step 4: 运行布局测试**

Run: `.\\node_modules\\.bin\\jest.cmd --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add -- notes-frontend/src/styles/editor-tokens.css notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/__tests__/responsive-editor-ui.spec.tsx
git commit -m "fix(editor): 改为全高单层滚动布局"
```

### Task 3: 派生并传递工具栏格式快照

**Files:**
- Create: `notes-frontend/src/components/editor/editor-format-state.ts`
- Modify: `notes-frontend/src/components/editor/TiptapEditor.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Test: `notes-frontend/__tests__/editor-format-state.spec.ts`

**Interfaces:**
- Produces: `EditorFormatState`、`DEFAULT_EDITOR_FORMAT_STATE`、`readEditorFormatState(editor: Editor): EditorFormatState`。
- `TiptapEditor` 新增 `onFormatChange?: (state: EditorFormatState) => void`。

- [ ] **Step 1: 写格式派生失败测试**

```ts
expect(readEditorFormatState(editor)).toEqual({
  block: 'h2', fontSize: '18', bold: true, italic: false, underline: false,
  blockquote: false, code: false, orderedList: false, bulletList: false, taskList: false,
})
```

测试 editor stub 提供 `isActive(name, attrs?)` 和 `getAttributes('textStyle')`；覆盖 paragraph 默认值、heading level 和 `fontSize: '18px'` 去单位。

- [ ] **Step 2: 运行测试确认失败**

Run: `.\\node_modules\\.bin\\jest.cmd --runInBand --coverage=false __tests__/editor-format-state.spec.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现纯格式快照函数**

```ts
export type EditorFormatState = {
  block: 'paragraph' | `h${1 | 2 | 3 | 4 | 5 | 6}`
  fontSize: string
  bold: boolean
  italic: boolean
  underline: boolean
  blockquote: boolean
  code: boolean
  orderedList: boolean
  bulletList: boolean
  taskList: boolean
}
```

按 `h1` 至 `h6` 顺序读取 active heading，字号从 `editor.getAttributes('textStyle').fontSize` 去掉 `px`，缺省为 `15`。

- [ ] **Step 4: 在 Tiptap editor 事件中发布快照**

在 `TiptapEditor` 的现有 selection effect 附近订阅 `selectionUpdate` 和 `transaction`，调用 `onFormatChangeRef.current?.(readEditorFormatState(editor))`；初始化 editor 后主动发布一次。用 ref 桥接 callback，避免每次父组件 render 重绑事件。

- [ ] **Step 5: 在 Shell 中保存并传递状态**

```tsx
const [formatState, setFormatState] = useState(DEFAULT_EDITOR_FORMAT_STATE)
<TiptapToolbar formatState={formatState} ... />
<TiptapEditor onFormatChange={setFormatState} ... />
```

- [ ] **Step 6: 运行格式测试与类型检查**

Run: `.\\node_modules\\.bin\\jest.cmd --runInBand --coverage=false __tests__/editor-format-state.spec.ts`

Run: `npm.cmd run type-check`

Expected: 全部 PASS。

- [ ] **Step 7: 提交**

```powershell
git add -- notes-frontend/src/components/editor/editor-format-state.ts notes-frontend/src/components/editor/TiptapEditor.tsx notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/__tests__/editor-format-state.spec.ts
git commit -m "feat(editor): 派生光标位置格式状态"
```

### Task 4: 将格式快照映射到工具栏

**Files:**
- Modify: `notes-frontend/src/components/editor/TiptapToolbar.tsx`
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Test: `notes-frontend/__tests__/editor-toolbar-state.spec.tsx`

**Interfaces:**
- Consumes: `formatState: EditorFormatState`。
- Produces: 两个受控 select 和带 `aria-pressed` 的格式按钮。

- [ ] **Step 1: 写失败交互测试**

渲染 `TiptapToolbar` 并传入 heading、18px、bold、orderedList 激活快照，断言：

```ts
expect(screen.getByRole('combobox', { name: '样式' })).toHaveValue('h2')
expect(screen.getByRole('combobox', { name: '字号' })).toHaveValue('18')
expect(screen.getByRole('button', { name: '粗体' })).toHaveAttribute('aria-pressed', 'true')
expect(screen.getByRole('button', { name: '有序列表' })).toHaveAttribute('aria-pressed', 'true')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.\\node_modules\\.bin\\jest.cmd --runInBand --coverage=false __tests__/editor-toolbar-state.spec.tsx`

Expected: FAIL，select 仍使用 defaultValue 且按钮没有格式状态。

- [ ] **Step 3: 实现受控状态与激活样式**

为 `TiptapToolbar` 增加 `formatState` prop；select 使用 `value={formatState.block}`、`value={formatState.fontSize}`。相应按钮增加 `aria-pressed={formatState.bold}` 等属性。样式仅增加：

```css
.editor-toolbar button[aria-pressed="true"] {
  background: var(--product-surface-muted, var(--surface-2));
  color: var(--product-text, var(--on-surface));
}
```

- [ ] **Step 4: 运行工具栏测试**

Run: `.\\node_modules\\.bin\\jest.cmd --runInBand --coverage=false __tests__/editor-toolbar-state.spec.tsx`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add -- notes-frontend/src/components/editor/TiptapToolbar.tsx notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__/editor-toolbar-state.spec.tsx
git commit -m "feat(editor): 同步工具栏文本属性"
```

### Task 5: 集成验证

**Files:**
- Verify: `notes-frontend/src/components/editor/*`
- Verify: `notes-frontend/src/styles/editor-tokens.css`

**Interfaces:**
- Consumes: Tasks 1-4 的最终实现。
- Produces: 可交付的编辑器交互与视觉验证结果。

- [ ] **Step 1: 运行编辑器回归测试**

Run: `.\\node_modules\\.bin\\jest.cmd --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx __tests__/editor-format-state.spec.ts __tests__/editor-toolbar-state.spec.tsx __tests__/calm-minimal-foundation.spec.ts`

Expected: 全部 PASS。

- [ ] **Step 2: 运行静态检查**

Run: `npm.cmd run type-check`

Run: `npm.cmd run lint -- --quiet`

Expected: 全部退出码为 0。

- [ ] **Step 3: 浏览器验证浅色和暗色**

在实际笔记编辑页分别验证：页面最右侧仅一个主体滚动条；正文和大纲间无竖线；短正文画布填满窗口；左侧目录选中态与原型一致；依次点击标题、正文、粗体和列表文本时，工具栏控件值与激活态同步变化。

- [ ] **Step 4: 检查修改范围**

Run: `git diff --check`

Run: `git diff -- notes-frontend/src/components/editor notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__`

Expected: 无空白错误，且没有 Dashboard 非编辑器页面改动。

- [ ] **Step 5: 提交验证性修正（仅有必要时）**

```powershell
git add -- notes-frontend/src/components/editor notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__/responsive-editor-ui.spec.tsx notes-frontend/__tests__/editor-format-state.spec.ts notes-frontend/__tests__/editor-toolbar-state.spec.tsx
git commit -m "fix(editor): 完成编辑器交互视觉验收"
```
