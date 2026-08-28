# 知识图谱全屏专注模式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为知识图谱增加全屏专注模式，并允许用户通过左侧抽屉在模式内切换知识库，同时保留每个知识库在本次专注会话中的画布状态。

**Architecture:** `KnowledgeBasesPage` 继续拥有知识库业务状态，新建 `KnowledgeGraphFocusMode` 只负责全屏层、抽屉、焦点和键盘交互。`KnowledgeGraphCanvas` 通过显式 session state 接口向页面层回传并恢复筛选、节点位置和 viewport；`useKnowledgeBasePage` 通过请求序号阻止旧请求覆盖新选择。

**Tech Stack:** Next.js 14、React 18、TypeScript、React Flow (`@xyflow/react`)、Jest、Testing Library、项目现有 CSS token。

## Global Constraints

- 只修改前端专注模式相关文件，不修改后端、GraphRAG、图谱生成模型、proposal 规则或保存格式。
- 普通页面保留现有双栏布局；专注模式使用当前页面内的 fixed 全屏层，不新增路由。
- 桌面抽屉约 `300px` 且覆盖画布；窄屏使用接近全宽 sheet；抽屉不得挤压 React Flow 画布。
- `Escape` 先关闭抽屉，再退出专注模式；退出后焦点回到触发按钮；背景页面在专注期间禁止滚动。
- saved graph 和 proposal graph 继续遵守 `graphProposal || savedGraph`，并明确显示“已保存图谱”或“待保存提案”。
- 会话状态只保存在当前专注模式生命周期，不写后端、URL 或浏览器存储。
- 严格 TDD：每项行为先写失败测试并记录预期失败，再做最小实现。
- 遵守根目录 `AGENTS.md`：复杂业务约束使用简洁中文注释，中文 commit message 通过 UTF-8 文件传给 `git commit -F`。

## 文件结构

- Create: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphFocusMode.tsx` — 全屏层、知识库抽屉、焦点与 Escape 行为。
- Create: `notes-frontend/src/components/knowledge-bases/knowledge-graph-session.ts` — 每知识库画布会话状态类型与纯函数更新。
- Create: `notes-frontend/__tests__/knowledge-graph-session.spec.ts` — 会话状态纯函数测试。
- Modify: `notes-frontend/src/app/dashboard/knowledge-bases/page.tsx` — 专注模式入口、生命周期和组件接线。
- Modify: `notes-frontend/src/components/knowledge-bases/useKnowledgeBasePage.ts` — 阻止陈旧 links/graph 请求覆盖当前选择，提供显式重试。
- Modify: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphPanel.tsx` — 共享普通/专注图谱入口并透传 session state。
- Modify: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphCanvas.tsx` — 恢复并回传 viewport、节点位置和筛选。
- Modify: `notes-frontend/src/styles/product-tokens.css` — 全屏层、抽屉、loading 覆层和响应式样式。
- Modify: `notes-frontend/__tests__/knowledge-bases.spec.tsx` — 专注模式、切库、焦点、空态和异常回归测试。

---

### Task 1: 切换知识库时拒绝陈旧异步结果

**Files:**
- Modify: `notes-frontend/src/components/knowledge-bases/useKnowledgeBasePage.ts`
- Test: `notes-frontend/__tests__/knowledge-bases.spec.tsx`

**Interfaces:**
- Consumes: `knowledgeBasesAPI.getNotes(id)`、`knowledgeBasesAPI.getGraph(id)`。
- Produces: `retrySelectedKnowledgeBase(): Promise<void>`；只有最新选择对应的请求可以写入 `links`、`savedGraph` 和相关 loading/error 状态。

- [ ] **Step 1: 写陈旧请求失败测试**

在测试中创建两个 deferred promise，先选择 `kb-2`，再让 `kb-1` 的旧请求最后完成；断言页面最终只显示 `kb-2` 的笔记和图谱：

```tsx
const oldGraph = deferred<typeof graphProposal>()
mockKnowledgeBasesAPI.getAll.mockResolvedValue([kb, kb2])
mockKnowledgeBasesAPI.getGraph
  .mockImplementationOnce(() => oldGraph.promise)
  .mockResolvedValueOnce({ ...graphProposal, knowledgeBaseId: 'kb-2', nodes: [{ ...graphProposal.nodes[0], label: 'KB2 Node' }] })

render(<KnowledgeBasesPage />)
fireEvent.click(await screen.findByRole('button', { name: /第二知识库/ }))
expect(await screen.findByText('KB2 Node')).toBeInTheDocument()
oldGraph.resolve(graphProposal)
await waitFor(() => expect(screen.queryByText('Attention')).not.toBeInTheDocument())
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- --runInBand __tests__/knowledge-bases.spec.tsx`

Expected: FAIL，旧 `kb-1` 请求完成后覆盖 `kb-2` 图谱。

- [ ] **Step 3: 最小实现请求序号保护和重试入口**

在 hook 内分别使用 `linksRequestRef`、`graphRequestRef` 递增序号；每次请求结束前同时校验请求序号和 knowledge base ID。重试函数复用相同加载入口：

```ts
const linksRequestRef = useRef(0)
const graphRequestRef = useRef(0)

const loadGraph = async (knowledgeBaseId: string) => {
  const requestId = ++graphRequestRef.current
  if (!knowledgeBaseId) { setSavedGraph(null); return }
  setLoadingGraph(true)
  try {
    const graph = await knowledgeBasesAPI.getGraph(knowledgeBaseId)
    if (requestId === graphRequestRef.current) setSavedGraph(graph)
  } catch (err) {
    if (requestId === graphRequestRef.current) {
      setSavedGraph(null)
      setError(getKnowledgeBaseErrorMessage(err, '知识图谱加载失败，请重试'))
    }
  } finally {
    if (requestId === graphRequestRef.current) setLoadingGraph(false)
  }
}

const retrySelectedKnowledgeBase = async () => {
  if (!selectedId) return
  await Promise.all([loadLinks(selectedId), loadGraph(selectedId)])
}
```

对 `loadLinks` 使用同样的序号约束；不要吞掉当前请求错误。

- [ ] **Step 4: 运行定向测试确认 GREEN**

Run: `npm test -- --runInBand __tests__/knowledge-bases.spec.tsx`

Expected: PASS。

- [ ] **Step 5: 独立提交**

```powershell
git add -- notes-frontend/src/components/knowledge-bases/useKnowledgeBasePage.ts notes-frontend/__tests__/knowledge-bases.spec.tsx
git commit -F .codex-commit-message.txt
```

提交信息：`fix(frontend): 防止知识库切换结果串线`

---

### Task 2: 全屏层与知识库抽屉

**Files:**
- Create: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphFocusMode.tsx`
- Modify: `notes-frontend/src/app/dashboard/knowledge-bases/page.tsx`
- Modify: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphPanel.tsx`
- Modify: `notes-frontend/src/styles/product-tokens.css`
- Test: `notes-frontend/__tests__/knowledge-bases.spec.tsx`

**Interfaces:**
- Consumes: `KnowledgeBase[]`、`selectedId`、`setSelectedId(id)`、`KnowledgeGraphPanel` 的现有 props、`retrySelectedKnowledgeBase()`。
- Produces: `KnowledgeGraphFocusModeProps`，包括 `onClose`、知识库列表/选择、图谱 props 和 retry；页面入口按钮名称为“进入图谱专注模式”。页面只在 `focusOpen` 为 true 时挂载组件。

- [ ] **Step 1: 写进入、抽屉切换和状态徽标失败测试**

扩展 canvas mock 输出 `graph.knowledgeBaseId`。渲染两个知识库，进入专注模式，打开“选择知识库”抽屉并点击第二项，断言 dialog 保持存在且状态切换：

```tsx
fireEvent.click(await screen.findByRole('button', { name: '进入图谱专注模式' }))
const focus = screen.getByRole('dialog', { name: '知识图谱专注模式' })
expect(focus).toBeInTheDocument()
expect(within(focus).getByText('已保存图谱')).toBeInTheDocument()
fireEvent.click(within(focus).getByRole('button', { name: '选择知识库' }))
fireEvent.click(within(focus).getByRole('button', { name: /第二知识库/ }))
expect(screen.getByRole('dialog', { name: '知识图谱专注模式' })).toBeInTheDocument()
expect(await within(focus).findByText('第二知识库')).toBeInTheDocument()
```

再让 `buildGraphProposal` 返回 proposal，断言徽标变为“待保存提案”。

- [ ] **Step 2: 写键盘、焦点、滚动锁定失败测试**

断言进入后 `document.body.style.overflow === 'hidden'`；抽屉打开时搜索框获得焦点；第一次 Escape 只关闭抽屉，第二次退出 dialog；退出后入口按钮重新获得焦点且 body overflow 恢复。

- [ ] **Step 3: 运行测试确认 RED**

Run: `npm test -- --runInBand __tests__/knowledge-bases.spec.tsx`

Expected: FAIL，找不到专注模式入口和 dialog。

- [ ] **Step 4: 创建最小专注模式组件**

定义清晰 props，并使用原生 dialog 语义的 fixed 容器：

```tsx
export interface KnowledgeGraphFocusModeProps {
  knowledgeBases: KnowledgeBase[]
  selectedId: string
  selectedKnowledgeBase: KnowledgeBase | null
  onSelect: (id: string) => void
  onClose: () => void
  graphPanelProps: React.ComponentProps<typeof KnowledgeGraphPanel>
  error: string
  onRetry: () => void
}
```

组件内部维护 `drawerOpen` 和 `query`。过滤仅匹配名称或描述；点击结果时调用 `onSelect(id)` 并关闭抽屉。用 effect 锁定 body 滚动并注册 Escape；cleanup 恢复之前的 overflow。抽屉打开后聚焦搜索框；用起止 focus sentinel 或 Tab key handler 将焦点限制在抽屉的可交互元素内。

- [ ] **Step 5: 接入页面与共享图谱面板**

`KnowledgeBasesPage` 增加 `focusOpen` 和触发按钮 ref。只在 graph tab 且已选择知识库时显示入口。关闭回调设置 `focusOpen=false` 并在下一帧恢复按钮焦点。普通模式和专注模式传递同一组 `KnowledgeGraphPanel` props，不复制 build/save handler。给 `KnowledgeGraphPanel` 增加可选 `preserveGraphWhileLoading?: boolean`：普通模式保持现状；专注模式为 true 且已有 graph 时继续渲染旧画布，并覆盖 `aria-live="polite"` 的不可交互 loading 层，成功后原位替换，失败后由 hook 清空旧图并显示重试入口。

- [ ] **Step 6: 增加最小样式**

使用以下结构约束，不修改普通双栏规则：

```css
.knowledge-focus { position:fixed; inset:0; z-index:80; display:grid; grid-template-rows:auto minmax(0,1fr); background:var(--product-bg); color:var(--product-text) }
.knowledge-focus__canvas { min-width:0; min-height:0; position:relative }
.knowledge-focus__canvas .knowledge-graph-stage { height:100%; min-height:0; margin:0 }
.knowledge-focus__drawer-backdrop { position:absolute; inset:0; z-index:20; background:rgba(0,0,0,.2) }
.knowledge-focus__drawer { position:absolute; inset:0 auto 0 0; width:min(300px,calc(100vw - 48px)); z-index:21; background:var(--product-panel); box-shadow:var(--product-shadow-float) }
@media(max-width:767px){.knowledge-focus__drawer{width:min(92vw,360px)}}
```

- [ ] **Step 7: 运行定向测试确认 GREEN**

Run: `npm test -- --runInBand __tests__/knowledge-bases.spec.tsx`

Expected: PASS，且没有 `act(...)`、hydration 或无障碍角色警告。

- [ ] **Step 8: 独立提交**

提交信息：`feat(frontend): 增加图谱全屏专注模式`

---

### Task 3: 按知识库恢复画布会话状态

**Files:**
- Create: `notes-frontend/src/components/knowledge-bases/knowledge-graph-session.ts`
- Create: `notes-frontend/__tests__/knowledge-graph-session.spec.ts`
- Modify: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphCanvas.tsx`
- Modify: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphPanel.tsx`
- Modify: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphFocusMode.tsx`
- Test: `notes-frontend/__tests__/knowledge-bases.spec.tsx`

**Interfaces:**
- Produces:

```ts
export interface KnowledgeGraphSessionState {
  query: string
  visibleTypes: KnowledgeGraphNodeType[]
  viewport: { x: number; y: number; zoom: number } | null
  positions: Record<string, { x: number; y: number }>
}
export type KnowledgeGraphSessions = Record<string, KnowledgeGraphSessionState>
export function createKnowledgeGraphSession(): KnowledgeGraphSessionState
export function updateKnowledgeGraphSession(
  sessions: KnowledgeGraphSessions,
  knowledgeBaseId: string,
  patch: Partial<KnowledgeGraphSessionState>,
): KnowledgeGraphSessions
```

- `KnowledgeGraphCanvas` 新增可选 `sessionState` 和 `onSessionStateChange` props；普通模式不传时保持当前行为。

- [ ] **Step 1: 写会话纯函数失败测试**

```ts
test('按知识库隔离图谱会话且不修改旧对象', () => {
  const first = updateKnowledgeGraphSession({}, 'kb-1', { query: '向量' })
  const second = updateKnowledgeGraphSession(first, 'kb-2', { viewport: { x: 10, y: 20, zoom: .8 } })
  expect(second['kb-1'].query).toBe('向量')
  expect(second['kb-2'].viewport).toEqual({ x: 10, y: 20, zoom: .8 })
  expect(second).not.toBe(first)
})
```

- [ ] **Step 2: 运行纯函数测试确认 RED**

Run: `npm test -- --runInBand __tests__/knowledge-graph-session.spec.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现最小不可变会话更新**

默认 `visibleTypes` 必须是 `['concept', 'entity', 'topic', 'claim']`；更新时合并指定知识库的默认值、旧值和 patch，其他知识库引用保持不变。

- [ ] **Step 4: 运行纯函数测试确认 GREEN**

Run: `npm test -- --runInBand __tests__/knowledge-graph-session.spec.ts`

Expected: PASS。

- [ ] **Step 5: 写 canvas 恢复行为失败测试**

在 focus mode 集成测试中：切到 `kb-1` 输入筛选词，切到 `kb-2` 输入另一词，再切回 `kb-1`，断言筛选框恢复第一个值。React Flow mock 捕获 `onMoveEnd` 和 `onNodesChange`，分别验证 viewport 与节点 position 按 knowledge base ID 保存。

- [ ] **Step 6: 接入 canvas session props**

`GraphStage` 初始化 query/types/nodes 时优先使用 session state；不存在的节点 position 才使用 `buildKnowledgeGraphFlow`。将筛选变化、`onMoveEnd` viewport 和节点拖拽结束后的 positions 合并回调。外部 session 变化时恢复 viewport；不要在每个 `onMove` 帧写 React state。

- [ ] **Step 7: 在专注模式生命周期持有 sessions**

`KnowledgeGraphFocusMode` 内用一个 `KnowledgeGraphSessions` state，以 `selectedId` 读写当前 session。组件卸载即自然清空；普通页面不接入该状态，因此退出再进入会得到默认值。

- [ ] **Step 8: 运行定向测试确认 GREEN**

Run: `npm test -- --runInBand __tests__/knowledge-graph-session.spec.ts __tests__/knowledge-bases.spec.tsx __tests__/knowledge-graph-layout.spec.ts`

Expected: PASS。

- [ ] **Step 9: 独立提交**

提交信息：`feat(frontend): 保留专注模式图谱会话状态`

---

### Task 4: 发布级自动化与浏览器验收

**Files:**
- Modify only if a reproduced defect requires it: files listed in Tasks 1–3 and their tests.
- Screenshots: repository-external temporary directory only.

**Interfaces:**
- Consumes: completed focus mode and existing local knowledge-base API.
- Produces: verified release evidence; no new runtime interface.

- [ ] **Step 1: 运行前端完整门禁**

```powershell
Set-Location notes-frontend
npm test -- --runInBand
npm run type-check
npm run build
```

Expected: all commands exit 0。任何失败先加载 `project-debug` 和 `systematic-debugging`，并检索 `docs/debug-records.md`；先增加能稳定复现的失败测试，再做最小修复。

- [ ] **Step 2: 启动所需本地服务并使用浏览器验收**

使用 `webapp-testing` 或 `agent-browser` 打开 `http://localhost:3000/dashboard/knowledge-bases`。不得修改或删除真实数据；截图写到仓库外临时目录。

- [ ] **Step 3: 验收桌面交互**

逐项验证：进入专注模式、抽屉搜索、连续切换至少两个知识库、模式不退出、saved/proposal 徽标、loading/error/空态、缩放、平移、重排、节点来源、筛选恢复、Escape 两阶段行为、退出焦点恢复、背景页面不滚动。

- [ ] **Step 4: 验收视觉与运行时质量**

在宽屏和窄屏、浅色和暗色模式检查抽屉覆盖而非挤压画布、无横向滚动、长知识库名称和长节点名可读。确认浏览器控制台没有未处理异常、React hydration warning 或重复 key warning。

- [ ] **Step 5: 最终仓库检查**

```powershell
git diff --check
git status --short
```

确认只有本功能文件；保留并排除所有用户未提交改动。

- [ ] **Step 6: 仅在验收导致实际修改时提交**

提交信息：`test(frontend): 完成图谱专注模式发布验收`。如果没有代码变化，不制造空提交。

- [ ] **Step 7: 请求用户主观视觉确认**

提供页面地址 `http://localhost:3000/dashboard/knowledge-bases`，说明已自动验收项目，并明确请用户确认：全屏画布空间、抽屉宽度与遮挡感、知识库切换节奏、长节点密度和窄屏观感。用户确认前不得声称主观视觉验收完成。
