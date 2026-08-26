# 知识图谱可视化 UI 设计稿

> 背景：后端已提供 `nodes` / `edges` 图谱数据，当前前端 `KnowledgeGraphPanel.tsx` 仅以"NODES / EDGES 两列标签预览"展示，缺失图形化表达。本稿将其升级为可缩放、可拖拽、带连线的真正关系网络图，并保持与项目 `--product-*` 令牌体系一致的克制风格。

## 1. 设计目标与原则

| 原则 | 落地方式 |
| --- | --- |
| 一图胜千言 | 节点 + 连线 + 关系标签，直接呈现网络结构 |
| 克制柔和 | 复用 `--product-*` token，无高饱和色、无强阴影 |
| 明暗一致 | 同一套 token 自动适配 `light` / `dark` |
| 信息分层 | 节点(主) → 连线(次) → 关系标签(最弱)，避免视觉噪音 |
| 可读性优先 | 缩放级别与标签显隐联动，防重叠 |

## 2. 技术选型建议

- **渲染方案**：优先使用 **React Flow**（`@xyflow/react`，免费 MIT），内置拖拽、缩放、平移、自适应布局、MiniMap、Controls。
- **布局算法**：`dagre`（分层，适合"概念-子主题"）或 `elkjs`（力导向式自动布局），初始计算一次，用户可再手动拖拽。
- **为何不用 Excalidraw / mind-elixir**：项目已有 mind-elixir 用于思维导图（树形），但知识图谱是**任意多对多关系网络**，需自由布局与力导向，React Flow 更契合。
- **降级方案**：若暂时不引入 React Flow，可先用自绘 SVG `<line>` + `<circle>` + 简单力导向 JS（后续章节给出纯 SVG 兜底），保证"连线 + 缩放平移"的核心诉求达成。

## 3. 整体布局（单画布方案）

不再使用左右两列，改为**一个全宽画布容器**，上方保留操作区，画布内嵌工具。

```
┌───────────────────────────────────────────────────────────────┐
│  ⦿ 知识图谱    (待保存提案) 当前边界内 N 篇笔记    [保存] [生成]│  ← 现有头部
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │           (画布区 react-flow)                        │     │
│  │                                                   ○  │     │
│  │            ┌─────────┐                            ╲  │     │
│  │      ○─────│ 概念A   │─────── 包含 ───┐             │     │
│  │     │      └─────────┘                │            ○  │     │
│  │     │ 引用                               ▼              │
│  │  ┌─────────┐                        ┌─────────┐         │
│  │  │ 实体B   │──────── 依赖 ─────────▶│  主题C  │         │
│  │  └─────────┘                        └─────────┘         │
│  │                    [−]  [+]  ⟳  ☰  (Controls)           │
│  └─────────────────────────────────────────────────────┘     │
│  ▲ 图例(左下)   ▲ MiniMap(右下)                                │
└───────────────────────────────────────────────────────────────┘
```

- 画布高度建议 `360–420px`（超出部分靠平移/缩放查看），与当前卡片面板整体高度和谐。
- 画布容器：`border: 1px solid var(--product-line); border-radius: var(--product-radius-md); background: var(--product-panel-soft);`
- 画布背景用极淡的点阵网格（`background-image: radial-gradient(...)` 1px 圆点），在 light 下 `rgba(0,0,0,.05)`，dark 下 `rgba(255,255,255,.07)`，仅作坐标参照，不强视觉。

## 4. 节点（Nodes）设计

### 4.1 节点外观

统一为**圆角矩形卡片**，尺寸自适应文字：

```css
/* 节点卡片 */
.node-card {
  min-width: 96px;
  max-width: 168px;
  padding: 8px 12px;
  border: 1px solid var(--product-line-strong);
  border-radius: 8px;              /* --product-radius-sm */
  background: var(--product-panel);
  box-shadow: 0 1px 2px rgba(24,34,49,.06);
  cursor: grab;
}
.node-card:active { cursor: grabbing; }
.node-card--selected {
  border-color: var(--product-accent);
  box-shadow: 0 0 0 2px var(--product-accent-soft);
}
```

### 4.2 节点类型区分（用左色条，克制不刺眼）

按 `node.type` 用左边缘 3px 色条区分，本体仍用面板色，保证明暗下都不突兀：

| type | 色条 | 语义 |
| --- | --- | --- |
| `concept`（概念） | `var(--product-accent)` #58728f | 主强调蓝灰 |
| `entity`（实体） | 琥珀 `#b98a2e` | 温和暖色 |
| `topic`（主题） | 绿 `#3f7d5a` | 生态绿 |
| `claim`（论断） | 紫 `#7a5b8a` | 柔和紫 |

```css
.node-card[data-type="concept"] { border-left: 3px solid var(--product-accent); }
.node-card[data-type="entity"]  { border-left: 3px solid #b98a2e; }
.node-card[data-type="topic"]   { border-left: 3px solid #3f7d5a; }
.node-card[data-type="claim"]   { border-left: 3px solid #7a5b8a; }
```

### 4.3 节点内容

```
┌─▌────────────┐
│ ▌ 机器学习   │   ← label（font 13px / weight 620 / color: --product-text）
│ ▌ concept 92%│   ← 类型徽标 + 置信度（font 10px / color: --product-muted）
└──────────────┘
```

- 第一行：`label` 主标题。
- 第二行：小字展示 `type` 中文名 + `confidence` 百分比（`92%`），来源注释 `title` 亦保留。
- **关系规范化**：`relation` 展示前统一做 中文映射，保证"包含 / 依赖 / 引用 / 覆盖 / 相关"等，映射表见 §6.3。节点侧 `type` 同理映射为中文（概念/实体/主题/论断）。

## 5. 连线（Edges）设计

### 5.1 连线样式

```css
.edge-line {
  stroke: var(--product-line-strong);
  stroke-width: 1.5;
}
.edge-line--highlight { stroke: var(--product-accent); stroke-width: 2; }
.edge-line--selected {
  stroke: var(--product-accent);
  stroke-width: 2;
  filter: drop-shadow(0 0 3px var(--product-accent));
}
```

- 默认：`--product-line-strong` 细线，无箭头（关系标签已表达方向语义）。
- 悬停/选中边：变 `--product-accent` 加粗。
- 目标端可加小箭头（`marker-end`），默认关闭以保持克制，选中时显示。

### 5.2 关系标签（label 位于线段中点）

```css
.edge-label {
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--product-panel);        /* 与画布底色区分 → 衬在线上可读 */
  border: 1px solid var(--product-line);
  color: var(--product-text-secondary);
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
}
```

- 关系名默认**始终显示**（节点少时，图谱核心价值即在此）。
- 缩放级别 **< 0.6** 时隐藏标签，仅保留连线，避免密集重叠；再放大时恢复。

## 6. 交互

### 6.1 画布级（由 React Flow 内置）

| 交互 | 行为 |
| --- | --- |
| 拖拽空白 | 平移画布 |
| 滚轮 / 双指 | 缩放（min 0.25 / max 1.75） |
| 拖拽节点 | 手动微调布局 |
| 双击空白 | 重新自动布局（dagre） |
| 双击节点 | 聚焦该节点（fitView 到其局部） |

### 6.2 工具浮层（画布右下角，叠在画布上）

沿用项目 `prototype-icon-button` 的弱化风格：

```
┌─────────┐
│ −  + ⟳ ☰│
└─────────┘
```

- `−` / `+`：缩放
- `⟳`：重新自动布局
- `☰`：Fit View 适应全部

实现为绝对定位的垂直小胶囊，`background: var(--product-panel); border: 1px solid var(--product-line-strong); border-radius: 8px;`，按钮 `36×36`，hover 用 `--product-surface-muted`。

### 6.3 悬浮信息（hover / 选中）

- 悬停**节点**：整卡提升 `box-shadow: var(--product-shadow-float)`，右上角显示"引用 N 篇笔记"小角标（若 `noteIds.length>0`）。
- 悬停**连线**：加粗变色，关系标签加深为 `--product-text`。
- 点击节点：右侧不出抽屉（保持克制），仅在画布内通过 `--selected` 态呈现；置信度与笔记数作为 `title` 悬浮提示。

### 6.4 关系名称规范化映射

AI 可能返回英文 relation，展示层做中文映射，未命中则原样显示（不硬编码报错）：

| 英文原值 | 中文展示 |
| --- | --- |
| `describes` | 描述 |
| `includes` / `contains` | 包含 |
| `uses` | 使用 |
| `covers` | 覆盖 |
| `depends_on` / `relies_on` | 依赖 |
| `relates_to` / `related_to` | 相关 |
| `defines` | 定义 |
| `refers_to` | 引用 |
| `causes` | 导致 |
| `examples` / `exemplifies` | 示例 |

（此映射为前端展示层可维护常量表；若后端后续返回中文，则优先原样使用。）

## 7. 图例（Legend，画布左下）

克制的图例，列出节点类型对应的色条与含义：

```
◼ 概念  ◼ 实体  ◼ 主题  ◼ 论断
```

- 位置：画布左下角，绝对定位小胶囊，样式同工具浮层。
- 每个色块 `10×10` 圆角 2px，配 `font 10px / color: --product-muted` 文字。
- 仅当存在对应类型的节点时才展示对应项。

## 8. MiniMap（可选，画布右下）

- 默认**折叠隐藏**，避免抢占画布空间；节点多时用户可点开。
- 尺寸 `120×90`，节点描影用 `--product-accent`，背景 `--product-panel-soft`。

## 9. 空态 / 加载态 / 异常态

| 状态 | 表现 |
| --- | --- |
| 空知识库 | 保留现有虚线提示"加入笔记后才能构建图谱" |
| 已生成但 0 节点/0 边 | 画布内居中浅提示："暂无节点"/"暂无关系"（`--product-muted`） |
| 构建中 | 画布内居中 `animate-spin` + "正在构建图谱…" |
| 加载已存图谱 | 画布内居中 `animate-spin` + "加载图谱…" |

## 10. 明暗主题对照

| Token | Light | Dark |
| --- | --- | --- |
| 画布背景 | `--product-panel-soft` #f1f1ef | `--product-surface-muted` |
| 节点卡片 | `--product-panel` #fff | `--product-panel` #232322 |
| 节点边框 | `--product-line-strong` #d4d4d0 | `--product-line-strong` #4a4a45 |
| 连线 | `--product-line-strong` | `--product-line-strong` |
| 关系标签底 | `--product-panel` | `--product-panel` |
| 文字 | `--product-text` / `--product-text-secondary` / `--product-muted` | 同 token 自动变亮 |

全部依赖 token，不写死色值，明暗切换零成本。

## 11. 落地清单（对照现有 KnowledgeGraphPanel.tsx）

- [ ] 安装 `@xyflow/react` + `dagre` + `@types/dagre`（或先做 §12 SVG 兜底）。
- [ ] 新建 `KnowledgeGraphCanvas.tsx`：接收 `nodes` / `edges` / `graphNodeLabels`，产出 React Flow `nodes` / `edges`（含中文 relation 与 type 映射、缩放联动标签）。
- [ ] 新建 `relation-zh.ts`：§6.4 映射表 + `nodeTypeZh(type)` 辅助函数。
- [ ] 新建 `graph.css`：§4/§5/§6 的节点卡片、连线、标签、图例、工具浮层样式。
- [ ] `KnowledgeGraphPanel.tsx`：删除左右两列 `Nodes/Edges` 预览，替换为 `<KnowledgeGraphCanvas/>`；保留 warnings 提示区。
- [ ] 空态 / 加载态 / 保存与生成按钮逻辑不变。
- [ ] 补充测试：relation 中文映射、节点/边到 React Flow 结构转换、缩放隐藏标签阈值。

## 12. 纯 SVG 兜底（暂不引入 React Flow 时）

若暂缓引入依赖，可用自绘 SVG 实现最小可用图：

- `<svg>` 外框 + `<g transform="translate/scale">` 模拟平移缩放。
- 节点渲染 `<g>` + `<rect>` + `<text>`；连线 `<line>` + 中点 `<text>` 关系标签。
- 简单力导向：Fruchterman–Reingold 迭代收敛坐标（节点数 < 30 足够）。
- 拖拽：`onPointerDown` 记录偏移，更新节点坐标。
- 缩放：滚轮改 `transform scale`，按钮 +/-。
- 缺点：无内置 MiniMap / 自动布局舒适化，需手写；作为过渡方案。

---
*设计稿版本 v1 · 仅含 UI/UX 设计，不含业务与权限逻辑改动。*
