# Task 1 — 右侧边栏收窄并 sticky

**Plan:** docs/superpowers/plans/2026-08-13-notes-list-yuque-style.md
**File:** notes-frontend/src/app/dashboard/notes/page.tsx

## 需求（verbatim from plan）

将第 143–211 行的栅格从 `lg:grid-cols-4` + `lg:col-span-3` / `lg:col-span-1` 改为主区更宽、边栏更窄。采用 `lg:grid-cols-[1fr_260px]` 固定边栏宽度，并给边栏加 `lg:sticky lg:top-6 lg:self-start`。

当前结构（第 143–211 行）：
```
<div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
  <div className="lg:col-span-3 space-y-6">
    <SearchFilterBar />
    {error ...}
    {notes.length === 0 ? (...) : (
      <div className="product-list-surface divide-y divide-[var(--product-line-soft)]">
        {notes.map(... <NotesListCard .../>)}
      </div>
    )}
    {notes.length > 0 && (<div className="product-list-surface flex ...">分页</div>)}
  </div>
  <div className="lg:col-span-1">
    <SmartRecommendations context={{ keyword, categoryId, ... }} />
  </div>
</div>
```

## 修改为

- 外层：`grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 items-start`
- 主区 `<div className="lg:col-span-3 space-y-6">` → 改为 `<div className="space-y-6 min-w-0">`（去掉 col-span-3，因为新栅格用 1fr 自动占主列）
- 边栏 `<div className="lg:col-span-1">` → 改为 `<div className="lg:sticky lg:top-6 lg:self-start">`
- 其余内部内容（SearchFilterBar、error、列表、分页、SmartRecommendations 及其 props）保持不变。

## 约束（Global Constraints）

- 颜色使用现有 CSS 令牌（`--border` 等），不写死 hex。
- 不引入新的运行时依赖。
- 保留现有功能与 props（SmartRecommendations 的 context 不变）。
- Commit message 中文，格式 `类型(范围): 简述`。

## 验收

- 桌面端右侧边栏宽约 260px，滚动主列表时边栏 sticky 不动。
- 窄屏（<1024px）边栏堆叠到主区下方，布局不破。
- 无新增 lint 错误。
