# New Note Editor Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让新建笔记页使用当前编辑器视觉体系，并确保未保存笔记完全在本地编辑、不请求 room ticket。

**Architecture:** 保留 `useNewNotePage` 的独立创建数据流，避免把创建态塞进复杂的 `NoteEditorShell`。为 `TiptapEditor` 到 `useTiptapCollab` 的协作边界增加显式 `localOnly` 模式；新建页启用该模式并使用现有 editor/product CSS token 组成新版创建界面，创建成功后跳转真实详情页。

**Tech Stack:** Next.js 16、React 18、TypeScript、Tiptap、Yjs、Jest、Testing Library、Tailwind/CSS tokens

## Global Constraints

- 不修改后端接口，不为未保存笔记增加多人协作。
- 已有详情页默认协作行为必须保持不变。
- 不引入新依赖或新的状态管理方案。
- 复杂代码注释只用简洁中文说明业务原因、权限边界或失败降级。
- Commit message 使用中文 `类型(范围): 简述` 格式。

---

### Task 1: 编辑器显式本地模式

**Files:**
- Modify: `notes-frontend/src/components/editor/TiptapEditor.tsx`
- Modify: `notes-frontend/src/components/editor/useTiptapCollab.ts`
- Modify: `notes-frontend/src/components/editor/useTiptapPersistence.ts`
- Test: `notes-frontend/__tests__/editor.tiptap.auth.spec.tsx`

**Interfaces:**
- Consumes: 现有 `TiptapEditor` props、`useTiptapCollab({ noteId, versionKey, room, ydoc, user })`。
- Produces: `TiptapEditor` 新增可选 `localOnly?: boolean`；`useTiptapCollab` 同名输入在本地模式返回 writer 可编辑状态且不产生网络 provider；持久化 Hook 可被显式关闭。

- [ ] **Step 1: 写本地模式失败测试**

在 `editor.tiptap.auth.spec.tsx` 增加：

```tsx
test('keeps a local-only new note editable without requesting a room ticket', async () => {
  render(<TiptapEditor noteId="new" localOnly initialHTML="<p></p>" onSave={jest.fn()} user={{ id: 'me', name: '我' }} />)
  await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument())
  expect(mockGetRoomTicket).not.toHaveBeenCalled()
  expect((WebsocketProvider as any).instances).toHaveLength(0)
  expect(screen.getByRole('textbox')).toHaveAttribute('contenteditable', 'true')
})
```

- [ ] **Step 2: 运行测试并确认因 `localOnly` 尚不存在或仍请求 ticket 而失败**

Run: `npx jest --runInBand __tests__/editor.tiptap.auth.spec.tsx`

- [ ] **Step 3: 实现最小本地模式**

在 `TiptapEditor` props 增加 `localOnly?: boolean` 并传给协作 Hook。`useTiptapCollab` 在该模式下不执行 ticket effect、不创建 provider，返回 `roomRole: 'writer'`、`collabEnabled: false` 和本地状态。`useTiptapPersistence` 增加 `enabled = true` 参数，本地模式传 `false`，避免使用 `note:new` 的 IndexedDB room。

关键约束：effect 仍必须无条件声明；在 effect 内早返回，不能条件调用 Hook。

- [ ] **Step 4: 运行目标测试确认通过且已有 room-ticket 测试不回归**

Run: `npx jest --runInBand __tests__/editor.tiptap.auth.spec.tsx`
Expected: 全部通过。

- [ ] **Step 5: 提交行为修复**

```powershell
git add -- notes-frontend/src/components/editor/TiptapEditor.tsx notes-frontend/src/components/editor/useTiptapCollab.ts notes-frontend/src/components/editor/useTiptapPersistence.ts notes-frontend/__tests__/editor.tiptap.auth.spec.tsx
git commit -m "fix(editor): 新建笔记禁用协作初始化"
```

### Task 2: 新建页迁移到新版编辑器界面

**Files:**
- Modify: `notes-frontend/src/app/dashboard/notes/new/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/notes/new/useNewNotePage.ts`
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Test: `notes-frontend/__tests__/new-note-page.spec.tsx`

**Interfaces:**
- Consumes: Task 1 的 `<TiptapEditor localOnly />`；现有 `useNewNotePage` 创建、元数据、全屏与取消接口。
- Produces: 新建页新版结构；`saving` 和可展示的 `saveError` 状态；顶部保存操作与工具栏保存命令共享 `handleSave`。

- [ ] **Step 1: 写新建页结构和保存失败测试**

创建 `new-note-page.spec.tsx`，mock `useNewNotePage` 与动态编辑器，断言：

```tsx
expect(screen.getByRole('main', { name: '新建笔记编辑器' })).toHaveClass('new-note-editor')
expect(screen.getByTestId('new-note-tiptap')).toHaveAttribute('data-local-only', 'true')
expect(screen.getByRole('button', { name: '创建笔记' })).toBeInTheDocument()
expect(container.querySelector('[style*="linear-gradient"]')).toBeNull()
```

再触发保存并验证 `handleSave(title, html)` 只走一个入口，saving 时按钮禁用。

- [ ] **Step 2: 运行测试确认旧页面结构失败**

Run: `npx jest --runInBand __tests__/new-note-page.spec.tsx`
Expected: 因缺少 `new-note-editor`、`localOnly` 和创建按钮而失败。

- [ ] **Step 3: 实现新版新建页**

页面使用语义结构：

```tsx
<main className="new-note-editor" aria-label="新建笔记编辑器">
  <header className="new-note-editor__header">...</header>
  <section className="new-note-editor__properties">...</section>
  <section className="new-note-editor__canvas">
    <input className="new-note-editor__title" aria-label="笔记标题" />
    <TiptapToolbar ... />
    <TiptapEditor noteId="new" localOnly ... />
  </section>
</main>
```

属性区采用紧凑两行/弹性布局；沿用现有分类、标签和可见性行为。新增 CSS 只使用 `--product-*`、`--editor-*` 等现有 token，删除旧渐变标题和内联卡片阴影。宽度不足时属性区自然换行，保存按钮保持可访问名称。

`useNewNotePage` 增加 `saving` 防重复创建和 `saveError` 展示；失败时保留输入，成功后仍 `router.push('/dashboard/notes/' + note.id)`。

- [ ] **Step 4: 运行新建页测试和相关编辑器测试**

Run: `npx jest --runInBand __tests__/new-note-page.spec.tsx __tests__/editor.tiptap.auth.spec.tsx`
Expected: 全部通过，无 console error。

- [ ] **Step 5: 提交 UI 迁移**

```powershell
git add -- notes-frontend/src/app/dashboard/notes/new/page.tsx notes-frontend/src/app/dashboard/notes/new/useNewNotePage.ts notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__/new-note-page.spec.tsx
git commit -m "feat(editor): 统一新建笔记界面"
```

### Task 3: 完整验证

**Files:**
- Verify only unless验证暴露本任务回归。

**Interfaces:**
- Consumes: Task 1 和 Task 2 的最终行为。
- Produces: 自动化与浏览器验收证据。

- [ ] **Step 1: 运行相关前端测试**

Run: `npx jest --runInBand __tests__/editor.tiptap.auth.spec.tsx __tests__/new-note-page.spec.tsx __tests__/editor.tiptap.spec.tsx`

- [ ] **Step 2: 运行静态检查**

```powershell
npm run type-check
npm run lint
git diff --check
```

- [ ] **Step 3: 浏览器验收**

启动本地前后端后访问 `/dashboard/notes/new`，确认：

- 页面使用新版紧凑编辑器布局，桌面和窄屏没有横向溢出。
- Network 没有 `/notes/new/room-ticket`。
- Console 没有 Axios 400 或 Next.js error overlay。
- 标题和正文可输入；分类、标签、可见性可操作。
- 点击“创建笔记”只产生一次创建请求，成功后进入真实 ID 详情页。

- [ ] **Step 4: 检查工作树只包含本任务文件及用户原有改动**

Run: `git status --short`
