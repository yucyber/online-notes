# 编辑器收尾修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次性修复编辑器 5 个收尾问题：评论幂等键 400、BubbleMenu 整合与样式、大纲滚动/跳转/语雀样式、左栏搜索框压缩、左栏收起按钮语雀化。

**Architecture:** 5 个改动相互独立，全部落在 `notes-frontend`。评论幂等键抽成独立工具函数；BubbleMenu 通过扩展 `TiptapAiActions` 的 `mode` 接入 AI 续写；大纲复用 Tiptap 已有 `editor:scrollToHeading` 事件做跳转，并修复滚动容器；左栏搜索框与收起按钮仅改 CSS 结构。

**Tech Stack:** Next.js 14、React、TypeScript、lucide-react、Jest + @testing-library/react、Tiptap、react-hot-toast、PostCSS（CSS 契约测试）。

## Global Constraints

- 所有 commit message 用**中文**，格式 `类型(范围): 简述`（AGENTS.md 规范）。
- 图标一律用 `lucide-react` 的 `Chevron` 轻量箭头家族，**禁用**字符符号（`⊖`/`▤`/`▾`）和 Panel 系图标（`PanelLeftClose` 等）。
- 所有图标统一 `width/height: 16px`、`stroke-width: 1.75`。
- 编辑器专属样式一律收敛到 `notes-frontend/src/styles/editor-tokens.css`，不新增内联 `style`。
- 后端正则 `/^[A-Za-z0-9._-]{8,64}$/` **不改**，只在前端生成合法幂等键。
- 保留现有 CSS class 名 `.editor-sidebar-collapse-handle`（`responsive-editor-ui.spec.tsx:128` 断言其存在），可改其结构但不能删名。
- 大纲宽屏 `<aside className="editor-outline">` 保持 `position: fixed` 定位策略，不改 `.editor-layout-grid` 契约（`editor-css-contract.spec.ts` 精确断言）。
- 每个任务结束运行前端测试 + 类型检查。

---

### Task 1: 评论幂等键生成（修复 400）

**Files:**
- Create: `notes-frontend/src/lib/comments-key.ts`
- Create: `notes-frontend/__tests__/comments-key.spec.ts`
- Modify: `notes-frontend/src/components/collab/CommentsPanel.tsx:52-55`

**Interfaces:**
- Produces: `buildCommentIdempotencyKey(noteId: string, start: number, end: number, text: string): Promise<string>` —— 返回 40 字符小写十六进制（SHA-1 摘要）。
- Consumes: `CommentsPanel.add()` 中替代现有 `${noteId}:${start}:${end}:${text}` 拼接。

- [ ] **Step 1: 写失败测试**

`notes-frontend/__tests__/comments-key.spec.ts`:

```ts
import { buildCommentIdempotencyKey } from '@/lib/comments-key'

describe('评论幂等键生成', () => {
  it('对同一参数产生稳定且符合后端字符集的键', async () => {
    const a = await buildCommentIdempotencyKey('abc123', 0, 5, '含中文评论')
    const b = await buildCommentIdempotencyKey('abc123', 0, 5, '含中文评论')
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-z0-9]{40}$/)
  })

  it('不同文本产生不同键', async () => {
    const a = await buildCommentIdempotencyKey('abc123', 0, 5, '第一条')
    const b = await buildCommentIdempotencyKey('abc123', 0, 5, '第二条')
    expect(a).not.toBe(b)
  })

  it('冒号与中文不会进入最终键', async () => {
    const key = await buildCommentIdempotencyKey('a:b:c', 0, 5, '：中文：')
    expect(key).toMatch(/^[a-z0-9]{40}$/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd notes-frontend && npx jest __tests__/comments-key.spec.ts --no-coverage`
Expected: FAIL，报 `Cannot find module '@/lib/comments-key'` 或 `buildCommentIdempotencyKey is not defined`。

- [ ] **Step 3: 实现 `comments-key.ts`**

`notes-frontend/src/lib/comments-key.ts`:

```ts
// 生成评论幂等键：用 SHA-1 把可能含冒号/中文的原始输入编码成后端允许的 [a-z0-9]{40}。
// 后端正则 /^[A-Za-z0-9._-]{8,64}$/，直接拼接 noteId:start:end:text 会因冒号与中文而 400。
const encoder = new TextEncoder()

function utf8Bytes(input: string): Uint8Array {
  return encoder.encode(`${input}`)
}

export async function buildCommentIdempotencyKey(noteId: string, start: number, end: number, text: string): Promise<string> {
  const raw = `${noteId}:${start}:${end}:${text}`
  const digest = await crypto.subtle.digest('SHA-1', utf8Bytes(raw))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd notes-frontend && npx jest __tests__/comments-key.spec.ts --no-coverage`
Expected: PASS（3 个用例全过）。

- [ ] **Step 5: 接入 `CommentsPanel.tsx`**

`notes-frontend/src/components/collab/CommentsPanel.tsx`:
- 顶部 import：`import { buildCommentIdempotencyKey } from '@/lib/comments-key'`
- 把 `add` 函数中第 54 行 `const idemKey = \`${noteId}:${selection.start}:${selection.end}:${text.trim()}\`` 改为：

```ts
const idemKey = await buildCommentIdempotencyKey(noteId, selection.start, selection.end, text.trim())
```

（`add` 已是 `async`，可直接 await。）

- [ ] **Step 6: 跑相关测试 + 类型检查**

Run: `cd notes-frontend && npx jest __tests__/comments-key.spec.ts __tests__/editor.tiptap.spec.tsx --no-coverage && npm run type-check`
Expected: 全部 PASS，type-check 无错误。

- [ ] **Step 7: Commit**

```bash
cd notes-frontend && cd ..
git add notes-frontend/src/lib/comments-key.ts notes-frontend/__tests__/comments-key.spec.ts notes-frontend/src/components/collab/CommentsPanel.tsx
git commit -m "fix(editor): 评论幂等键改为SHA-1编码修复400"
```

---

### Task 2: 左栏搜索框压缩 + 收起按钮语雀化

**Files:**
- Modify: `notes-frontend/src/styles/editor-tokens.css`（`.editor-workspace-sidebar__search`、`.editor-sidebar-collapse-handle`、新增 `.editor-sidebar-collapse-pin`）
- Modify: `notes-frontend/src/components/editor/EditorWorkspaceSidebar.tsx`
- Modify: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`（可选：补充新断言）

**Interfaces:**
- Produces: `.editor-sidebar-collapse-pin` 类（语雀式竖向胶囊）；`.editor-workspace-sidebar__search` 高度收紧到 36px；`.editor-sidebar-collapse-handle` 保留 class 但改为右边界悬出触点。
- Consumes: `EditorWorkspaceSidebar` 的 `collapsed` prop 控制箭头方向。

- [ ] **Step 1: 收紧搜索框 CSS**

`editor-tokens.css` 中 `.editor-workspace-sidebar__search` 把 `min-height: 42px` 改为 `36px`。

- [ ] **Step 2: 新增收起按钮胶囊样式**

在 `editor-tokens.css` 追加（替换原 `.editor-sidebar-collapse-handle` 规则内部实现，保留 class 名）：

```css
.editor-sidebar-collapse-handle {
  position: absolute;
  top: 80px;
  right: -14px;
  width: 28px;
  height: 56px;
  display: grid;
  place-items: center;
  border: 1px solid var(--product-line, var(--border));
  border-left: 0;
  border-radius: 0 10px 10px 0;
  background: var(--product-panel, var(--surface-1));
  color: var(--product-text-muted, var(--text-muted));
  box-shadow: var(--shadow-sm);
  opacity: 0.6;
  transition: opacity 200ms ease, color 200ms ease, background 200ms ease;
  cursor: pointer;
  z-index: 2;
  padding: 0;
}
.editor-sidebar-collapse-handle:hover,
.editor-sidebar-collapse-handle:focus-visible {
  opacity: 1;
  color: var(--product-text, var(--on-surface));
  background: #fff;
  outline: none;
}
.editor-sidebar-collapse-handle svg { width: 16px; height: 16px; }
```

- [ ] **Step 3: 更新 `EditorWorkspaceSidebar.tsx` 收起按钮**

- 顶部 import 改为：`import { ArrowLeft, ChevronLeft, ChevronRight, FileText, Search } from 'lucide-react'`（去掉 `PanelLeftClose`）。
- 展开态（`collapsed === false`）底部按钮：class 保持 `editor-sidebar-collapse-handle`，图标用 `ChevronLeft`，`aria-label="收起左侧导航"`，位置由 CSS `absolute` 控制，无需再手动布局。
- 收起态（`collapsed === true`）触发按钮 `.editor-left-edge-trigger`：图标改用 `ChevronRight`（表示可展开），class 保留，追加 `editor-sidebar-collapse-pin` 辅助类（可选，若希望收起态也半悬出）。

```tsx
if (collapsed) {
  return (
    <aside id="editor-left-navigation" className="editor-left-navigation editor-left-navigation--collapsed" aria-label="编辑器导航">
      <Button ref={restoreButtonRef} type="button" variant="ghost" size="icon"
        className="editor-left-edge-trigger editor-sidebar-collapse-pin"
        aria-label="展开左侧导航" title="展开左侧导航" onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onToggle()
        }}>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Button>
    </aside>
  )
}
```

展开态底部按钮：

```tsx
<button type="button" className="editor-sidebar-collapse-handle" aria-label="收起左侧导航" onClick={onToggle}><ChevronLeft className="h-4 w-4" aria-hidden /></button>
```

- [ ] **Step 4: 补充/更新测试断言**

`responsive-editor-ui.spec.tsx` 的 `左栏收起后释放轨道并保留边缘恢复触点` 测试追加断言：

```ts
expect(productCss).toMatch(/\.editor-sidebar-collapse-handle\s*\{[^}]*right:\s*-14px/s)
expect(productCss).toMatch(/\.editor-sidebar-collapse-handle\s*\{[^}]*height:\s*56px/s)
```

- [ ] **Step 5: 跑测试 + 类型检查**

Run: `cd notes-frontend && npx jest __tests__/responsive-editor-ui.spec.tsx --no-coverage && npm run type-check`
Expected: PASS，type-check 无错误。

- [ ] **Step 6: Commit**

```bash
cd ..
git add notes-frontend/src/styles/editor-tokens.css notes-frontend/src/components/editor/EditorWorkspaceSidebar.tsx notes-frontend/__tests__/responsive-editor-ui.spec.tsx
git commit -m "feat(editor): 左栏搜索框收紧并语雀化收起按钮"
```

---

### Task 3: BubbleMenu 整合 AI 续写 + 浅色样式

**Files:**
- Modify: `notes-frontend/src/components/editor/TiptapAiActions.tsx`
- Modify: `notes-frontend/src/components/editor/TiptapEditor.tsx:492-547`
- Modify: `notes-frontend/src/styles/editor-tokens.css`（`.editor-selection-popover`）
- Create: `notes-frontend/__tests__/editor-selection-popover.spec.tsx`

**Interfaces:**
- Produces: `TiptapAiActions` 支持 `mode: 'continue' | 'selection' | 'bubble'`；新增 `showContinue?: boolean` prop。`bubble` 模式渲染"AI 续写/润色/摘要"三合一，`showContinue` 控制是否显示续写。
- Consumes: `TiptapEditor` 的 `BubbleMenu` 内调用 `TiptapAiActions`，`mode="bubble"`。

- [ ] **Step 1: 写失败测试**

`notes-frontend/__tests__/editor-selection-popover.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { TiptapAiActions } from '@/components/editor/TiptapAiActions'

describe('文本选择浮层整合 AI 入口', () => {
  const editor = {
    state: { selection: { from: 0, to: 5 }, doc: { textBetween: () => 'hello' } },
    chain: () => ({ focus: () => ({ insertContent: () => ({ run: () => {} }) }) }),
  } as any

  it('bubble 模式同时暴露 AI 续写、润色与摘要入口', () => {
    render(<TiptapAiActions editor={editor} readOnly={false} aiWritingType={null} setAiWritingType={() => {}} mode="bubble" />)
    expect(screen.getByRole('button', { name: 'AI 续写' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI 润色' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI 摘要' })).toBeInTheDocument()
  })

  it('continue 模式仍是独立的单一续写入口', () => {
    render(<TiptapAiActions editor={editor} readOnly={false} aiWritingType={null} setAiWritingType={() => {}} mode="continue" />)
    expect(screen.getByRole('button', { name: 'AI 续写' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI 摘要' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd notes-frontend && npx jest __tests__/editor-selection-popover.spec.tsx --no-coverage`
Expected: FAIL，`mode="bubble"` 未实现（当前 `TiptapAiActions` 无此分支）。

- [ ] **Step 3: 扩展 `TiptapAiActions.tsx`**

- `type Props` 中 `mode: 'continue' | 'selection' | 'bubble'`。
- 新增 `bubble` 分支（在 `selection` 分支前返回）：

```tsx
if (mode === 'bubble') {
  return (
    <>
      <Button aria-label="AI 续写" title="AI 续写" size="icon" variant="ghost"
        disabled={readOnly || !!aiWritingType}
        onClick={() => {
          if (!editor) return
          const { from } = editor.state.selection
          const context = editor.state.doc.textBetween(Math.max(0, from - 500), from, '\n')
          setAiWritingType('continue')
          streamAIWriter({
            context, type: 'continue',
            onChunk: (text) => editor.chain().focus().insertContent(text).run(),
            onDone: () => setAiWritingType(null),
            onError: () => setAiWritingType(null),
          })
        }}>
        {aiWritingType === 'continue' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenTool className="w-4 h-4" />}
      </Button>
      <Button aria-label="AI 润色" title="AI 润色" size="icon" variant="ghost"
        disabled={readOnly || !!aiWritingType}
        onClick={() => {
          const { from, to } = editor.state.selection
          const context = editor.state.doc.textBetween(from, to, '\n')
          setAiWritingType('polish')
          let isFirstChunk = true
          streamAIWriter({
            context, type: 'polish',
            onChunk: (text) => {
              if (isFirstChunk) { editor.chain().focus().deleteSelection().insertContent(text).run(); isFirstChunk = false }
              else editor.chain().focus().insertContent(text).run()
            },
            onDone: () => setAiWritingType(null),
            onError: () => setAiWritingType(null),
          })
        }}>
        {aiWritingType === 'polish' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-purple-500" />}
      </Button>
      <Button aria-label="AI 摘要" title="生成摘要" size="icon" variant="ghost"
        disabled={readOnly || !!aiWritingType}
        onClick={() => {
          const { from, to } = editor.state.selection
          const context = editor.state.doc.textBetween(from, to, '\n')
          setAiWritingType('summary')
          editor.chain().focus().setTextSelection(to).insertContent('\n\n> **摘要**：').run()
          streamAIWriter({
            context, type: 'summary',
            onChunk: (text) => editor.chain().focus().insertContent(text).run(),
            onDone: () => { editor.chain().focus().insertContent('\n\n').run(); setAiWritingType(null) },
            onError: () => setAiWritingType(null),
          })
        }}>
        {aiWritingType === 'summary' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4 text-blue-500" />}
      </Button>
    </>
  )
}
```

（`selection` 分支保持不变，供其他场景复用。）

- [ ] **Step 4: `TiptapEditor.tsx` 让 BubbleMenu 用 bubble 模式**

在 `BubbleMenu` 内的 `<TiptapAiActions ... mode="selection">`（第 528 行）改为 `mode="bubble"`。

同时删除 BubbleMenu 内联 `style={{ height: 44, paddingLeft: 8, paddingRight: 8, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-1)' }}`（第 526 行），并给 tippyOptions 加 `theme: 'light-border'`：

```tsx
tippyOptions={{
  duration: 150,
  appendTo: () => document.body,
  theme: 'light-border',
}}
```

- [ ] **Step 5: 收敛浮层样式到 token**

`editor-tokens.css` 中 `.editor-selection-popover` 更新为 spec 定义：

```css
.editor-selection-popover {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  min-height: 38px;
  border: 1px solid var(--product-line, var(--border));
  border-radius: var(--product-radius-md, 10px);
  background: var(--product-panel, var(--surface-1));
  box-shadow: var(--shadow-md);
  color: var(--product-text, var(--on-surface));
}
.editor-selection-popover > button {
  min-width: 36px;
  min-height: 32px;
  border-radius: 8px;
}
```

- [ ] **Step 6: 跑测试 + 类型检查**

Run: `cd notes-frontend && npx jest __tests__/editor-selection-popover.spec.tsx __tests__/editor.tiptap.spec.tsx --no-coverage && npm run type-check`
Expected: 全部 PASS，type-check 无错误。

- [ ] **Step 7: Commit**

```bash
cd ..
git add notes-frontend/src/components/editor/TiptapAiActions.tsx notes-frontend/src/components/editor/TiptapEditor.tsx notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__/editor-selection-popover.spec.tsx
git commit -m "feat(editor): 文本浮层整合AI续写并收敛浅色样式"
```

---

### Task 4: 大纲语雀样式 + 滚动 + 跳转修复

**Files:**
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`（大纲跳转 + 抽屉样式）
- Modify: `notes-frontend/src/styles/editor-tokens.css`（`.editor-outline` 滚动 + 语雀样式）
- Create: `notes-frontend/__tests__/editor-outline.spec.tsx`

**Interfaces:**
- Produces: 大纲条目点击派发 `editor:scrollToHeading` 事件（`detail: { index }`）；`.editor-outline__view` 内部可滚动。
- Consumes: `TiptapEditor` 已有 `editor:scrollToHeading` handler（接受 `{ index: number }`）。

- [ ] **Step 1: 写失败测试**

`notes-frontend/__tests__/editor-outline.spec.tsx`:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react'
import NoteEditorShell from '@/components/editor/NoteEditorShell'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => <div /> }))
jest.mock('marked', () => ({ marked: { parse: jest.fn() } }))
jest.mock('react-hot-toast', () => ({ Toaster: () => null, toast: { dismiss: jest.fn() } }))
jest.mock('@/components/editor/TiptapToolbar', () => ({ __esModule: true, default: () => <div /> }))
jest.mock('@/components/editor/NoteEditorDrawers', () => ({ NoteEditorDrawers: () => null }))
jest.mock('@/components/editor/useNoteSave', () => ({ useNoteSave: () => ({ handleSave: jest.fn(), handleSaveDraft: jest.fn(), addTagsByNames: jest.fn() }) }))
jest.mock('@/components/editor/useEditorAutoSave', () => ({ useEditorAutoSave: () => ({ state: { status: 'saved' }, saveNow: jest.fn() }) }))
jest.mock('@/components/editor/note-permissions', () => ({ canWriteNote: () => true, shouldManageNoteLock: () => false }))
jest.mock('@/lib/api', () => ({
  fetchCategories: jest.fn(() => new Promise(() => {})),
  fetchTags: jest.fn(() => new Promise(() => {})),
  fetchNoteById: jest.fn(),
  fetchNotes: jest.fn(() => Promise.resolve({ items: [] })),
  lockNote: jest.fn(), unlockNote: jest.fn(),
  boardsAPI: { create: jest.fn() }, mindmapsAPI: { create: jest.fn() },
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: () => null }))

describe('编辑器大纲交互', () => {
  const note = { id: 'n1', title: '大纲测试', content: '<h1>第一节</h1><h2>子节</h2>', tags: [], visibility: 'private' } as any

  it('宽屏大纲条目点击派发 editor:scrollToHeading 事件', () => {
    const dispatch = jest.spyOn(document, 'dispatchEvent')
    render(<NoteEditorShell id="n1" initialData={note} />)
    const outline = screen.getByRole('complementary', { name: '大纲' })
    const item = within(outline).getByText('第一节')
    fireEvent.click(item)
    const evt = dispatch.mock.calls.map((c) => c[0] as CustomEvent).find((e) => e.type === 'editor:scrollToHeading')
    expect(evt).toBeDefined()
    expect((evt as CustomEvent).detail.index).toBe(0)
  })

  it('大纲隐藏按钮切换 pin 状态', () => {
    render(<NoteEditorShell id="n1" initialData={note} />)
    const outline = screen.getByRole('complementary', { name: '大纲' })
    fireEvent.click(within(outline).getByRole('button', { name: '隐藏大纲' }))
    expect(outline).toHaveAttribute('data-pinned', 'false')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd notes-frontend && npx jest __tests__/editor-outline.spec.tsx --no-coverage`
Expected: FAIL——当前大纲条目点击不派发 `editor:scrollToHeading` 事件（现在是 `scrollIntoView`），且没有 `隐藏大纲` 按钮。

- [ ] **Step 3: 修改 `NoteEditorShell.tsx` 大纲结构**

把宽屏 `<aside className="editor-outline">`（约 663-672 行）替换为语雀式结构，并让条目点击派发事件：

```tsx
{!isFullscreen && (
  <aside className="editor-outline" data-pinned={outlinePinned} aria-label="大纲">
    <div className="editor-outline__pin">
      <span className="editor-outline__pin-text">大纲</span>
      <button type="button" className="editor-outline__hide" aria-label="隐藏大纲" onClick={() => setOutlinePinned(false)}>
        <ChevronRight className="w-4 h-4" aria-hidden />
      </button>
    </div>
    <div className="editor-outline__view">
      <div className="editor-outline__list">
        {toc.length === 0 ? <span className="editor-outline__empty">暂无标题</span> : toc.map((heading, index) => (
          <div key={heading.id} className="editor-outline__item" data-depth={heading.level}>
            <button type="button" className="editor-outline__link"
              onClick={() => document.dispatchEvent(new CustomEvent('editor:scrollToHeading', { detail: { index } }))}>
              {heading.text}
            </button>
          </div>
        ))}
      </div>
    </div>
  </aside>
)}
```

- 顶部 import 补 `ChevronRight`（从 `lucide-react`）。

注意：宽屏大纲原本 `data-pinned` 默认为 `true`，隐藏按钮点击后 `setOutlinePinned(false)` 触发 CSS 收起为细条；恢复固定可通过保留现有 `editor-outline__toggle` 逻辑或让细条 hover 展开（保持 spec 的语雀式单隐藏按钮 + 悬停恢复）。若需恢复，在 `data-pinned=false` 的细条上保留 hover 展开，并加一个"固定恢复"小按钮（可选，用 `ChevronLeft`）。本任务保持最小改动：隐藏后细条 hover 临时展开，点击细条空白区恢复 `setOutlinePinned(true)`。

- [ ] **Step 4: 修改抽屉大纲结构（语雀样式复用）**

`showOutlineDrawer` 抽屉内的 `.editor-outline__content` 也复用新的 `.editor-outline__view/.editor-outline__list` 结构，条目点击改为：

```tsx
onClick={() => { document.dispatchEvent(new CustomEvent('editor:scrollToHeading', { detail: { index } })); setShowOutlineDrawer(false) }}
```

并在抽屉 header 的"关闭"按钮旁加 `aria-label="关闭大纲"`（保持 `responsive-editor-ui.spec.tsx:189` 用 `打开大纲` 按钮 + `关闭` 按钮）。

- [ ] **Step 5: 修复滚动 + 语雀样式（CSS）**

`editor-tokens.css` 更新 `.editor-outline` 相关：

```css
.editor-outline {
  position: fixed;
  top: 176px;
  right: 18px;
  z-index: 8;
  width: 210px;
  max-height: calc(100vh - 210px);
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--product-line, var(--border));
  background: var(--product-bg, var(--bg));
}
.editor-outline__pin {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 700;
}
.editor-outline__hide {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--product-text-muted, var(--text-muted));
  cursor: pointer;
}
.editor-outline__hide:hover { background: var(--product-panel, var(--surface-1)); }
.editor-outline__hide svg { width: 16px; height: 16px; }
.editor-outline__view {
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  min-height: 0;
  padding: 4px 8px 12px;
}
.editor-outline__list { display: block; }
.editor-outline__item { display: flex; align-items: stretch; }
.editor-outline__link {
  display: block;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--product-text-secondary);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
}
.editor-outline__item[data-depth="1"] .editor-outline__link { padding-left: 8px; }
.editor-outline__item[data-depth="2"] .editor-outline__link { padding-left: 20px; }
.editor-outline__item[data-depth="3"] .editor-outline__link { padding-left: 32px; }
.editor-outline__item[data-depth="4"] .editor-outline__link { padding-left: 44px; }
.editor-outline__item[data-depth="5"] .editor-outline__link { padding-left: 56px; }
.editor-outline__item[data-depth="6"] .editor-outline__link { padding-left: 68px; }
.editor-outline__link:hover { background: var(--product-panel, var(--surface-1)); }
.editor-outline__empty { color: var(--product-text-muted, var(--text-muted)); font-size: 12px; padding: 8px; }
/* 细窄滚动条（语雀风格） */
.editor-outline__view::-webkit-scrollbar { width: 6px; }
.editor-outline__view::-webkit-scrollbar-thumb { background: var(--product-line, var(--border)); border-radius: 3px; }
.editor-outline__view::-webkit-scrollbar-track { background: transparent; }
```

保留现有 `data-pinned="false"` 细条悬停展开规则（可复用 spec 的 `.editor-outline[data-pinned="false"]` 规则），但需把 `.editor-outline__content` 选择器改为 `.editor-outline__view` / `.editor-outline__pin`，确保隐藏态 opacity 生效。

- [ ] **Step 6: 跑测试 + 类型检查**

Run: `cd notes-frontend && npx jest __tests__/editor-outline.spec.tsx __tests__/responsive-editor-ui.spec.tsx --no-coverage && npm run type-check`
Expected: 全部 PASS（含既有 `打开大纲`/`关闭` 抽屉测试不回归），type-check 无错误。

- [ ] **Step 7: Commit**

```bash
cd ..
git add notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__/editor-outline.spec.tsx
git commit -m "feat(editor): 大纲语雀化并修复滚动与跳转"
```

---

### Task 6: 搜索框 gap 收紧 + 大纲入口去重（spec §7.1/7.2）

**Files:**
- Modify: `notes-frontend/src/styles/editor-tokens.css`（`.editor-workspace-sidebar` gap/padding）
- Modify: `notes-frontend/src/components/editor/NoteEditorHeader.tsx`（删"打开大纲"按钮）
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`（`onToggleOutline` 置空）
- Modify: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`（补充断言）

**Interfaces:**
- Produces: `.editor-workspace-sidebar` gap 12px + padding 12px；`NoteEditorHeader` 不再渲染"打开大纲"按钮。
- Consumes: 无（纯布局 + 去重）。

- [ ] **Step 1: 收紧搜索框周围间隔**

`editor-tokens.css` `.editor-workspace-sidebar`：

```css
.editor-workspace-sidebar {
  position: sticky;
  top: 0;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: 12px;              /* 原 18px */
  min-height: 100vh;
  padding: 12px 12px;     /* 原 18px 14px */
}
```

- [ ] **Step 2: 删除 NoteEditorHeader "打开大纲"按钮**

`NoteEditorHeader.tsx` 删除渲染"打开大纲"按钮的代码（第 40 行附近），同时删除 `onToggleOutline` prop 及其在 `Props`/解构中的声明。

- [ ] **Step 3: NoteEditorShell 置空 onToggleOutline**

`NoteEditorShell.tsx` 中 `<NoteEditorHeader onToggleOutline={() => setShowOutlineDrawer((open) => !open)}` 删除 `onToggleOutline` 传参。

- [ ] **Step 4: 补充测试断言**

`responsive-editor-ui.spec.tsx` 的 `左栏收起后释放轨道并保留边缘恢复触点` 测试追加：

```ts
expect(productCss).toMatch(/\.editor-workspace-sidebar\s*\{[^}]*gap:\s*12px/s)
```

- [ ] **Step 5: 跑测试 + 类型检查**

Run: `cd notes-frontend && npx jest __tests__/responsive-editor-ui.spec.tsx --no-coverage && npm run type-check`
Expected: PASS，type-check 无错误。

- [ ] **Step 6: Commit**

```bash
cd ..
git add notes-frontend/src/styles/editor-tokens.css notes-frontend/src/components/editor/NoteEditorHeader.tsx notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/__tests__/responsive-editor-ui.spec.tsx
git commit -m "feat(editor): 收紧左栏密度并收敛大纲入口"
```

---

### Task 7: 大纲三栏文档流 + 小眼睛交互（spec §7.3/7.4）

**Files:**
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`（大纲结构改为 sticky 列 + Eye/EyeOff 按钮）
- Modify: `notes-frontend/src/styles/editor-tokens.css`（`.editor-outline` 文档流 + 小眼睛 + 响应式）
- Modify: `notes-frontend/__tests__/editor-outline.spec.tsx`（补充小眼睛交互契约）
- Modify: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`（大纲入口变更回归）

**Interfaces:**
- Produces: 大纲头部按钮用 `Eye`/`EyeOff`；宽屏大纲 `position: sticky` 文档流列。
- Consumes: `outlinePinned` 状态（true=持续显示/EyeOff，false=隐藏/Eye）。

- [ ] **Step 1: 写失败测试（小眼睛交互 + 无感布局）**

在 `notes-frontend/__tests__/editor-outline.spec.tsx` 追加：

```tsx
it('大纲持续显示时按钮为有斜杠小眼睛，点击不自动关闭', () => {
  render(<NoteEditorShell id="n1" initialData={note} />)
  const outline = screen.getByRole('complementary', { name: '大纲' })
  expect(outline).toHaveAttribute('data-pinned', 'true')
  // pinned=true 时显示 EyeOff（有斜杠）
  expect(within(outline).getByRole('button', { name: '收起大纲' })).toBeInTheDocument()
  fireEvent.click(screen.getByText('第一节'))
  // 点击正文条目不应自动关闭大纲
  expect(screen.getByRole('complementary', { name: '大纲' })).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd notes-frontend && npx jest __tests__/editor-outline.spec.tsx --no-coverage`
Expected: FAIL——当前按钮 aria-label 是"隐藏大纲"，不是"收起大纲"。

- [ ] **Step 3: 改 NoteEditorShell 大纲头部按钮为 Eye/EyeOff**

把 `NoteEditorShell.tsx` 大纲头部 `<button className="editor-outline__hide">` 改为：

```tsx
<button
  type="button"
  className="editor-outline__hide"
  aria-label={outlinePinned ? '收起大纲' : '展开大纲'}
  onClick={() => setOutlinePinned((value) => !value)}
>
  {outlinePinned ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
</button>
```

顶部 import 加 `Eye, EyeOff`（替换 `ChevronRight`）。

- [ ] **Step 4: 改大纲为三栏文档流 + sticky**

`.editor-outline` CSS 从 `position: fixed` 改为 `position: sticky`，并在 `.editor-layout-main` 内做 flex 三栏：

```css
.editor-layout-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
/* 宽屏时编辑区内部改为 row，主区 flex:1，大纲 220px */
.editor-rich-editor { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.editor-outline {
  position: sticky;
  top: 0;
  width: 220px;
  height: 100vh;
  flex: none;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--product-line, var(--border));
  background: var(--product-bg, var(--bg));
}
/* 大纲从编辑区内脱离，作为 .editor-layout-main 的 row 级子项： */
```

实现时：把 `.editor-outline` 从 `.editor-rich-editor` 内部移出，作为 `.editor-layout-main` 的直接子项，并让 `.editor-layout-main` 在宽屏时是 `flex-direction: row`（`flex: 1` 的 `.editor-rich-editor` + 固定 `220px` 的 `.editor-outline`）。`.editor-layout-main` 顶部 header/属性面板仍保持纵向。

> 说明：`.editor-layout-main` 当前是纵向列（header + metadata + rich-editor）。若要三栏"顶部对齐"，更稳妥做法：保留 `.editor-layout-main` 纵向，但内部新增一个 `.editor-edit-row` 包裹 `.editor-rich-editor` + `.editor-outline`，`flex: 1`，`display: flex; flex-direction: row`，大纲在行内文档流、`align-self: stretch`、`width: 220px`、内部 `overflow-y: auto`。此方案不改 header/metadata，只重构正文行。

- [ ] **Step 5: 响应式隐藏右栏**

在 `editor-tokens.css` 的窄屏媒体查询（`@media (max-width: 1023px)` 附近）追加：

```css
@media (max-width: 1023px) {
  .editor-outline { display: none; }
}
```

- [ ] **Step 6: 跑测试 + 类型检查 + CSS 契约**

Run: `cd notes-frontend && npx jest __tests__/editor-outline.spec.tsx __tests__/responsive-editor-ui.spec.tsx __tests__/editor-css-contract.spec.ts --no-coverage && npm run type-check`
Expected: 全部 PASS（既有 CSS 契约不回归），type-check 无错误。

- [ ] **Step 7: Commit**

```bash
cd ..
git add notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__/editor-outline.spec.tsx notes-frontend/__tests__/responsive-editor-ui.spec.tsx
git commit -m "feat(editor): 大纲改为三栏文档流并加小眼睛交互"
```

---

### Task 5: 全量验收

**Files:**
- 无代码改动，仅运行验证。

- [ ] **Step 1: 运行完整前端测试**

Run: `cd notes-frontend && npm run ci:test`
Expected: 全部套件通过（现有 144 + 新增 ~4 个用例全过）。

- [ ] **Step 2: 类型检查 + Lint**

Run: `cd notes-frontend && npm run type-check && npm run lint`
Expected: type-check 无错误；lint 0 error（允许既有无关 warning）。

- [ ] **Step 3: 生产构建**

Run: `cd notes-frontend && npm run build`
Expected: Next.js 构建成功。

- [ ] **Step 4: CSS 契约测试**

Run: `cd notes-frontend && npx jest __tests__/editor-css-contract.spec.ts --no-coverage`
Expected: PASS（确认未破坏 `.editor-layout-grid` 等既有契约）。

- [ ] **Step 5: git diff --check**

Run: `git diff --check`
Expected: 无空白错误。

- [ ] **Step 6: Commit（若 Task 5 发现需微调则随改动一并提交）**

```bash
git add -A notes-frontend
git commit -m "test(editor): 全量验收编辑器收尾修复"
```

---

## Self-Review

**1. Spec coverage 对照：**
- §1 评论幂等键 → Task 1 ✓
- §2 BubbleMenu 整合 + 浅色样式 → Task 3 ✓
- §3 大纲跳转/滚动/语雀样式 → Task 4 ✓
- §5 左栏搜索框压缩 → Task 2 ✓
- §6 左栏收起按钮 → Task 2 ✓
- §8 响应式与无障碍（大纲抽屉保留、按钮带 aria-label）→ Task 4 + Task 2 ✓
- §9 UI 库边界（样式收敛 token、复用 Button）→ 各任务 ✓
- §10 验收 → Task 5 ✓
- §7.1 搜索框 gap 收紧 → Task 6 ✓
- §7.2 大纲入口去重 → Task 6 ✓
- §7.3 大纲小眼睛交互（Eye/EyeOff + 不自动关闭）→ Task 7 ✓
- §7.4 大纲三栏文档流（sticky + 顶部对齐 + 无感）→ Task 7 ✓
- §7.5 二次验收 → Task 5 ✓

**2. Placeholder scan：** 所有步骤含完整代码与可执行命令，无 TBD/TODO。

**3. Type consistency：**
- `buildCommentIdempotencyKey(noteId, start, end, text): Promise<string>` 在 Task 1 定义并被 Task 1 使用，无跨任务引用。
- `mode: 'continue' | 'selection' | 'bubble'` 在 Task 3 定义，`bubble` 分支测试在 Task 3 Step 1 使用，一致。
- `editor:scrollToHeading` 事件 `detail: { index }` 在 Task 4 派发，复用 TiptapEditor 既有 handler（spec §3.3.1 已确认其接受 `{ index }`），一致。
- CSS class：`.editor-sidebar-collapse-handle` 名保留（Task 2），既有测试断言不破坏。
