# 在线笔记渐进式 UI 统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不一次性重做全部业务页面的前提下，先修复内容覆盖风险，再统一全局设计基础、Dashboard 壳层、编辑器和笔记主链路。

**Architecture:** 使用“数据安全前置门禁 → 全局 token/基础组件 → AppShell → 编辑器/笔记主链路 → 浏览器验收”的渐进迁移。全站共享一套语义 token 和基础组件；未迁移业务页先继承统一壳层，不在本轮改业务结构。

**Tech Stack:** Next.js 16、React 18、TypeScript、Tailwind CSS 3、Tiptap 2、Yjs/y-indexeddb/y-websocket、Lucide React、Jest/Testing Library、agent-browser。

## Global Constraints

- 视觉采用浅色、蓝灰中性色、内容优先、克制阴影；禁止墨绿主视觉、紫色渐变和大面积装饰效果。
- 图标唯一来源为 `lucide-react`；图标按钮必须有 `aria-label` 与 Tooltip，移动端点击区域至少 44×44px。
- 产品 UI 不显示 `ws[...]`、`sync[...]`、API 延迟或常驻“保存/重连/触发同步”。
- 自动保存、离线恢复、只读边界和 room ticket 刷新必须在视觉迁移前通过回归测试。
- 不引入新的大型 UI 组件库，不重做非笔记业务页面的信息架构。
- 每个任务先 RED、再 GREEN、再审查；Critical/Important 必须清零，Minor 记录后收口。
- 复杂业务、权限和异步时序注释使用简洁中文，只解释原因与约束。
- Commit message 使用中文 `类型(范围): 简述`。

---

## File Structure

### 新增

- `notes-frontend/src/styles/product-tokens.css`：全站颜色、间距、圆角、阴影、控件尺寸和动效 token 的唯一来源。
- `notes-frontend/src/components/layout/AppShell.tsx`：Dashboard 共享壳层和 responsive 导航状态。
- `notes-frontend/src/components/layout/PageSurface.tsx`：页面内容区的统一宽度、间距与 surface 语义。
- `notes-frontend/src/components/ui/icon-button.tsx`：带 Tooltip 和可访问名称的图标按钮。
- `notes-frontend/__tests__/editor-save-queue.spec.tsx`：串行 latest-wins 保存队列回归。
- `notes-frontend/__tests__/editor-persistence-recovery.spec.tsx`：IndexedDB/Yjs/API seed 恢复回归。
- `notes-frontend/__tests__/app-shell-visual-contract.spec.tsx`：壳层、token、断点和禁用诊断 UI 契约。
- `notes-frontend/__tests__/notes-primary-flow-ui.spec.tsx`：列表、新建、编辑主链路组件一致性回归。

### 重点修改

- `notes-frontend/src/components/editor/useEditorAutoSave.ts`：单请求串行 latest-wins 队列。
- `notes-frontend/src/components/editor/useTiptapPersistence.ts`、`TiptapEditor.tsx`：持久化三态和安全 seed。
- `notes-frontend/src/components/editor/useTiptapCollab.ts`：刷新 ticket 后重建 provider。
- `notes-frontend/src/components/ai/ChatWindow.tsx`：AI 单请求和按 message ID 更新。
- `notes-frontend/src/lib/app-toast.tsx`、`components/ui/AppToaster.tsx`：FIFO 清理和焦点恢复。
- `notes-frontend/src/app/dashboard/layout.tsx`、`components/dashboard/dashboard-navigation.tsx`：迁移到 `AppShell`。
- `notes-frontend/src/components/editor/NoteEditorShell.tsx`、`NoteEditorHeader.tsx`、`NoteEditorMetadataPanel.tsx`、`TiptapEditor.tsx`、`TiptapToolbar.tsx`：完整三栏编辑器和移除诊断控件。
- `notes-frontend/src/app/dashboard/notes/page.tsx`、`notes/new/page.tsx`：笔记主链路统一。

---

### Task 1: 自动保存串行 latest-wins

**Files:**
- Create: `notes-frontend/__tests__/editor-save-queue.spec.tsx`
- Modify: `notes-frontend/src/components/editor/useEditorAutoSave.ts`
- Modify: `notes-frontend/__tests__/editor-auto-save.spec.tsx`

**Interfaces:**
- Consumes: `save(snapshot): Promise<void>`，现有 `SaveState`。
- Produces: 同一 note 同时最多一个写请求；运行期间只保留最新 pending snapshot；`saveNow()` 返回当前 drain promise。

- [ ] **Step 1: 写逆序覆盖与同 key 回退的失败测试**

```tsx
it('串行保存并让服务器最终停留在最新快照', async () => {
  const first = deferred<void>()
  const save = jest.fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValueOnce(undefined)
  const { rerender } = render(<Harness title="A" content="1" save={save} />)
  rerender(<Harness title="A" content="2" save={save} />)
  await advanceDebounce()
  expect(save).toHaveBeenCalledTimes(1)
  first.resolve()
  await flushPromises()
  expect(save).toHaveBeenNthCalledWith(2, 'A', '2')
})
```

同时增加“内容 A → B → A，第一次 A 失败时仍能重试最后 A”和“请求进行中 `saveNow` 不产生并发”的断言。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm.cmd exec -- jest --runInBand __tests__/editor-save-queue.spec.tsx __tests__/editor-auto-save.spec.tsx`

Expected: 逆序场景 FAIL，现实现出现两个并发 `save`。

- [ ] **Step 3: 实现单消费者 drain 队列**

```ts
type SaveQueue = {
  running: Promise<void> | null
  pending: SaveSnapshot | null
  lastSavedKey: string
}

const enqueue = (snapshot: SaveSnapshot) => {
  queueRef.current.pending = snapshot
  if (!queueRef.current.running) queueRef.current.running = drain()
  return queueRef.current.running
}
```

`drain()` 每轮取走 pending；请求运行期间新输入只替换 pending。完成后若 pending 与成功快照不同，继续下一轮。失败保留最新 pending，并让 Toast action 再次调用 `enqueue(latest)`。切换 note、readOnly 或 unmount 时令旧队列失去 UI 回写资格，但不得把旧 promise 误复用于新快照。

- [ ] **Step 4: 运行聚焦测试**

Run: `npm.cmd exec -- jest --runInBand __tests__/editor-save-queue.spec.tsx __tests__/editor-auto-save.spec.tsx`

Expected: PASS，且测试显式断言任意时刻 `activeRequests <= 1`。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/components/editor/useEditorAutoSave.ts notes-frontend/__tests__/editor-save-queue.spec.tsx notes-frontend/__tests__/editor-auto-save.spec.tsx
git commit -m "fix(editor): 串行保存最新内容"
```

---

### Task 2: IndexedDB/Yjs/API seed 安全恢复

**Files:**
- Create: `notes-frontend/__tests__/editor-persistence-recovery.spec.tsx`
- Modify: `notes-frontend/src/components/editor/useTiptapPersistence.ts`
- Modify: `notes-frontend/src/components/editor/TiptapEditor.tsx`
- Modify: `notes-frontend/__tests__/editor.tiptap.spec.tsx`

**Interfaces:**
- Produces: `PersistenceState = 'pending' | 'ready' | 'unavailable'`；`canApplyApiSeed({ persistenceState, hasLocalContent, equivalent })`。
- Constraint: `pending` 时禁止 API seed；非空本地 doc 只有内容等价的 legacy 迁移可写入。

- [ ] **Step 1: 写真实 remount 恢复失败测试**

```tsx
it('离线内容恢复前不应用较新的 API HTML', async () => {
  seedIndexedDbYDoc(room, '<p>离线新内容</p>')
  const view = render(<TiptapEditor initialContent="<p>旧 API 内容</p>" />)
  expect(setContent).not.toHaveBeenCalled()
  resolveIndexedDbSync()
  await screen.findByText('离线新内容')
  expect(readYDoc()).toContain('离线新内容')
})
```

覆盖 `pending`、`ready+empty`、`ready+non-empty`、`unavailable` 和 legacy 等价迁移五种状态。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm.cmd exec -- jest --runInBand __tests__/editor-persistence-recovery.spec.tsx __tests__/editor.tiptap.spec.tsx`

Expected: API seed 在 `idbSynced` 前执行，测试 FAIL。

- [ ] **Step 3: 返回显式持久化三态**

```ts
export type PersistenceState = 'pending' | 'ready' | 'unavailable'

export function useTiptapPersistence(room: string, ydoc: Y.Doc) {
  const [state, setState] = useState<PersistenceState>('pending')
  // preflight/whenSynced 分别进入 unavailable/ready
  return { persistenceState: state }
}
```

在 `TiptapEditor` 中把 seed effect 改为等待非 pending；`ready` 且 Y.Doc 非空时不应用 API HTML。保存成功记录精确内容 hash 到 Y.Doc meta，hash 不一致时保留本地内容并使用统一冲突 Toast，不静默覆盖。

- [ ] **Step 4: 运行恢复、Markdown、只读测试**

Run: `npm.cmd exec -- jest --runInBand __tests__/editor-persistence-recovery.spec.tsx __tests__/editor.tiptap.spec.tsx __tests__/editor-unified-input.spec.tsx __tests__/readonly-leaf-guards.spec.tsx`

Expected: PASS；reader 的 Y.Doc 编码前后完全一致。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/components/editor/useTiptapPersistence.ts notes-frontend/src/components/editor/TiptapEditor.tsx notes-frontend/__tests__/editor-persistence-recovery.spec.tsx notes-frontend/__tests__/editor.tiptap.spec.tsx
git commit -m "fix(editor): 保护离线协作文档恢复"
```

---

### Task 3: 协作、AI 与 Toast 可靠交互

**Files:**
- Modify: `notes-frontend/src/components/editor/useTiptapCollab.ts`
- Modify: `notes-frontend/src/components/ai/ChatWindow.tsx`
- Modify: `notes-frontend/src/lib/app-toast.tsx`
- Modify: `notes-frontend/src/components/ui/AppToaster.tsx`
- Test: `notes-frontend/__tests__/editor.tiptap.auth.spec.tsx`
- Test: `notes-frontend/__tests__/ai-chat-window.spec.tsx`
- Test: `notes-frontend/__tests__/app-toast.spec.tsx`

**Interfaces:**
- Produces: `refreshConnection(): Promise<void>` 每次获取新 room ticket 并替换 provider；AI `requestId` 单飞；Toast dismiss 生命周期回调。

- [ ] **Step 1: 写三组失败回归**

```tsx
it('ticket 过期后重新取票并只保留新 provider', async () => {
  mockGetRoomTicket
    .mockResolvedValueOnce({ ticket: 'ticket-1', role: 'writer', expiresIn: 1 })
    .mockResolvedValueOnce({ ticket: 'ticket-2', role: 'writer', expiresIn: 300 })
  render(<CollabHarness />)
  providers[0].emit('connection-close', { code: 4401, reason: 'expired' })
  await user.click(screen.getByRole('button', { name: '重新连接' }))
  expect(mockGetRoomTicket).toHaveBeenCalledTimes(2)
  expect(providers[0].destroy).toHaveBeenCalled()
  expect(providers[1].params.access_token).toBe('ticket-2')
})

it('连续点击 AI 重试只产生一个请求', async () => {
  render(<ChatWindow isOpen onClose={jest.fn()} />)
  await failInitialRequest(user)
  const retry = screen.getByRole('button', { name: '重试生成' })
  await Promise.all([user.click(retry), user.click(retry)])
  expect(fetch).toHaveBeenCalledTimes(2) // 初次失败一次，重试只允许一次
})

it('关闭 Toast 后焦点返回触发按钮并从 FIFO 移除', async () => {
  trigger.focus()
  appToast.error({ id: 'save:n1', title: '保存失败', persistent: true })
  await user.click(screen.getByRole('button', { name: '关闭提示' }))
  expect(trigger).toHaveFocus()
  expect(getActiveToastIds()).not.toContain('save:n1')
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm.cmd exec -- jest --runInBand __tests__/editor.tiptap.auth.spec.tsx __tests__/ai-chat-window.spec.tsx __tests__/app-toast.spec.tsx`

Expected: 旧 ticket 被复用、AI retry 并发、焦点落到 body。

- [ ] **Step 3: 最小实现可靠状态机**

协作重连流程固定为：销毁旧 provider/listener → dismiss 旧 Toast → `getRoomTicket(noteId)` → 创建新 provider → connected 后清理错误。旧 provider 事件通过 generation token 忽略。

AI 使用同步 ref 拦截：

```ts
if (inFlightRef.current) return inFlightRef.current
const requestId = crypto.randomUUID()
inFlightRef.current = runRequest(requestId, userMessage)
return inFlightRef.current.finally(() => { inFlightRef.current = null })
```

Toast registry 在 dismiss、timeout 和 ID reuse 时更新队列；关闭时聚焦下一条可操作 Toast，否则返回记录的触发元素。

- [ ] **Step 4: 运行聚焦测试**

Run: `npm.cmd exec -- jest --runInBand __tests__/editor.tiptap.auth.spec.tsx __tests__/ai-chat-window.spec.tsx __tests__/app-toast.spec.tsx`

Expected: PASS，无 dangling timer/open handle。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/components/editor/useTiptapCollab.ts notes-frontend/src/components/ai/ChatWindow.tsx notes-frontend/src/lib/app-toast.tsx notes-frontend/src/components/ui/AppToaster.tsx notes-frontend/__tests__/editor.tiptap.auth.spec.tsx notes-frontend/__tests__/ai-chat-window.spec.tsx notes-frontend/__tests__/app-toast.spec.tsx
git commit -m "fix(ui): 统一失败重试与焦点恢复"
```

---

### Task 4: 全局 token 与基础组件

**Files:**
- Create: `notes-frontend/src/styles/product-tokens.css`
- Create: `notes-frontend/src/components/ui/icon-button.tsx`
- Create: `notes-frontend/src/components/layout/PageSurface.tsx`
- Modify: `notes-frontend/src/app/globals.css`
- Modify: `notes-frontend/src/app/layout.tsx`
- Modify: `notes-frontend/src/components/ui/button.tsx`
- Modify: `notes-frontend/src/components/ui/input.tsx`
- Modify: `notes-frontend/src/components/ui/textarea.tsx`
- Modify: `notes-frontend/src/components/ui/card.tsx`
- Modify: `notes-frontend/src/components/ui/dialog.tsx`
- Test: `notes-frontend/__tests__/design-system-contract.spec.tsx`

**Interfaces:**
- Produces: `--ui-*` 语义 token；`IconButton({ label, tooltip, icon })`；`PageSurface({ width, children })`。

- [ ] **Step 1: 写 token 和组件契约测试**

```tsx
expect(productTokens).toContain('--ui-color-accent: #2468f2')
expect(screen.getByRole('button', { name: '评论' })).toHaveStyle({ minWidth: '44px' })
expect(document.querySelector('[data-ui="page-surface"]')).toBeInTheDocument()
```

测试同时扫描基础组件，拒绝新增 `linear-gradient`、hover scale 和未映射 raw hex。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm.cmd exec -- jest --runInBand __tests__/design-system-contract.spec.tsx`

Expected: token 文件和组件不存在。

- [ ] **Step 3: 建立唯一 token 与无状态基础组件**

```css
:root {
  --ui-color-canvas: #f6f8fb;
  --ui-color-surface: #ffffff;
  --ui-color-text: #172033;
  --ui-color-muted: #667085;
  --ui-color-border: #e3e8f0;
  --ui-color-accent: #2468f2;
  --ui-radius-control: 8px;
  --ui-radius-panel: 12px;
  --ui-control-height: 44px;
  --ui-motion-fast: 160ms;
}
```

`Button`/`Card` 删除 React hover/focus state 和大幅 translate/scale，改用 class、`:hover`、`:focus-visible` 与 token。保留现有 public props，避免业务页全量改写。

- [ ] **Step 4: 运行组件与主题测试**

Run: `npm.cmd exec -- jest --runInBand __tests__/design-system-contract.spec.tsx __tests__/responsive-editor-ui.spec.tsx`

Expected: PASS；375/768/1024/1440 token 断点无水平页面滚动契约。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/styles/product-tokens.css notes-frontend/src/components/ui notes-frontend/src/components/layout/PageSurface.tsx notes-frontend/src/app/globals.css notes-frontend/src/app/layout.tsx notes-frontend/__tests__/design-system-contract.spec.tsx
git commit -m "refactor(ui): 统一全局设计基础"
```

---

### Task 5: Dashboard AppShell 统一

**Files:**
- Create: `notes-frontend/src/components/layout/AppShell.tsx`
- Modify: `notes-frontend/src/app/dashboard/layout.tsx`
- Modify: `notes-frontend/src/components/dashboard/dashboard-navigation.tsx`
- Modify: `notes-frontend/src/components/security/NetworkStatus.tsx`
- Modify: `notes-frontend/src/components/ai/AIPet.tsx`
- Create: `notes-frontend/__tests__/app-shell-visual-contract.spec.tsx`
- Modify: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`

**Interfaces:**
- Produces: `AppShell({ pathname, user, unreadCount, children })`；共享左栏折叠和窄屏 overlay 行为。

- [ ] **Step 1: 写真实壳层失败测试**

```tsx
render(<DashboardLayout><div>页面内容</div></DashboardLayout>)
expect(screen.getByRole('navigation', { name: '主导航' })).toBeVisible()
expect(screen.queryByText(/API 正常|触发同步|ms/)).not.toBeInTheDocument()
expect(screen.getByRole('main')).toContainElement(screen.getByText('页面内容'))
```

增加 1023px overlay、桌面折叠记忆、AI/Toast 不重叠断言。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm.cmd exec -- jest --runInBand __tests__/app-shell-visual-contract.spec.tsx __tests__/responsive-editor-ui.spec.tsx`

Expected: 旧 NetworkStatus 文案和双层 surface 仍存在。

- [ ] **Step 3: 提取 AppShell 并瘦身顶部栏**

顶部栏仅保留折叠、面包屑、搜索、通知、主题和账户。`NetworkStatus` 改为非视觉诊断服务或只在真正离线时提供用户可理解的 Toast，不常驻渲染延迟。主内容默认无厚重大卡片，由页面选择 `PageSurface`。

- [ ] **Step 4: 运行壳层与路由测试**

Run: `npm.cmd exec -- jest --runInBand __tests__/app-shell-visual-contract.spec.tsx __tests__/responsive-editor-ui.spec.tsx`

Expected: PASS；侧栏收起后主内容获得宽度，恢复按钮在左侧轨道内。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/components/layout/AppShell.tsx notes-frontend/src/app/dashboard/layout.tsx notes-frontend/src/components/dashboard/dashboard-navigation.tsx notes-frontend/src/components/security/NetworkStatus.tsx notes-frontend/src/components/ai/AIPet.tsx notes-frontend/__tests__/app-shell-visual-contract.spec.tsx notes-frontend/__tests__/responsive-editor-ui.spec.tsx
git commit -m "feat(ui): 统一工作台页面壳层"
```

---

### Task 6: 完整编辑器三栏与统一保存模型

**Files:**
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorHeader.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorMetadataPanel.tsx`
- Modify: `notes-frontend/src/components/editor/TiptapEditor.tsx`
- Modify: `notes-frontend/src/components/editor/TiptapToolbar.tsx`
- Modify: `notes-frontend/src/components/editor/useNoteSave.ts`
- Modify: `notes-frontend/src/components/editor/useEditorLayoutPreferences.ts`
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Test: `notes-frontend/__tests__/editor-shell.spec.tsx`
- Test: `notes-frontend/__tests__/editor.tiptap.spec.tsx`
- Test: `notes-frontend/__tests__/readonly-controls.spec.tsx`

**Interfaces:**
- Produces: `EditorSnapshot { title, content, visibility, categoryId, categoryIds, tagIds, status }`，整体进入 Task 1 队列。
- Constraint: `NoteEditorHeader` 使用受控 `title`；右栏负责目录、协作者摘要和属性；只读时所有 setter fail-closed。

- [ ] **Step 1: 写结构、metadata-only 和禁止诊断 UI 的失败测试**

```tsx
expect(screen.getByRole('complementary', { name: '笔记属性' })).toBeVisible()
expect(screen.queryByText(/ws\[|sync\[|连接状态/)).not.toBeInTheDocument()
expect(screen.queryByRole('button', { name: /^保存/ })).not.toBeInTheDocument()
await user.selectOptions(screen.getByLabelText('可见性'), 'private')
await advanceDebounce()
expect(updateNote).toHaveBeenCalledWith(id, expect.objectContaining({ visibility: 'private' }))
```

增加 title-only、category-only、tag-only、reader 强制触发 handler 仍零写入。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm.cmd exec -- jest --runInBand __tests__/editor-shell.spec.tsx __tests__/editor.tiptap.spec.tsx __tests__/readonly-controls.spec.tsx`

Expected: 诊断条/保存按钮仍存在，metadata 不进入自动保存。

- [ ] **Step 3: 合并保存快照并落地三栏**

```ts
type EditorSnapshot = Pick<UpdateNoteDto,
  'title' | 'content' | 'visibility' | 'categoryId' | 'categoryIds' | 'tags' | 'status'
>
```

移除 `editorMode`/`onModeChange` 死接口；标题改受控输入。将可见性、分类、标签放入右栏，正文区仅保留标题、保存状态、工具栏和纸张。删除 `TiptapEditor` 的诊断字符串、常驻重连/保存，以及 `TiptapToolbar` 的保存按钮。

布局偏好分别保存 `leftExplicit`/`rightExplicit`；拖动宽度只更新 `leftWidth`，不得标记右栏状态为显式。拖拽结束、pointercancel 和 Escape 安全释放 pointer capture。

- [ ] **Step 4: 运行编辑器完整聚焦测试**

Run: `npm.cmd exec -- jest --runInBand __tests__/editor-shell.spec.tsx __tests__/editor.tiptap.spec.tsx __tests__/readonly-controls.spec.tsx __tests__/readonly-leaf-guards.spec.tsx __tests__/responsive-editor-ui.spec.tsx __tests__/editor-auto-save.spec.tsx`

Expected: PASS；metadata-only 刷新后仍存在，reader 0 PUT/POST/PATCH/DELETE 和 0 Yjs mutation。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/components/editor notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__/editor-shell.spec.tsx notes-frontend/__tests__/editor.tiptap.spec.tsx notes-frontend/__tests__/readonly-controls.spec.tsx notes-frontend/__tests__/responsive-editor-ui.spec.tsx
git commit -m "feat(editor): 完整落地统一三栏界面"
```

---

### Task 7: 笔记列表与新建页主链路统一

**Files:**
- Modify: `notes-frontend/src/app/dashboard/notes/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/notes/new/page.tsx`
- Modify: `notes-frontend/src/app/dashboard/notes/new/useNewNotePage.ts`
- Modify: `notes-frontend/src/components/SearchFilterBar.tsx`
- Modify: `notes-frontend/src/components/ui/pagination.tsx`
- Create: `notes-frontend/__tests__/notes-primary-flow-ui.spec.tsx`

**Interfaces:**
- Consumes: Task 4 的 `PageSurface` 和基础组件；Task 5 的 `AppShell`。
- Produces: 列表、空状态、筛选、新建页统一页面结构。

- [ ] **Step 1: 写主链路失败测试**

```tsx
expect(screen.getByRole('heading', { name: '我的笔记' })).toBeVisible()
expect(screen.getByRole('searchbox')).toHaveAccessibleName('搜索笔记')
expect(screen.getByRole('link', { name: '新建笔记' })).toHaveAttribute('href', '/dashboard/notes/new')
expect(document.querySelectorAll('[data-ui="page-surface"]').length).toBe(1)
```

覆盖 loading、empty、error、分页和 375px 无横向滚动。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm.cmd exec -- jest --runInBand __tests__/notes-primary-flow-ui.spec.tsx`

Expected: 页面仍使用独立 raw hex、渐变标题或嵌套 Card。

- [ ] **Step 3: 迁移到统一页面组件**

保持现有 API、筛选和分页业务逻辑，只替换页面标题、操作区、表单、卡片和空状态的呈现。删除 `useNewNotePage` 中未消费的 `editorMode` state，新建内容始终进入统一 Tiptap。

- [ ] **Step 4: 运行主链路与既有业务测试**

Run: `npm.cmd exec -- jest --runInBand __tests__/notes-primary-flow-ui.spec.tsx __tests__/notes-pagination.spec.ts __tests__/note-tag-save.spec.ts __tests__/editor-unified-input.spec.tsx`

Expected: PASS，筛选参数和新建 payload 与改造前一致。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/app/dashboard/notes notes-frontend/src/components/SearchFilterBar.tsx notes-frontend/src/components/ui/pagination.tsx notes-frontend/__tests__/notes-primary-flow-ui.spec.tsx
git commit -m "feat(notes): 统一笔记主链路界面"
```

---

### Task 8: 剩余页面兼容扫描与停止线

**Files:**
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/knowledge-bases/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/categories/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/tags/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/settings/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/notifications/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/activity/page.tsx`
- Create: `docs/superpowers/reports/2026-08-11-ui-page-migration-register.md`
- Test: `notes-frontend/__tests__/dashboard-page-smoke.spec.tsx`

**Interfaces:**
- Produces: 每个剩余路由的 `PASS / BLOCKED / DEFERRED` 登记；本轮只修壳层迁移导致的可用性阻断。

- [ ] **Step 1: 为全部 Dashboard route 写 smoke 渲染表**

```ts
const routeFiles = [
  'src/app/dashboard/page.tsx',
  'src/app/dashboard/knowledge-bases/page.tsx',
  'src/app/dashboard/categories/page.tsx',
  'src/app/dashboard/tags/page.tsx',
  'src/app/dashboard/settings/page.tsx',
  'src/app/dashboard/notifications/page.tsx',
  'src/app/dashboard/activity/page.tsx',
]

it.each(routeFiles)('%s 不重复实现全局壳层', (file) => {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8')
  expect(source).not.toMatch(/<DashboardHeader|<DashboardSidebar|<main\b/)
  expect(source).not.toMatch(/min-w-\[(?:\d+)px\]/)
})
```

- [ ] **Step 2: 运行 smoke 并记录真实失败**

Run: `npm.cmd exec -- jest --runInBand __tests__/dashboard-page-smoke.spec.tsx`

Expected: 只把重复壳层、不可读、无法操作、页面横向溢出列为 BLOCKED；纯视觉差异列为 DEFERRED。

- [ ] **Step 3: 仅修复 BLOCKED 项**

允许的修复：移除重复 `PageSurface`、替换失效 token、修复 overflow、补可访问名称。禁止重排业务信息架构或顺手重做图表/表单。

- [ ] **Step 4: 更新迁移登记并复测**

Run: `npm.cmd exec -- jest --runInBand __tests__/dashboard-page-smoke.spec.tsx`

Expected: BLOCKED 为 0；DEFERRED 保留后续页面清单。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/app/dashboard notes-frontend/__tests__/dashboard-page-smoke.spec.tsx docs/superpowers/reports/2026-08-11-ui-page-migration-register.md
git commit -m "fix(ui): 完成剩余页面壳层兼容"
```

---

### Task 9: 全量门禁与真实浏览器验收

**Files:**
- Create: `docs/superpowers/reports/2026-08-11-progressive-ui-unification-validation.md`
- Create: `docs/superpowers/reports/assets/2026-08-11-progressive-ui-unification/`
- Modify: `docs/superpowers/plans/2026-08-11-progressive-ui-unification.md`（只勾选真实完成步骤）

**Interfaces:**
- Produces: 可复核的自动化与浏览器证据；不修改产品代码，发现阻断项返回对应任务修复。

- [ ] **Step 1: 运行全量自动化门禁**

```powershell
cd notes-frontend
npm.cmd run lint
npm.cmd run type-check
npm.cmd run ci:test
npm.cmd run build
```

Expected: 四条命令全部 exit 0，报告记录 suite/test 数和 warning。

- [ ] **Step 2: 运行静态禁止项扫描**

```powershell
rg -n "ws\[|sync\[|API 正常|触发同步|aria-label=\"保存\"|>重连<" notes-frontend/src
git diff --check
```

Expected: 产品 UI 无禁止项；允许的测试/日志命中在报告中逐条解释。

- [ ] **Step 3: 启动真实分支服务并完成桌面/窄屏验收**

使用两个隔离浏览器 session，在 1440×900、1024×900、768×900、375×812 验证：全局壳层、左右栏、标题/属性/正文自动保存、只读零写、Toast 焦点、AI retry 单飞、无水平溢出。截图必须裁去浏览器账号区并检查无密码、Cookie、Authorization、token。

- [ ] **Step 4: 完成数据安全浏览器场景**

至少验证：连续编辑只串行 PUT、离线编辑后关闭/重开不被旧 API 覆盖、过期 ticket 获取新 ticket、metadata-only 刷新保持。无法可信执行的外部 AI live、双端同步或移动真机标记 `UNVERIFIED`。

- [ ] **Step 5: 对照确认稿做真实页面审查**

逐项记录：旧壳层是否消失、右侧目录/协作者/属性是否存在、诊断和常驻保存/重连是否消失、Lucide/Tooltip/44px/焦点是否符合规格。不能用静态 mockup 截图替代。

- [ ] **Step 6: 写报告、勾选计划并提交**

```powershell
git add docs/superpowers/reports docs/superpowers/plans/2026-08-11-progressive-ui-unification.md
git commit -m "test(ui): 完成渐进式界面统一验收"
```

- [ ] **Step 7: 最终整分支审查**

审查范围从本轮基线到 HEAD。若存在 Critical/Important，集中一次修复并进行一次 scoped re-review；Minor 登记后停止，不开启无限优化循环。

---

## Execution Order and Gates

1. Task 1–3 为数据与交互安全门禁，可在互不修改相同文件时并行；Task 1–2 均通过后才允许 Task 4。
2. Task 4 完成后依次执行 Task 5、Task 6、Task 7。
3. Task 8 只做兼容扫描，不扩大剩余页面设计范围。
4. Task 9 只验收；任何产品代码修改必须回到对应任务并重新审查。

## Stop Conditions

- 阶段 0 仍存在数据覆盖风险：停止 UI 扩张。
- 基础组件导致三个以上不同类型业务回归：停止页面迁移，先稳定组件契约。
- 编辑器与笔记主链路通过后，其余页面仅剩非阻断视觉差异：本轮结束，登记后续迁移，不继续追求全站像素级统一。
