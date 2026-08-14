# 我的笔记列表 · 语雀化简洁改版 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「我的笔记」页改成语雀风格轻列表：单列无边框行、常驻不显示正文摘要、hover 浮卡展示摘要/标签、右侧边栏收窄并 sticky。

**Architecture:** 复用现有 `NotesListCard` 组件作为单行渲染；新增独立 `NoteHoverPreview` 浮卡组件（纯 CSS 定位，无新依赖）；`page.tsx` 调整栅格列宽与边栏粘性。测试复用 `__tests__/responsive-editor-ui.spec.tsx` 之外的现有笔记列表相关测试，并补充浮卡与布局的断言。

**Tech Stack:** Next.js (App Router) + React + TailwindCSS + lucide-react 图标 + 现有 CSS 设计令牌（`--on-surface`/`--text-muted`/`--border`/`--surface-2`/`--primary-600`/`--primary-50`/`--primary-100`）。

## Global Constraints

- 所有颜色使用现有 CSS 设计令牌变量，禁止写死 hex（除已存在的历史兼容处）。
- Commit message 使用中文，格式 `类型(范围): 简述`。
- 不引入新的运行时依赖（浮卡用纯 CSS 绝对定位实现）。
- 保留现有功能：搜索/筛选、批量选择、生成摘要、删除确认、空/加载态、分页在底部。

---

### Task 1: 右侧边栏收窄并 sticky

**Files:**
- Modify: `notes-frontend/src/app/dashboard/notes/page.tsx:143-211`

**Interfaces:**
- Consumes: 现有 `SmartRecommendations` 动态导入（行 17），`searchParams` 用法不变。
- Produces: 改后的栅格结构，主区占 `lg:col-span-3`，边栏占窄列并 sticky。

- [ ] **Step 1: 修改栅格列宽与边栏容器**

将 `page.tsx` 第 143–211 行的栅格从 `lg:grid-cols-4` + `lg:col-span-3` / `lg:col-span-1` 改为主区更宽、边栏更窄。采用 `lg:grid-cols-[1fr_260px]` 固定边栏宽度，并给边栏加 `lg:sticky lg:top-6 lg:self-start`。

```tsx
// page.tsx 第 143 行附近
<div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 items-start">
  <div className="space-y-6 min-w-0">
    <SearchFilterBar />
    {/* ... 其余主区内容不变 ... */}
  </div>

  <div className="lg:sticky lg:top-6 lg:self-start">
    <SmartRecommendations
      context={{
        keyword: searchParams.get('keyword') || undefined,
        categoryId: searchParams.get('categoryId') || undefined,
        // ... 其余 props 不变
      }}
    />
  </div>
</div>
```

- [ ] **Step 2: 视觉验证**

运行前端 dev server（`cd notes-frontend && npm run dev`），打开 `/dashboard/notes`，确认：
- 桌面端右侧边栏宽度约 260px，滚动主列表时边栏保持不动（sticky）。
- 窄屏（<1024px）边栏堆叠到主区下方，布局不破。

- [ ] **Step 3: 提交**

```bash
git add notes-frontend/src/app/dashboard/notes/page.tsx
git commit -m "refactor(前端): 收窄并固定我的笔记页右侧边栏为 sticky"
```

---

### Task 2: 列表项改为语雀 A 样式单行轻列表

**Files:**
- Modify: `notes-frontend/src/components/notes/NotesListCard.tsx:40-155`

**Interfaces:**
- Consumes: `note`、`categoryMap`、`isSelectionMode`、`selectedNoteIds`、`onToggleSelection`、`onRequestDelete`、`resolveTagId`、`resolveTagLabel`、`currentUserId`（props 全部保留）。
- Produces: 新的单行 DOM 结构（标题 + 右侧 meta + hover 操作按钮 + hover 浮卡挂载点）。浮卡由 Task 3 提供组件，本任务先保留 `<NoteHoverPreview note={note} categoryLabel={categoryLabel} resolveTagId={resolveTagId} resolveTagLabel={resolveTagLabel} />` 的引用占位（Task 3 实现后连通）。

- [ ] **Step 1: 重写卡片为单行轻列表**

替换 `NotesListCard.tsx` 第 40–155 行的 `return` 内容。移除 `Card/CardHeader/CardContent` 与常驻 `SummaryPreview`、常驻标签渲染；改为 `divide-y` 行结构。

```tsx
return (
  <div
    key={note.id || `${String(note.title || 'note')}-${String(note.updatedAt || '')}-${index}`}
    className={`notes-list-item relative group divide-y-0 rounded-lg px-3 py-3.5 transition-colors duration-150 hover:bg-[var(--surface-2)] ${isSelectionMode && selectedNoteIds.has(note.id) ? 'ring-2 ring-blue-500' : ''}`}
  >
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {isSelectionMode && (
        <>
          <div
            role="button"
            tabIndex={0}
            className="absolute inset-0 z-10 cursor-pointer pointer-events-auto"
            onClick={(e) => { e.stopPropagation(); onToggleSelection(note.id) }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleSelection(note.id) } }}
          />
          <div className="absolute top-3 left-3 z-20 pointer-events-none">
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${selectedNoteIds.has(note.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white/80'}`}>
              {selectedNoteIds.has(note.id) && <Check className="w-3.5 h-3.5 text-white" />}
            </div>
          </div>
        </>
      )}
    </div>

    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-3">
          <Link
            href={`/dashboard/notes/${note.id}`}
            className="text-[15px] font-semibold text-[var(--on-surface)] line-clamp-1 group-hover:text-[var(--primary-600)] transition-colors duration-200"
          >
            {note.title || '无标题'}
          </Link>
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] whitespace-nowrap flex-shrink-0">
            <span>更新于 {formatDate(note.updatedAt)}</span>
            <span className="text-[var(--border)]">·</span>
            <span className="truncate max-w-[8rem]">{categoryLabel}</span>
            {note.tags.length > 0 && (
              <>
                <span className="text-[var(--border)]">·</span>
                <span>标签 {note.tags.length}</span>
              </>
            )}
            {note.status === 'draft' && (
              <span className="ml-1 px-1.5 py-0.5 rounded text-[11px]" style={{ background: 'var(--surface-2)', color: 'var(--on-surface)', border: '1px solid var(--border)' }}>草稿</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
        <Link
          href={`/dashboard/notes/${note.id}`}
          className="p-1.5 rounded-md hover:bg-white transition-colors"
          style={{ color: 'var(--text-muted)' }}
          title={writable ? '编辑' : '查看'}
        >
          {writable ? <Edit className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Link>
        {writable && (
          <button
            onClick={() => onRequestDelete(note.id)}
            className="p-1.5 rounded-md hover:bg-white transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>

    <NoteHoverPreview
      note={note}
      categoryLabel={categoryLabel}
      resolveTagId={resolveTagId}
      resolveTagLabel={resolveTagLabel}
    />
  </div>
)
```

注意：列表容器（`page.tsx` 主区）需用 `divide-y divide-[var(--border)]` 包住这些行，以呈现语雀式细分隔线。在 `page.tsx` 渲染 `notes.map(...)` 的外层 `div` 加上 `divide-y divide-[var(--border)]`（`NotesListCard` 本身不再自带分隔线）。

- [ ] **Step 2: 视觉验证**

dev server 下确认：
- 列表项无边框、无阴影、无圆角卡片感；行间有细分隔线。
- hover 行：浅底、标题变蓝、编辑/删除按钮淡入。
- 标题过长单行截断省略号；meta 行小灰字。
- 批量模式下圆形勾选正常、点击整行可选。

- [ ] **Step 3: 提交**

```bash
git add notes-frontend/src/components/notes/NotesListCard.tsx notes-frontend/src/app/dashboard/notes/page.tsx
git commit -m "refactor(前端): 我的笔记列表改为语雀轻列表单行样式"
```

---

### Task 3: 新增 hover 浮卡组件 NoteHoverPreview

**Files:**
- Create: `notes-frontend/src/components/notes/NoteHoverPreview.tsx`
- Modify: `notes-frontend/src/components/notes/NotesListCard.tsx:1-10`（新增 import）

**Interfaces:**
- Consumes: `note: Note`、`categoryLabel: string`、`resolveTagId`、`resolveTagLabel`（同 NotesListCard 签名）。
- Produces: 默认隐藏、`group-hover`/`focus-within` 触发的浮卡；内容为标题 + 摘要前 80 字 + 前 4 个标签。

- [ ] **Step 1: 创建浮卡组件**

新建 `NoteHoverPreview.tsx`：

```tsx
'use client'

import { truncateText } from '@/utils'
import type { Note } from '@/types'

type Props = {
  note: Note
  categoryLabel: string
  resolveTagId: (tag: string | { id?: string; _id?: string }) => string
  resolveTagLabel: (tag: string | { name?: string; id?: string; _id?: string }) => string
}

export function NoteHoverPreview({ note, categoryLabel, resolveTagId, resolveTagLabel }: Props) {
  const fallback =
    note.content
      ? truncateText(note.content.replace(/<[^>]+>/g, '').replace(/[#*`_~>\[\]()]/g, ''), 80)
      : '正在生成摘要...'
  const tags = note.tags.slice(0, 4)

  return (
    <div className="absolute left-3 top-full z-30 mt-2 w-[280px] rounded-xl border border-[var(--border)] bg-white p-3.5 opacity-0 shadow-[0_8px_28px_rgba(0,0,0,0.12)] transition-all duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none translate-y-[-4px] group-hover:translate-y-0">
      <div className="text-[14px] font-semibold text-[var(--on-surface)] mb-1.5 line-clamp-1">
        {note.title || '无标题'}
      </div>
      <div className="text-[12px] leading-relaxed text-[var(--text-muted)] line-clamp-3">
        {note.summary || fallback}
      </div>
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((tag, idx) => {
            const id = resolveTagId(tag)
            const label = resolveTagLabel(tag)
            if (!label) return null
            const keySafe = id ? id : `${note.id}:${label}:${idx}`
            return (
              <span
                key={keySafe}
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ background: 'var(--primary-50)', color: 'var(--primary-600)', border: '1px solid var(--primary-100)' }}
              >
                {label}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 在 NotesListCard 中引入**

在 `NotesListCard.tsx` 顶部 import 区（第 1–10 行）新增：

```tsx
import { NoteHoverPreview } from './NoteHoverPreview'
```

（该组件已在 Task 2 的 JSX 中以 `<NoteHoverPreview ... />` 引用，本步仅补全 import。）

- [ ] **Step 3: 处理末行浮卡遮挡**

若列表最后一行 hover 浮卡被容器 `overflow-hidden` 或视口裁切：在 `page.tsx` 主区列表容器上确保无 `overflow-hidden`；若主区有 `overflow` 限制，将浮卡改为 `bottom-full` 向上展开（对最后若干行）。验证：滚动到列表底部 hover 末行，浮卡完整可见。

- [ ] **Step 4: 提交**

```bash
git add notes-frontend/src/components/notes/NoteHoverPreview.tsx notes-frontend/src/components/notes/NotesListCard.tsx
git commit -m "feat(前端): 新增笔记列表项 hover 浮卡展示摘要与标签"
```

---

## Self-Review

**1. Spec 覆盖：**
- 边栏收窄 + sticky → Task 1 ✅
- 列表项 A 单行、去常驻摘要、操作按钮弱化 → Task 2 ✅
- hover 浮卡显示标题+摘要+标签 → Task 3 ✅
- 分页在底部（已在前序提交完成）→ 不重复 ✅
- 选择模式保留 → Task 2 保留 ✅
- 使用 CSS 令牌、不引依赖 → Global Constraints + 各 Task ✅

**2. Placeholder 扫描：** 无 TBD/TODO；Task 2 中 `NoteHoverPreview` 引用在 Task 3 实现，已在接口说明中显式声明连通关系，非占位。

**3. 类型一致性：** `NoteHoverPreview` 的 props（`note`/`categoryLabel`/`resolveTagId`/`resolveTagLabel`）与 `NotesListCard` 中传递的完全一致；`truncateText`、`formatDate` 来自 `@/utils`，与现有用法一致。
