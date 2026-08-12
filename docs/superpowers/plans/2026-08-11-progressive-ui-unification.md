# 在线笔记渐进式 UI 统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先修复内容覆盖风险并统一全局设计基础、Dashboard 壳层、编辑器和笔记主链路，再以同一 Calm Minimal 语言分批整改全部业务页面。

**Architecture:** 使用“数据安全前置门禁 → 全局 token/基础组件 → AppShell → 编辑器/笔记主链路 → 业务域分批迁移 → 最终浏览器验收”的渐进迁移。全站共享一套语义 token 和基础组件；业务页面只调整结构与呈现，不改现有业务语义。

**执行基线（2026-08-12）：** Task 1–10 的编辑器整改、可靠性修复和验收成果已合入 `f24e714`。后续任务必须基于该提交继续，不得重复实现编辑器 Toast、自动保存、面板布局、统一 Tiptap 或只读边界。

**Tech Stack:** Next.js 16、React 18、TypeScript、Tailwind CSS 3、Tiptap 2、Yjs/y-indexeddb/y-websocket、Lucide React、Jest/Testing Library、agent-browser。

## Global Constraints

- 视觉采用浅色、蓝灰中性色、内容优先、克制阴影；禁止墨绿主视觉、紫色渐变和大面积装饰效果。
- 图标唯一来源为 `lucide-react`；图标按钮必须有 `aria-label` 与 Tooltip，移动端点击区域至少 44×44px。
- 产品 UI 不显示 `ws[...]`、`sync[...]`、API 延迟或常驻“保存/重连/触发同步”。
- 自动保存、离线恢复、只读边界和 room ticket 刷新必须在视觉迁移前通过回归测试。
- 不引入新的大型 UI 组件库，不重做业务页面的信息架构。
- 分批实施时只运行受影响的聚焦测试、`type-check` 或必要 lint；全部页面完成后再统一执行一次全量门禁。
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
- `notes-frontend/src/components/editor/editor-save-types.ts`：正文与 metadata 共用的保存快照契约。
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
- Create: `notes-frontend/src/components/editor/editor-save-types.ts`
- Modify: `notes-frontend/src/components/editor/useEditorAutoSave.ts`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/__tests__/editor-auto-save.spec.tsx`

**Interfaces:**
- Consumes: `EditorSnapshot`、`save(snapshot: EditorSnapshot): Promise<void>`，现有 `SaveState`。
- Produces: 同一 note 同时最多一个写请求；运行期间只保留最新 pending snapshot；`saveNow()` 返回当前 drain promise；`lastSavedSnapshot` 只在对应请求成功后更新为该请求的精确快照。

唯一保存契约在本任务定义，后续任务不得另造 positional 参数：

```ts
export type EditorSnapshot = {
  title: string
  content: string
  visibility?: UpdateNoteDto['visibility']
  categoryId?: string
  categoryIds?: string[]
  tags: string[]
  status?: UpdateNoteDto['status']
}
```

- [ ] **Step 1: 写逆序覆盖与同 key 回退的失败测试**

```tsx
it('串行保存并让服务器最终停留在最新快照', async () => {
  const first = deferred<void>()
  let active = 0
  let maxActive = 0
  const save = jest.fn()
    .mockImplementationOnce(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await first.promise
      active -= 1
    })
    .mockImplementationOnce(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      active -= 1
    })
  const { rerender } = render(<Harness title="A" content="0" save={save} />)
  rerender(<Harness title="A" content="1" save={save} />)
  await advanceDebounce()
  expect(save).toHaveBeenNthCalledWith(1, expect.objectContaining({ title: 'A', content: '1' }))

  rerender(<Harness title="A" content="2" save={save} />)
  await advanceDebounce()
  expect(save).toHaveBeenCalledTimes(1)

  first.resolve()
  await flushPromises()
  expect(save).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: 'A', content: '2' }))
  expect(maxActive).toBe(1)
})
```

同时增加“内容 A → B → A，第一次 A 失败时仍能重试最后 A”和“请求进行中 `saveNow` 不产生并发”的断言。

- [ ] **Step 2: 运行测试确认 RED**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/editor-save-queue.spec.tsx __tests__/editor-auto-save.spec.tsx`

Expected: 逆序场景 FAIL，现实现出现两个并发 `save`。

- [ ] **Step 3: 实现单消费者 drain 队列**

```ts
type SaveQueue = {
  running: Promise<void> | null
  pending: { noteId: string; key: string; payload: EditorSnapshot } | null
  lastSavedKey: string
}

const enqueue = (snapshot: SaveSnapshot) => {
  queueRef.current.pending = snapshot
  if (!queueRef.current.running) queueRef.current.running = drain()
  return queueRef.current.running
}
```

`useEditorAutoSave` 的 options 改为 `{ noteId, snapshot, enabled, save, delayMs }`，返回 `{ state, saveNow, retry, lastSavedSnapshot }`。`drain()` 每轮取走 pending；请求运行期间新输入只替换 pending。完成后若 pending 与成功快照不同，继续下一轮。失败保留最新 pending，并让 Toast action 再次调用 `enqueue(latest)`。切换 note、readOnly 或 unmount 时令旧队列失去 UI 回写资格，但不得把旧 promise 误复用于新快照。`NoteEditorShell` 在本任务只按当前已有 note 字段构造 snapshot，不改变 metadata UI。

- [ ] **Step 4: 运行聚焦测试**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/editor-save-queue.spec.tsx __tests__/editor-auto-save.spec.tsx`

Expected: PASS，且测试显式断言任意时刻 `activeRequests <= 1`。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/components/editor/editor-save-types.ts notes-frontend/src/components/editor/useEditorAutoSave.ts notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/__tests__/editor-save-queue.spec.tsx notes-frontend/__tests__/editor-auto-save.spec.tsx
git commit -m "fix(editor): 串行保存最新内容"
```

---

### Task 2: IndexedDB/Yjs/API seed 安全恢复

**Files:**
- Create: `notes-frontend/__tests__/editor-persistence-recovery.spec.tsx`
- Modify: `notes-frontend/src/components/editor/useTiptapPersistence.ts`
- Modify: `notes-frontend/src/components/editor/TiptapEditor.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/__tests__/editor.tiptap.spec.tsx`
- Modify: `notes-frontend/package.json`
- Modify: `notes-frontend/package-lock.json`

**Interfaces:**
- Produces: `PersistenceState = 'pending' | 'ready' | 'unavailable'`；`canApplyApiSeed({ persistenceState, hasLocalContent, equivalent })`。
- Constraint: `pending` 时禁止 API seed；非空本地 doc 只有内容等价的 legacy 迁移可写入。

- [ ] **Step 1: 写真实 remount 恢复失败测试**

Run from `notes-frontend`: `npm.cmd install --save-dev fake-indexeddb`

Expected: `package.json` 与 `package-lock.json` 只新增该测试依赖；依赖安装成功后才编写并运行 RED，避免用“模块不存在”冒充行为失败。

```tsx
it('离线内容恢复前不应用较新的 API HTML', async () => {
  const firstDoc = new Y.Doc()
  const firstPersistence = new IndexeddbPersistence(`online-notes:${room}`, firstDoc)
  await firstPersistence.whenSynced
  const paragraph = new Y.XmlElement('paragraph')
  paragraph.insert(0, [new Y.XmlText('离线新内容')])
  firstDoc.getXmlFragment('prosemirror').insert(0, [paragraph])
  await waitForIndexedDbWrite()
  const before = Y.encodeStateAsUpdate(firstDoc)
  await firstPersistence.destroy()
  firstDoc.destroy()

  const view = render(
    <TiptapEditor
      noteId="n1"
      user={{ id: 'u1', name: 'user1' }}
      initialHTML="<p>旧 API 内容</p>"
      readOnly={false}
      onSave={jest.fn().mockResolvedValue(undefined)}
    />,
  )
  await screen.findByText('离线新内容')
  await act(async () => { jest.advanceTimersByTime(801); await flushPromises() })
  expect(screen.queryByText('旧 API 内容')).not.toBeInTheDocument()
  view.unmount()
  await flushPromises()

  const secondView = render(
    <TiptapEditor
      noteId="n1"
      user={{ id: 'u1', name: 'user1' }}
      initialHTML="<p>旧 API 内容</p>"
      readOnly={false}
      onSave={jest.fn().mockResolvedValue(undefined)}
    />,
  )
  await screen.findByText('离线新内容')
  await act(async () => { jest.advanceTimersByTime(801); await flushPromises() })
  expect(screen.queryByText('旧 API 内容')).not.toBeInTheDocument()
  secondView.unmount()
  await flushPromises()

  const verificationDoc = new Y.Doc()
  const verificationPersistence = new IndexeddbPersistence(`online-notes:${room}`, verificationDoc)
  await verificationPersistence.whenSynced
  expect(Y.encodeStateAsUpdate(verificationDoc)).toEqual(before)
  await verificationPersistence.destroy()
  verificationDoc.destroy()
})
```

测试使用 dev dependency `fake-indexeddb`，并提供 `waitForIndexedDbWrite` 测试 helper。用同一个正常编辑 room `note:n1` 的第三个 verification doc 读取持久化结果，不暴露生产代码内部 Y.Doc。分别覆盖 `pending` 禁止 seed、`ready+empty` 允许 seed、`ready+non-empty` 保留本地、`unavailable` 允许 API fallback、legacy 等价迁移五种状态；每个测试都必须断言 editor HTML 与 `Y.encodeStateAsUpdate`。

- [ ] **Step 2: 运行测试确认 RED**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/editor-persistence-recovery.spec.tsx __tests__/editor.tiptap.spec.tsx`

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

在 `TiptapEditor` 中把 seed effect 改为等待非 pending；`ready` 且 Y.Doc 非空时不应用 API HTML。新增 `savedContentHash?: string` prop，由 `NoteEditorShell` 对 Task 1 的 `lastSavedSnapshot.content` 计算稳定 hash 后传入；仅该值变化时写入 Y.Doc meta。hash 不一致时保留本地内容并使用统一冲突 Toast，不静默覆盖，不能用 React 当前渲染内容猜测保存版本。

- [ ] **Step 4: 运行恢复、Markdown、只读测试**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/editor-persistence-recovery.spec.tsx __tests__/editor.tiptap.spec.tsx __tests__/editor-unified-input.spec.tsx __tests__/readonly-leaf-guards.spec.tsx`

Expected: PASS；reader 的 Y.Doc 编码前后完全一致。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/components/editor/useTiptapPersistence.ts notes-frontend/src/components/editor/TiptapEditor.tsx notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/__tests__/editor-persistence-recovery.spec.tsx notes-frontend/__tests__/editor.tiptap.spec.tsx notes-frontend/package.json notes-frontend/package-lock.json
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
  providers[1].emit('status', { status: 'connected' })
  providers[0].emit('status', { status: 'disconnected' })
  providers[0].emit('connection-close', { code: 4401, reason: 'expired' })
  providers[0].emit('sync', false)
  expect(screen.getByText('实时协作已连接')).toBeVisible()
})

it('连续点击 AI 重试只产生一个请求', async () => {
  render(<ChatWindow isOpen onClose={jest.fn()} />)
  await failInitialRequest(user)
  const retry = screen.getByRole('button', { name: '重试生成' })
  await Promise.all([user.click(retry), user.click(retry)])
  expect(fetch).toHaveBeenCalledTimes(2) // 初次失败一次，重试只允许一次
})

it('关闭 Toast 后焦点返回触发按钮并从 FIFO 移除', async () => {
  render(<AppToaster />)
  const trigger = document.createElement('button')
  trigger.textContent = '保存入口'
  document.body.appendChild(trigger)
  trigger.focus()
  appToast.error({ id: 'save:n1', title: '保存失败', persistent: true })
  await user.click(await screen.findByRole('button', { name: '关闭提示' }))
  expect(trigger).toHaveFocus()

  appToast.error({ id: 'a', title: 'A', persistent: true })
  appToast.error({ id: 'b', title: 'B', persistent: true })
  appToast.error({ id: 'c', title: 'C', persistent: true })
  appToast.dismiss('a')
  appToast.error({ id: 'a', title: 'A2', persistent: true })
  appToast.error({ id: 'd', title: 'D', persistent: true })
  await waitFor(() => expect(document.querySelector('[data-toast-id="a"]')).toBeInTheDocument())
  expect(document.querySelector('[data-toast-id="b"]')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/editor.tiptap.auth.spec.tsx __tests__/ai-chat-window.spec.tsx __tests__/app-toast.spec.tsx`

Expected: 旧 ticket 被复用、AI retry 并发、焦点落到 body。

- [ ] **Step 3: 最小实现可靠状态机**

协作重连流程固定为：销毁旧 provider/listener → dismiss 旧 Toast → `getRoomTicket(noteId)` → 创建新 provider → connected 后清理错误。旧 provider 事件通过 generation token 忽略。新增取票失败测试：一次用户 action 只发起一次取票，失败后停在 `auth-failed` 并保留同一个 Toast，不使用 timer 无限重试。

AI 使用同步 ref 拦截：

```ts
if (inFlightRef.current) return inFlightRef.current
const requestId = crypto.randomUUID()
inFlightRef.current = runRequest(requestId, userMessage)
return inFlightRef.current.finally(() => { inFlightRef.current = null })
```

Toast registry 在 dismiss、timeout 和 ID reuse 时更新队列；`AppToastCard` 暴露 `data-toast-id` 供测试与诊断，关闭时聚焦下一条可操作 Toast，否则返回记录的触发元素。

- [ ] **Step 4: 运行聚焦测试**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/editor.tiptap.auth.spec.tsx __tests__/ai-chat-window.spec.tsx __tests__/app-toast.spec.tsx`

Expected: PASS，无 dangling timer/open handle。随后运行阶段 0 只读门禁：

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/readonly-controls.spec.tsx __tests__/readonly-leaf-guards.spec.tsx __tests__/editor.tiptap.spec.tsx`

Expected: PASS；reader 正文、标题、metadata、评论、邀请和 programmatic command 全部零写入。若现有回归失败，只允许修改失败调用链上的权限 guard，并把对应文件追加到本任务 Files 与提交列表；不得等待视觉任务补救。

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
- Create: `notes-frontend/src/components/ui/select.tsx`
- Create: `notes-frontend/src/components/ui/drawer.tsx`
- Create: `notes-frontend/src/components/ui/tooltip.tsx`
- Create: `notes-frontend/src/components/ui/status-text.tsx`
- Create: `notes-frontend/src/components/layout/PageSurface.tsx`
- Modify: `notes-frontend/src/app/globals.css`
- Modify: `notes-frontend/src/app/layout.tsx`
- Modify: `notes-frontend/src/components/ui/button.tsx`
- Modify: `notes-frontend/src/components/ui/input.tsx`
- Modify: `notes-frontend/src/components/ui/textarea.tsx`
- Modify: `notes-frontend/src/components/ui/card.tsx`
- Modify: `notes-frontend/src/components/ui/dialog.tsx`
- Modify: `notes-frontend/src/components/ui/badge.tsx`
- Modify: `notes-frontend/src/components/ui/AppToaster.tsx`
- Create: `notes-frontend/__tests__/design-system-contract.spec.tsx`

**Interfaces:**
- Produces: `--ui-*` 语义 token；`IconButton({ label, tooltip, icon })`；`Tooltip({ content, children })`；`Select`；基于现有 Radix Dialog 的 `Drawer`；`StatusText({ tone, children })`；`PageSurface({ width, children })`。

- [ ] **Step 1: 写 token 和组件契约测试**

```tsx
expect(productTokens).toContain('--ui-color-accent: #2468f2')
expect(screen.getByRole('button', { name: '评论' })).toHaveStyle({ minWidth: '44px' })
expect(document.querySelector('[data-ui="page-surface"]')).toBeInTheDocument()
expect(contrast(token('--ui-color-text'), token('--ui-color-surface'))).toBeGreaterThanOrEqual(4.5)
expect(productTokens).toMatch(/prefers-reduced-motion:[\s\S]*--ui-motion-fast:\s*0ms/)
```

测试同时扫描全部基础组件，拒绝新增 `linear-gradient`、hover scale 和未映射 raw hex，并 render Select/Drawer/Badge/StatusText/Tooltip/Toast 验证 focus-visible、可访问名称与语义色。

- [ ] **Step 2: 运行测试确认 RED**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/design-system-contract.spec.tsx`

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

`product-tokens.css` 明确定义：

```css
@media (prefers-reduced-motion: reduce) {
  :root { --ui-motion-fast: 0ms; --ui-motion-normal: 0ms; }
  *, *::before, *::after { scroll-behavior: auto !important; }
}
```

`Drawer` 只封装现有 `@radix-ui/react-dialog` 的右侧/底部 surface，不引入依赖；`Tooltip` 统一替代业务组件直接调用 Tippy 的新增用法。

- [ ] **Step 4: 运行组件与主题测试**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/design-system-contract.spec.tsx __tests__/responsive-editor-ui.spec.tsx`

Expected: PASS；375/768/1024/1440 token 断点无水平页面滚动契约。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/styles/product-tokens.css notes-frontend/src/components/ui/icon-button.tsx notes-frontend/src/components/ui/select.tsx notes-frontend/src/components/ui/drawer.tsx notes-frontend/src/components/ui/tooltip.tsx notes-frontend/src/components/ui/status-text.tsx notes-frontend/src/components/ui/button.tsx notes-frontend/src/components/ui/input.tsx notes-frontend/src/components/ui/textarea.tsx notes-frontend/src/components/ui/card.tsx notes-frontend/src/components/ui/dialog.tsx notes-frontend/src/components/ui/badge.tsx notes-frontend/src/components/ui/AppToaster.tsx notes-frontend/src/components/layout/PageSurface.tsx notes-frontend/src/app/globals.css notes-frontend/src/app/layout.tsx notes-frontend/__tests__/design-system-contract.spec.tsx
git commit -m "refactor(ui): 统一全局设计基础"
```

---

### Task 5: Dashboard AppShell 统一

**Files:**
- Create: `notes-frontend/src/components/layout/AppShell.tsx`
- Create: `notes-frontend/src/components/layout/useAppShellPreferences.ts`
- Modify: `notes-frontend/src/app/dashboard/layout.tsx`
- Modify: `notes-frontend/src/components/dashboard/dashboard-navigation.tsx`
- Modify: `notes-frontend/src/components/security/NetworkStatus.tsx`
- Modify: `notes-frontend/src/components/ai/AIPet.tsx`
- Create: `notes-frontend/__tests__/app-shell-visual-contract.spec.tsx`
- Create: `notes-frontend/__tests__/app-shell-preferences.spec.tsx`
- Modify: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`

**Interfaces:**
- Produces: `AppShell({ pathname, user, unreadCount, children })`；`AppShellContext { sidebarCollapsed, sidebarWidth, toggleSidebar, setSidebarWidth }`。
- Ownership: 全局左导航、宽度、折叠和恢复按钮只归 `AppShell`；编辑器不得渲染第二套左导航或保存左栏状态。`notes:app-shell-layout:v1` 仅保存 `{ sidebarWidth, sidebarCollapsed, sidebarExplicit }`，不包含右侧编辑器状态。
- Exception: `isShellExemptRoute('/dashboard/mindmaps/:id/embed')` 返回 true 时只渲染沉浸式 children；这是唯一壳层豁免并由 Task 9 登记。

- [ ] **Step 1: 写真实壳层失败测试**

```tsx
render(<DashboardLayout><div>页面内容</div></DashboardLayout>)
expect(screen.getByRole('navigation', { name: '主导航' })).toBeVisible()
expect(screen.queryByText(/API 正常|触发同步|ms/)).not.toBeInTheDocument()
expect(screen.getByRole('main')).toContainElement(screen.getByText('页面内容'))
```

增加 1023px overlay、桌面折叠记忆、左栏 220–360px 拖宽、拖宽不改变折叠显式意图、移动端重开采用 overlay 默认值、AI/Toast 不重叠断言。
增加 embed 路由只出现沉浸式内容、不出现主导航的断言；其他 `/dashboard/*` 必须恰好一个主导航。

- [ ] **Step 2: 运行测试确认 RED**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/app-shell-visual-contract.spec.tsx __tests__/responsive-editor-ui.spec.tsx`

Expected: 旧 NetworkStatus 文案和双层 surface 仍存在。

- [ ] **Step 3: 提取 AppShell 并瘦身顶部栏**

顶部栏仅保留折叠、面包屑、搜索、通知、主题和账户。`NetworkStatus` 改为非视觉诊断服务或只在真正离线时提供用户可理解的 Toast，不常驻渲染延迟。主内容默认无厚重大卡片，由页面选择 `PageSurface`。左栏折叠后宽度为 0，恢复入口位于顶部栏左侧，不保留第二条 52px 轨道。

- [ ] **Step 4: 运行壳层与路由测试**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/app-shell-visual-contract.spec.tsx __tests__/app-shell-preferences.spec.tsx __tests__/responsive-editor-ui.spec.tsx`

Expected: PASS；侧栏收起后主内容获得宽度，恢复按钮位于顶部栏左侧，不存在 52px 左侧恢复轨道。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/components/layout/AppShell.tsx notes-frontend/src/components/layout/useAppShellPreferences.ts notes-frontend/src/app/dashboard/layout.tsx notes-frontend/src/components/dashboard/dashboard-navigation.tsx notes-frontend/src/components/security/NetworkStatus.tsx notes-frontend/src/components/ai/AIPet.tsx notes-frontend/__tests__/app-shell-visual-contract.spec.tsx notes-frontend/__tests__/app-shell-preferences.spec.tsx notes-frontend/__tests__/responsive-editor-ui.spec.tsx
git commit -m "feat(ui): 统一工作台页面壳层"
```

---

### Task 6: 标题与 metadata 接入统一保存模型

**Files:**
- Create: `notes-frontend/__tests__/editor-snapshot-save.spec.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorHeader.tsx`
- Modify: `notes-frontend/src/components/editor/useNoteSave.ts`
- Modify: `notes-frontend/__tests__/readonly-controls.spec.tsx`

**Interfaces:**
- Consumes: Task 1 的 `EditorSnapshot` 与 `useEditorAutoSave({ snapshot, save })`。
- Produces: `useNoteSave.saveSnapshot(snapshot: EditorSnapshot): Promise<void>`；标题、正文、visibility、categoryId、categoryIds、tags、status 使用同一个 debounce 和串行队列。
- Constraint: 本任务只连接业务数据，不移动页面区域、不修改三栏 CSS。

- [ ] **Step 1: 写 title-only、metadata-only 和合并快照失败测试**

```tsx
await user.clear(screen.getByLabelText('笔记标题'))
await user.type(screen.getByLabelText('笔记标题'), '新标题')
await user.selectOptions(screen.getByLabelText('可见性'), 'private')
await advanceDebounce()
expect(updateNote).toHaveBeenCalledTimes(1)
expect(updateNote).toHaveBeenLastCalledWith(id, expect.objectContaining({
  title: '新标题',
  visibility: 'private',
  content: expect.any(String),
  tags: expect.any(Array),
}))
```

分别覆盖 category-only、tag-only、正文+metadata 同一 debounce 合并、刷新后 payload 恢复，以及 reader 移除 DOM disabled 后强制触发仍零写入。

- [ ] **Step 2: 运行测试确认 RED**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/editor-snapshot-save.spec.tsx __tests__/editor-auto-save.spec.tsx __tests__/readonly-controls.spec.tsx`

Expected: Task 1 已迁移 snapshot API，但 metadata handler 仍直写或未进入统一 draft，表现为两次请求或 payload 缺少最新字段；对应断言 FAIL。

- [ ] **Step 3: 接入唯一 EditorSnapshot**

`useNoteSave` 删除 positional `save(title, content, status)`，改为把 `EditorSnapshot` 原样映射到 `updateNote`。`NoteEditorShell` 用受控标题输入和现有 metadata 控件构造一个 snapshot；任何字段变化只更新本地 draft，由 Task 1 队列统一保存。只读 guard 同时放在控件 handler 与 `saveSnapshot` 边界。

- [ ] **Step 4: 运行保存与只读聚焦测试**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/editor-snapshot-save.spec.tsx __tests__/editor-auto-save.spec.tsx __tests__/readonly-controls.spec.tsx __tests__/readonly-leaf-guards.spec.tsx`

Expected: PASS；同一 debounce 只发一个完整 `UpdateNoteDto`，reader 0 写请求。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/src/components/editor/NoteEditorHeader.tsx notes-frontend/src/components/editor/useNoteSave.ts notes-frontend/__tests__/editor-snapshot-save.spec.tsx notes-frontend/__tests__/readonly-controls.spec.tsx
git commit -m "fix(editor): 统一保存标题与笔记属性"
```

---

### Task 7: 完整编辑器三栏与右侧面板

**Files:**
- Create: `notes-frontend/src/components/editor/useEditorPanelPreferences.ts`
- Create: `notes-frontend/__tests__/editor-shell.spec.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorHeader.tsx`
- Modify: `notes-frontend/src/components/editor/NoteEditorMetadataPanel.tsx`
- Modify: `notes-frontend/src/components/editor/TiptapEditor.tsx`
- Modify: `notes-frontend/src/components/editor/TiptapToolbar.tsx`
- Delete: `notes-frontend/src/components/editor/useEditorLayoutPreferences.ts`
- Modify: `notes-frontend/src/styles/editor-tokens.css`
- Modify: `notes-frontend/__tests__/editor.tiptap.spec.tsx`
- Modify: `notes-frontend/__tests__/editor-layout-preferences.spec.tsx`
- Modify: `notes-frontend/__tests__/responsive-editor-ui.spec.tsx`

**Interfaces:**
- Consumes: Task 5 的唯一全局左导航；Task 6 已连接的受控标题与 metadata handler。
- Produces: `useEditorPanelPreferences() { rightCollapsed, rightExplicit, toggleRight }`，存储键 `notes:editor-panel:v1`。
- Ownership: 编辑器只渲染中间正文与右侧“目录/协作者/属性”，不得渲染或控制第二套左导航。

- [ ] **Step 1: 写三栏所有权和禁止诊断 UI 的失败测试**

```tsx
expect(screen.getAllByRole('navigation', { name: '主导航' })).toHaveLength(1)
expect(screen.queryByLabelText('左侧导航')).not.toBeInTheDocument()
expect(document.querySelector('#editor-left-navigation')).not.toBeInTheDocument()
expect(localStorage.getItem('notes:editor-layout:v1')).toBeNull()
expect(screen.getByRole('complementary', { name: '笔记属性' })).toBeVisible()
expect(screen.getByRole('heading', { name: '目录' })).toBeVisible()
expect(screen.getByRole('heading', { name: '协作者' })).toBeVisible()
expect(screen.queryByText(/ws\[|sync\[|连接状态/)).not.toBeInTheDocument()
expect(screen.queryByRole('button', { name: /^保存/ })).not.toBeInTheDocument()
expect(screen.queryByRole('button', { name: '重连' })).not.toBeInTheDocument()
```

`editor-layout-preferences.spec.tsx` 覆盖：AppShell 左宽拖动不写右栏偏好；右栏显式 toggle 独立持久化；1023px 默认收起；reload 恢复；pointercancel/Escape 释放 pointer capture。

- [ ] **Step 2: 运行测试确认 RED**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/editor-shell.spec.tsx __tests__/editor-layout-preferences.spec.tsx __tests__/editor.tiptap.spec.tsx __tests__/responsive-editor-ui.spec.tsx`

Expected: 当前 editor 内仍有左栏状态、诊断条和常驻保存/重连按钮。

- [ ] **Step 3: 移除双壳层并落地右侧面板**

删除 `NoteEditorShell` 内部左导航、左 resize 和恢复轨道，左侧完全交给 `AppShell`。`NoteEditorHeader` 删除 `leftCollapsed/onToggleLeft/editorMode/onModeChange`。右栏按“目录 → 协作者摘要 → 属性”排列，复用 Task 6 handler，不复制保存逻辑。删除 `TiptapEditor` 诊断字符串、常驻重连/保存，以及 `TiptapToolbar` 保存按钮；重连只由 Task 3 的 Toast action 提供。

- [ ] **Step 4: 统一编辑器 token 与右栏 responsive**

桌面中间轨道使用 `minmax(0, 1fr)`；右栏宽 240px，可收起为 0 并由编辑器头部右侧按钮恢复。1023px 以下右栏为 overlay，375px 不横向溢出。图标按钮桌面和移动端都使用 Task 4 的 44px `IconButton`。

- [ ] **Step 5: 运行视觉、保存和只读聚焦测试**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/editor-shell.spec.tsx __tests__/editor-layout-preferences.spec.tsx __tests__/editor.tiptap.spec.tsx __tests__/readonly-controls.spec.tsx __tests__/readonly-leaf-guards.spec.tsx __tests__/responsive-editor-ui.spec.tsx __tests__/editor-snapshot-save.spec.tsx`

Expected: PASS；真实组件树只有一个左导航，metadata-only 仍保存，reader 0 网络写入和 0 Yjs mutation。

- [ ] **Step 6: 审查并提交**

```powershell
git add notes-frontend/src/components/editor/useEditorPanelPreferences.ts notes-frontend/src/components/editor/NoteEditorShell.tsx notes-frontend/src/components/editor/NoteEditorHeader.tsx notes-frontend/src/components/editor/NoteEditorMetadataPanel.tsx notes-frontend/src/components/editor/TiptapEditor.tsx notes-frontend/src/components/editor/TiptapToolbar.tsx notes-frontend/src/styles/editor-tokens.css notes-frontend/__tests__/editor-shell.spec.tsx notes-frontend/__tests__/editor.tiptap.spec.tsx notes-frontend/__tests__/editor-layout-preferences.spec.tsx notes-frontend/__tests__/responsive-editor-ui.spec.tsx
git rm notes-frontend/src/components/editor/useEditorLayoutPreferences.ts
git commit -m "feat(editor): 完整落地统一三栏界面"
```

---

### Task 8: 笔记列表与新建页主链路统一

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

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/notes-primary-flow-ui.spec.tsx`

Expected: 页面仍使用独立 raw hex、渐变标题或嵌套 Card。

- [ ] **Step 3: 迁移到统一页面组件**

保持现有 API、筛选和分页业务逻辑，只替换页面标题、操作区、表单、卡片和空状态的呈现。删除 `useNewNotePage` 中未消费的 `editorMode` state，新建内容始终进入统一 Tiptap。

- [ ] **Step 4: 运行主链路与既有业务测试**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/notes-primary-flow-ui.spec.tsx __tests__/notes-pagination.spec.ts __tests__/note-tag-save.spec.ts __tests__/editor-unified-input.spec.tsx`

Expected: PASS，筛选参数和新建 payload 与改造前一致。

- [ ] **Step 5: 审查并提交**

```powershell
git add notes-frontend/src/app/dashboard/notes/page.tsx notes-frontend/src/app/dashboard/notes/new/page.tsx notes-frontend/src/app/dashboard/notes/new/useNewNotePage.ts notes-frontend/src/components/SearchFilterBar.tsx notes-frontend/src/components/ui/pagination.tsx notes-frontend/__tests__/notes-primary-flow-ui.spec.tsx
git commit -m "feat(notes): 统一笔记主链路界面"
```

---

### Task 9: 剩余页面兼容扫描与停止线

**Files:**
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/knowledge-bases/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/categories/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/tags/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/settings/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/notifications/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/activity/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/boards/[id]/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/mindmaps/[id]/embed/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/notes/[id]/versions/page.tsx`
- Modify only for verified BLOCKED items: `notes-frontend/src/app/dashboard/notes/[id]/edit/page.tsx`
- Create: `docs/superpowers/reports/2026-08-11-ui-page-migration-register.md`
- Create: `notes-frontend/__tests__/dashboard-page-smoke.spec.tsx`

**Interfaces:**
- Produces: 每个剩余路由的 `PASS / BLOCKED / DEFERRED` 登记；本轮只修壳层迁移导致的可用性阻断。

- [ ] **Step 1: 为全部 Dashboard route 写 smoke 渲染表**

```ts
const routeFiles = [
  'src/app/dashboard/page.tsx',
  'src/app/dashboard/notes/page.tsx',
  'src/app/dashboard/notes/new/page.tsx',
  'src/app/dashboard/notes/[id]/page.tsx',
  'src/app/dashboard/notes/[id]/edit/page.tsx',
  'src/app/dashboard/notes/[id]/versions/page.tsx',
  'src/app/dashboard/knowledge-bases/page.tsx',
  'src/app/dashboard/categories/page.tsx',
  'src/app/dashboard/tags/page.tsx',
  'src/app/dashboard/settings/page.tsx',
  'src/app/dashboard/notifications/page.tsx',
  'src/app/dashboard/activity/page.tsx',
  'src/app/dashboard/boards/[id]/page.tsx',
  'src/app/dashboard/mindmaps/[id]/page.tsx',
]

const shellExemptFiles = ['src/app/dashboard/mindmaps/[id]/embed/page.tsx']

it.each(routeFiles)('%s 不重复实现全局壳层', (file) => {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8')
  expect(source).not.toMatch(/<DashboardHeader|<DashboardSidebar|<main\b/)
  expect(source).not.toMatch(/min-w-\[(?:\d+)px\]/)
})

it.each(shellExemptFiles)('%s 明确登记为沉浸式嵌入路由', (file) => {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8')
  expect(source).toContain('data-shell-exempt="immersive-embed"')
})
```

- [ ] **Step 2: 运行 smoke 并记录真实失败**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/dashboard-page-smoke.spec.tsx`

Expected: 静态契约只证明没有重复壳层；它不作为可用性或 overflow 的通过证据。

- [ ] **Step 3: 对真实路由执行 1440/375 浏览器 smoke**

从 `rg --files notes-frontend/src/app/dashboard -g page.tsx` 生成报告清单，并与上述 routeFiles/shellExemptFiles 比较，缺一项即 FAIL。为动态路由创建一次性测试笔记、白板和思维导图数据；每个 URL 在 1440×900 与 375×812 下验证 HTTP 成功、页面主标题可见、首要操作可聚焦，以及 `document.documentElement.scrollWidth <= document.documentElement.clientWidth`。embed 路由按 `SHELL_EXEMPT` 验证沉浸式布局，其余路由必须位于唯一 AppShell 中。

- [ ] **Step 4: 仅修复 BLOCKED 项**

允许的修复：移除重复 `PageSurface`、替换失效 token、修复 overflow、补可访问名称。禁止重排业务信息架构或顺手重做图表/表单。

- [ ] **Step 5: 更新迁移登记并复测**

Run from `notes-frontend`: `npm.cmd exec -- jest --runInBand __tests__/dashboard-page-smoke.spec.tsx`

Expected: 静态测试 PASS，真实浏览器 BLOCKED 为 0；DEFERRED 保留后续页面清单。

- [ ] **Step 6: 审查并提交**

```powershell
git add notes-frontend/src/app/dashboard/page.tsx notes-frontend/src/app/dashboard/knowledge-bases/page.tsx notes-frontend/src/app/dashboard/categories/page.tsx notes-frontend/src/app/dashboard/tags/page.tsx notes-frontend/src/app/dashboard/settings/page.tsx notes-frontend/src/app/dashboard/notifications/page.tsx notes-frontend/src/app/dashboard/activity/page.tsx notes-frontend/src/app/dashboard/boards/[id]/page.tsx notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx notes-frontend/src/app/dashboard/mindmaps/[id]/embed/page.tsx notes-frontend/src/app/dashboard/notes/[id]/versions/page.tsx notes-frontend/src/app/dashboard/notes/[id]/edit/page.tsx notes-frontend/__tests__/dashboard-page-smoke.spec.tsx docs/superpowers/reports/2026-08-11-ui-page-migration-register.md
git commit -m "fix(ui): 完成剩余页面壳层兼容"
```

---

### Task 10: 全量门禁与真实浏览器验收

**Files:**
- Create: `docs/superpowers/reports/2026-08-11-progressive-ui-unification-validation.md`
- Create: `docs/superpowers/reports/assets/2026-08-11-progressive-ui-unification/`
- Modify: `docs/superpowers/plans/2026-08-11-progressive-ui-unification.md`（只勾选真实完成步骤）

**Interfaces:**
- Produces: 可复核的自动化与浏览器证据；不修改产品代码，发现阻断项返回对应任务修复。

- [ ] **Step 1: 运行全量自动化门禁**

```powershell
npm.cmd --prefix notes-frontend run lint
npm.cmd --prefix notes-frontend run type-check
npm.cmd --prefix notes-frontend run ci:test
npm.cmd --prefix notes-frontend run build
```

Expected: 四条命令全部 exit 0，报告记录 suite/test 数和 warning。

- [ ] **Step 2: 运行静态禁止项扫描**

以下命令从仓库根目录执行：

```powershell
rg -n "ws\[|sync\[|连接状态|API 正常|触发同步" notes-frontend/src/components/editor notes-frontend/src/components/dashboard notes-frontend/src/components/security
rg -n "aria-label=\"保存\"|>重连<" notes-frontend/src/components/editor
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

报告固定使用列：`commit | URL | 账号角色 | viewport | 前置数据 | 操作 | 网络/Yjs 断言 | 结果 | 脱敏截图 | UNVERIFIED 原因`。每个 PASS 必须能追溯到命令或浏览器 transcript。

```powershell
git add docs/superpowers/reports/2026-08-11-progressive-ui-unification-validation.md docs/superpowers/reports/assets/2026-08-11-progressive-ui-unification docs/superpowers/plans/2026-08-11-progressive-ui-unification.md
git commit -m "test(ui): 完成渐进式界面统一验收"
```

- [ ] **Step 7: 最终整分支审查**

审查范围从本轮基线到 HEAD。任务内审查按 SDD 最多 5 轮 breaker；最终整分支审查只允许一次集中 fix wave 和一次 scoped re-review。任何残余 Critical/Important 都标记 BLOCKED 并停止合并，不开启第二次最终修复浪潮；Minor 只登记一次后停止。

---

## Execution Order and Gates

1. Task 1、Task 2、Task 3 按顺序执行；三项及 Task 3 列出的 readonly/leaf-guard 全回归全部通过后，阶段 0 才算完成。
2. 阶段 0 未完成不得开始 Task 4。Task 4 完成后依次执行 Task 5、Task 6、Task 7、Task 8。
3. Task 9 只做剩余页面兼容扫描，不扩大业务页面设计范围。
4. Task 10 只验收；任何产品代码修改必须回到对应任务并重新审查。

### 2026-08-12 后续执行顺序

1. 以 `f24e714` 为代码基线，先统一仍未迁移页面使用的 token、基础组件和 AppShell 接口。
2. 第一批迁移仪表盘、分类、标签、知识库和 AI；每个业务域完成后只运行相关测试。
3. 第二批迁移通知、活动、设置、看板、思维导图和认证页面，并完成响应式兼容检查。
4. 全部页面完成后统一运行 Jest、lint、type-check、production build 和真实浏览器核心流程验收。
5. 具体文件与定向测试命令在开始实现前依据 `f24e714` 当前源码生成，避免复用本计划中已经执行完毕的旧任务步骤。

## Stop Conditions

- 阶段 0 仍存在数据覆盖风险：停止 UI 扩张。
- 基础组件导致三个以上不同类型业务回归：停止页面迁移，先稳定组件契约。
- 各业务页面达到统一 token、壳层、组件和响应式要求后停止，不追求全站逐像素一致。
