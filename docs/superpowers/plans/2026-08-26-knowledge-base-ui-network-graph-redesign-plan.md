# 知识库 UI 与关系网络图谱重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 像素级对齐已确认 HTML 设计稿，并将树状知识图谱替换为稳定、无根的二维关系网络。

**Architecture:** 保留 React Flow 作为交互渲染层，将布局职责收敛到独立纯函数；使用确定性力导向迭代计算节点位置。知识库页面恢复为两个独立 panel，所有尺寸直接对应设计稿规格。

**Tech Stack:** Next.js 16、React、TypeScript、@xyflow/react、Jest、Testing Library、CSS product tokens

## Global Constraints

- HTML 稿和用户确认的图二是唯一视觉基准，不保留旧视觉兼容。
- 不使用 Dagre、树形或思维导图布局。
- 桌面左栏 `280px`、间距 `24px`、画布最小高度 `480px`、详情栏 `288px`。
- 缩放低于 `0.6` 时隐藏关系标签。
- 不修改知识图谱 API 数据结构和生成逻辑。

---

### Task 1: 确定性关系网络布局

**Files:**
- Modify: `notes-frontend/src/components/knowledge-bases/knowledge-graph-layout.ts`
- Modify: `notes-frontend/__tests__/knowledge-graph-layout.spec.ts`
- Modify: `notes-frontend/package.json`
- Modify: `notes-frontend/package-lock.json`

**Interfaces:**
- Consumes: `KnowledgeGraphProposal`
- Produces: `buildKnowledgeGraphFlow(graph): { nodes, edges }`

- [x] **Step 1: 写失败测试**

新增断言：相同输入位置完全一致；12 个节点同时分散在 X/Y 两个维度；节点矩形不重叠；所有 edge source/target 都存在；边类型不是 `smoothstep`。

- [x] **Step 2: 运行测试并确认当前 Dagre 分层布局不满足二维关系网络断言**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/knowledge-graph-layout.spec.ts`

- [x] **Step 3: 实现固定种子的力导向布局**

使用节点 id 哈希生成初始圆周扰动，执行固定次数的斥力、弹簧力、中心引力和碰撞分离；输出 `type: 'default'` 或轻曲线 edge，并移除 Dagre 依赖。

- [x] **Step 4: 运行布局测试**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/knowledge-graph-layout.spec.ts`
Expected: PASS

---

### Task 2: 像素级恢复独立双栏面板

**Files:**
- Modify: `notes-frontend/src/app/dashboard/knowledge-bases/page.tsx`
- Modify: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphPanel.tsx`
- Modify: `notes-frontend/src/styles/product-tokens.css`
- Modify: `notes-frontend/__tests__/knowledge-bases.spec.tsx`

**Interfaces:**
- Consumes: `useKnowledgeBasePage()` 当前返回值
- Produces: `.product-kb-layout` 下两个独立 `.prototype-panel`

- [x] **Step 1: 修改集成测试结构断言**

断言页面存在 `.product-kb-layout`、两个 `.prototype-panel`，不存在 `.knowledge-base-workspace`；图谱 toolbar 和 warning 位于右侧 panel 内。

- [x] **Step 2: 运行测试确认失败**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/knowledge-bases.spec.tsx`

- [x] **Step 3: 重写页面 DOM 与样式**

严格使用设计稿的 `280px + 24px + 1fr`、panel 圆角边框、58px header、页签 `10px 18px 0`、toolbar `10px 18px`、warning `12px 18px 0`。

- [x] **Step 4: 运行集成测试**

Run: `npm exec jest -- --runInBand --coverage=false __tests__/knowledge-bases.spec.tsx`
Expected: PASS

---

### Task 3: 关系网络画布细节与响应式

**Files:**
- Modify: `notes-frontend/src/components/knowledge-bases/KnowledgeGraphCanvas.tsx`
- Modify: `notes-frontend/src/styles/product-tokens.css`
- Test: `notes-frontend/__tests__/knowledge-bases.spec.tsx`

**Interfaces:**
- Consumes: Task 1 的 `buildKnowledgeGraphFlow`
- Produces: 无根网络画布、节点一跳高亮、详情栏、控制条、提示和图例

- [x] **Step 1: 调整 React Flow 边和控制项**

边改为直线/轻曲线；增加左下角操作提示；工具条顺序为缩小、放大、适应、重排；重新布局调用同一确定性算法。

- [x] **Step 2: 对齐节点和详情栏尺寸**

节点宽度约 `154px`、padding `9px 12px`；桌面详情栏 `288px`；画布 `min-height:480px`。

- [x] **Step 3: 对齐响应式**

`<=900px` 左右栏变单列且详情覆盖画布；`<=767px` 详情移动到画布下方并隐藏图例。

- [x] **Step 4: 运行前端验证**

Run: `npm run type-check && npm exec jest -- --runInBand --coverage=false __tests__/knowledge-bases.spec.tsx __tests__/knowledge-graph-layout.spec.ts && npm run build`
Expected: 全部通过

---

### Task 4: 真实视觉验收与提交

**Files:**
- Verify: `docs/ui-mockups/phase-one-search-and-knowledge-graph-ui-20260826.html`
- Verify: `notes-frontend/src/app/dashboard/knowledge-bases/page.tsx`

**Interfaces:**
- Consumes: 完整页面
- Produces: 1440px 和 390px 视觉验收结果

- [x] **Step 1: 使用临时隔离路由渲染 12 节点真实组件**

隔离路由只用于 QA，截图后删除，不提交。

- [x] **Step 2: 检查桌面和移动端**

验证双 panel 间距、首屏完整网络、无树状主干、无横向溢出、节点详情正常。

- [x] **Step 3: 删除 QA 路由并再次运行 `git diff --check`**

- [x] **Step 4: 提交**

```powershell
git commit -m "fix(frontend): 对齐知识库设计并改用关系网络"
```
