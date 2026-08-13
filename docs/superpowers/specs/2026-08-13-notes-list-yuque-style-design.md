# 我的笔记列表 · 语雀化简洁改版设计

日期：2026-08-13
范围：`notes-frontend/src/app/dashboard/notes/page.tsx` 与 `notes-frontend/src/components/notes/NotesListCard.tsx`
目标：让「我的笔记」页更简洁干净（参考语雀首页的轻列表风格），保留右侧智能推荐边栏但收窄。

## 设计原则

- 去掉信息冗余：列表项不再常驻展示正文摘要，正文改为 hover 浮卡展示。
- 轻量分隔：去掉卡片边框/阴影/圆角，用细分隔线 + 留白 + hover 浅底区分行。
- 操作弱化：编辑/删除按钮默认隐藏，hover 或键盘聚焦时淡入，降低视觉噪声。
- 一致性：所有颜色使用现有 CSS 设计令牌变量（`--on-surface`、`--text-muted`、`--border`、`--surface-2`、`--primary-600`、`--primary-50`、`--primary-100`），不写死 hex。

## 布局调整（page.tsx）

- 主区保持单列；右侧 `SmartRecommendations` 边栏从 `lg:col-span-1`（约 25%）收窄为固定窄边栏（约 `w-72` / 288px 或 `lg:col-span-1` 配 `max-w-[260px]`），并在桌面端 `sticky top-6`，减少长列表滚动时的干扰。
- 分页控件保留在列表**底部**（上一轮已移至下方）。
- 搜索/筛选条（`SearchFilterBar`）维持现有位置不变。

## 列表项（NotesListCard.tsx，样式 A）

每行结构（单行轻列表）：

```
[标题（单行截断）] ............ [meta: 更新时间 · 分类 · 标签数] [草稿] [✎][🗑]
```

- 容器：去掉 `Card`/`CardHeader`/`CardContent` 的边框、阴影、圆角；改为 `divide-y` 细分隔线的行，上下 padding 约 `14px`，hover 时整行 `background: var(--surface-2)`、标题变 `var(--primary-600)`。
- 标题：`text-[15px] font-semibold`，`line-clamp-1` 单行截断；链接 hover 变主题色。
- meta 行：与标题同行右侧，11–12px 灰色小字，格式 `更新于 08-13 · 工作 · 标签 3`；`·` 用 `var(--border)` 着色；草稿标记靠右小 badge。
- 操作按钮（编辑/删除）：默认 `opacity-0`，`group-hover` 或 `focus-within` 时 `opacity-100` 淡入；图标尺寸约 `14px`，hover 浅底圆角。
- **移除常驻摘要区**（`SummaryPreview` 不再常驻渲染于列表中）。
- 标签：不在列表项常驻展示（移入 hover 浮卡）；批量模式下仍保留选择逻辑。
- 选择模式：保留圆形勾选覆盖层，尺寸收紧（`w-5 h-5`），位置 `top-3 left-3`。

## Hover 浮卡（Tooltip）

- 新增轻量自定义浮卡组件（不引入额外依赖），在列表项 hover 时显示在行下方/侧旁。
- 内容：笔记标题 + 摘要前 80 字（`note.summary` 或 `note.content` 去 HTML/Markdown 符号后截断）+ 标签（取前 4 个）。
- 样式：白底、细边框、圆角 12px、柔和阴影；出现带 150ms 淡入 + 轻微上移。
- 可访问性：浮卡不依赖纯 hover，键盘聚焦行内链接/按钮时也应可触发（与操作按钮同 `focus-within` 机制）。
- 性能：浮卡内容基于已有 `note` 数据本地计算，无额外请求。

## 不改动的部分

- 搜索/筛选、批量选择、生成摘要、删除确认弹窗、空状态/加载态逻辑保持不变，仅样式随列表容器统一。
- 右侧 `SmartRecommendations` 内部内容不变，仅外层宽度/粘性调整。

## 测试与验收

- 视觉：列表项无边框无阴影、行间细分隔线；hover 行浅底 + 标题变色 + 按钮淡入 + 浮卡出现。
- 功能：点击标题进入笔记、编辑/删除可用、批量选择勾选正常、分页/筛选正常。
- 响应式：窄屏下右侧边栏堆叠到下方或隐藏，列表仍单列可读。
- 无新增 lint 错误。

## 实现备注

- 浮卡定位优先用 CSS（绝对定位 + 行内 `relative`），避免引入定位库。
- 若浮卡在列表末行被遮挡，可让其向上展开或限制最大可视区域。
