# 编辑器收尾修复设计

## 目标

一次性修复编辑器在 2026-08-12 用户验收后新冒出的 5 个问题：

1. 左栏搜索框视觉过大
2. 添加评论请求 400 (`Invalid Idempotency-Key`)
3. 文本选择浮层样式丑，AI 续写入口分散
4. 大纲无法滚动、点击跳转失效、抽屉样式丑
5. 左栏收起按钮样式不佳（借鉴语雀）

## 1. 评论 400（幂等键格式不合法）

### 根因

`CommentsPanel.tsx` 用模板字符串拼接幂等键：

```ts
const idemKey = `${noteId}:${selection.start}:${selection.end}:${text.trim()}`
```

后端 `IdempotencyInterceptor` 用正则 `/^[A-Za-z0-9._-]{8,64}$/` 校验，冒号 `:` 和中文都不允许。`text.trim()` 含中文时键必然不合法，永远返回 400。

### 方案

在 `notes-frontend/src/lib/comments-key.ts`（新建）封装 `buildCommentIdempotencyKey(noteId, start, end, text)`：用 `crypto.subtle.digest('SHA-1', ...)` 在浏览器得到 40 字符十六进制摘要，喂给后端。`CommentsPanel` 调用此函数生成键。

要点：

- 同一 (noteId, start, end, text) 必须产生相同键（哈希就是稳定编码）
- 使用浏览器原生 SubtleCrypto，避免引入新依赖
- 后端正则不动，最小爆炸半径

## 2. 文本选择浮层（BubbleMenu）整合

### 现状

- `BubbleMenu`（选中文本后弹出）目前包含：AI 润色、生成摘要、复制、添加评论
- `FloatingMenu`（空行首段）目前包含：AI 续写
- 样式：内联 `style={{ height: 44, paddingLeft: 8, paddingRight: 8, border: '1px solid var(--border)' }}` + BubbleMenu 默认 tippy 主题，造成黑粗框

### 方案

#### 2.1 BubbleMenu 整合 AI 续写

- 把 `FloatingMenu` 中 `mode="continue"` 的 `TiptapAiActions` 复制并合并入 BubbleMenu 顶部
- 在选中文本时，浮层入口变成：AI 续写 / AI 润色 / AI 摘要 / 复制 / 添加评论
- `FloatingMenu` 仍保留空行场景的"AI 续写"入口（独立按钮，不与 BubbleMenu 冲突）
- 通过 `TiptapAiActions` 扩展 `mode` 包含 `'bubble-continue'` 或新增 props `showContinue={true}` 来控制

#### 2.2 样式收敛到 token

替换 `editor-selection-popover` 内联样式为：

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

删除 `style={{ height: 44, ... }}` 硬编码；BubbleMenu 的 tippy `theme` 设置为 `'light-border'` 替换默认黑框。

## 3. 大纲（语雀式）+ 跳转/滚动修复

### 3.1 跳转失效根因

`extractHeadingsFromHTML` 用 `DOMParser` 解析 HTML 并生成 `id = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-') + '-' + i`，但 Tiptap 实际渲染时 `<h1>` 没有 `id` 属性（ProseMirror 默认节点不会自动同步 id），因此 `document.getElementById(heading.id)?.scrollIntoView()` 找不到节点。

### 3.2 滚动失效根因

`<aside className="editor-outline">` 使用 `position: fixed; max-height: calc(100vh - 210px); overflow: hidden;` 但其子 `.editor-outline__content` 使用 `display: grid; overflow-y: auto;`。grid 容器内的 overflow 在某些浏览器（特别是当内容超过 grid 容器计算高度时）不会触发滚动条——这是 grid + 固定定位 + overflow 组合的常见 bug。

### 3.3 方案

#### 3.3.1 跳转改用已有 `editor:scrollToHeading` 事件

`TiptapEditor.tsx` 已实现 `editor:scrollToHeading` handler（144-183 行），接受 `{ index: number }` 并通过 `editor.state.doc.descendants` 找 heading 节点，再 `scrollIntoView({ behavior: 'smooth', block: 'center' })`。这正是我们需要的，因为 Tiptap 自带的 heading 节点一定有 position。

修改 `NoteEditorShell.tsx` 中大纲按钮 `onClick`：从 `document.getElementById(...).scrollIntoView()` 改为：

```ts
document.dispatchEvent(new CustomEvent('editor:scrollToHeading', { detail: { index: i } }))
```

#### 3.3.2 大纲容器可滚动

改造 `.editor-outline`：

- 删除 `position: fixed; right: 18px; top: 176px; width: 210px;`
- 改为作为 `<div className="editor-outline">` 紧贴主内容右侧（即改为文档流的 `aside` 或父 flex 容器的一列）
- 内部保留细窄自定义滚动条（语雀风格）
- 主体内容右侧预留 `220px` 给大纲，主区域 `flex: 1` 缩窄

#### 3.3.3 语雀风格样式

按语雀参考实现，图标一律使用 `lucide-react`，不用字符/占位符号：

```html
<aside class="editor-outline" data-pinned="true">
  <div class="editor-outline__pin">
    <span class="editor-outline__pin-text">大纲</span>
    <button class="editor-outline__hide" aria-label="隐藏大纲"><ChevronRight /></button>
  </div>
  <div class="editor-outline__view">
    <div class="editor-outline__list">
      <div class="editor-outline__item depth-1" data-depth="1">
        <a class="editor-outline__link" href="#">1. 两数之和</a>
      </div>
      ...
    </div>
  </div>
</aside>
```

**图标选择说明（每个位置只放语义贴切的 icon，不硬凑）：**

| 位置 | icon | 选择依据 |
|------|------|----------|
| 隐藏大纲（收回右侧大纲） | `ChevronRight` | 箭头指向右，示意"大纲朝右收走"，与侧栏收起按钮同用 Chevron 家族，整体风格统一 |
| 大纲有子项的条目折叠 | `ChevronDown` / `ChevronRight` | 轻量箭头表达层级折叠/展开，不喧宾夺主；无子项的条目**不渲染**此按钮 |
| 顶部其余装饰 | — | 大纲头部只保留"大纲"标题 + 一个隐藏按钮，不放 logo 或冗余图标 |

要点：

- 顶部 32px 高的 pill 栏，包含"大纲"标题 + 隐藏按钮
- 多级缩进（depth 1–6），同级条目按 `level` 缩进
- 当前激活项：左侧 2px 蓝色标记 + 浅蓝背景
- 自定义细窄滚动条
- 大纲条目文本截断 `text-overflow: ellipsis`
- 所有图标统一 `width/height: 16px`、`stroke-width: 1.75`，与编辑器其他 lucide 图标观感一致

## 5. 左栏搜索框过大

### 现状

`.editor-workspace-sidebar__search { min-height: 42px; padding: 0 10px; }` 视觉上显得占空间。

### 方案

- `min-height: 42px` → `36px`
- 图标和输入框垂直对齐保持紧凑
- 删除冗余的 `aria-label`（已有 `sr-only` 标签）
- 视觉重量降低但不破坏可用性

## 6. 左栏收起按钮样式（语雀式）

### 现状

当前 `EditorWorkspaceSidebar.tsx` 第 85 行渲染 `editor-sidebar-collapse-handle`，使用一个简单的圆形 icon 按钮，定位在侧栏内部右下角；视觉上与品牌区、搜索框、笔记目录挤在一起，缺少独立的边界感。

### 语雀参考特征

- 收起按钮位于左栏**右侧边界**，是一个独立于侧栏内容的小型触点
- 形状：竖向窄长方形（或带圆角的胶囊），左侧紧贴侧栏右边线
- 默认半透明或低对比，hover 时变实色高亮
- 内含箭头：侧栏展开时显示 `‹`（朝左，表示收起方向），收起后变成 `›`（朝右，表示展开方向）
- 点击区域比图标本身略大，方便鼠标捕捉

### 方案

#### 6.1 结构调整

在 `EditorWorkspaceSidebar.tsx` 中：

- 取消侧栏**内部**右下角的 `editor-sidebar-collapse-handle` 渲染位置
- 把收起按钮作为侧栏容器**最右边的独立 child**，绝对定位到 `right: -14px`（半悬出侧栏边缘）
- 收起状态下（`collapsed === true`）：仍渲染触发器，但放在 `.editor-left-navigation--collapsed` 的右边缘，让用户更容易发现"侧栏已收起"
- 按钮图标用 `lucide-react` 的 `ChevronLeft` / `ChevronRight` 切换（展开态显示 `ChevronLeft` 表示可收起，收起态显示 `ChevronRight` 表示可展开）
- 不用 `PanelLeftClose` / `PanelRightOpen`：语雀参考是**细箭头触点**，箭头更轻、更贴近侧栏边界，而 Panel 图标语义是"面板开合"，视觉偏重，放在细窄竖触点上不协调

#### 6.2 样式收敛到 token

在 `editor-tokens.css` 新增：

```css
.editor-sidebar-collapse-pin {
  position: absolute;
  top: 80px;            /* 避开品牌区和搜索框 */
  right: -14px;         /* 半悬出侧栏边界 */
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
}
.editor-sidebar-collapse-pin:hover,
.editor-sidebar-collapse-pin:focus-visible {
  opacity: 1;
  color: var(--product-text, var(--on-surface));
  background: var(--product-surface-strong, #fff);
  outline: none;
}
.editor-sidebar-collapse-pin svg { width: 16px; height: 16px; }
```

要点：

- 默认半透明，hover/focus 时变实，避免抢视觉焦点
- 不使用黑色粗框，与编辑器整体浅色 token 一致
- `right: -14px` 让按钮半悬出侧栏右侧，方便鼠标跨边界点击
- 收起状态下按钮位置自动对齐侧栏右边界（用 `data-collapsed` 状态切换）

#### 6.3 展开后的触发器样式

折叠状态下的 `editor-left-edge-trigger`（已存在于 `EditorWorkspaceSidebar.tsx` 第 33 行）保留，但视觉上统一为浅色细窄触点，宽度与收起态一致，方便用户发现。

## 7. 大纲与搜索框视觉二次收紧（验收后修订）

用户在 2026-08-12 第二轮验收后新增三项反馈，本节是修订方案。

### 7.1 搜索框整体仍偏大

**现状**：`.editor-workspace-sidebar` 用 `grid-template-rows: auto auto 1fr auto; gap: 18px; padding: 18px 14px;`，搜索框本身 `min-height: 36px` 虽已收紧，但品牌区/返回/搜索框/目录间各有 18px 间隔，整体视觉密度仍偏低。

**方案**：

- `.editor-workspace-sidebar` `gap: 18px` → `12px`
- `.editor-workspace-sidebar` `padding: 18px 14px` → `12px 12px`
- 搜索框 `min-height: 36px` 保持
- 笔记目录按钮 `min-height` 保持 34px（点击区域不变）

### 7.2 大纲入口重复（页头按钮 + 大纲自带隐藏按钮）

**现状**：`NoteEditorHeader.tsx:40` 有"打开大纲"按钮（用 `ListTree` 图标），同时我刚加的 `.editor-outline__hide` 也是控制大纲可见性。两入口重复，用户不知道用哪个。

**方案**：

- **删除** `NoteEditorHeader.tsx` 里的"打开大纲"按钮（`onToggleOutline` 链路）
- `NoteEditorShell.tsx` 中 `onToggleOutline={() => setShowOutlineDrawer((open) => !open)}` 改为 `undefined` / 删除（不再需要）
- 大纲可见性**完全交给大纲自己的小眼睛按钮**控制
- 窄屏（<1280px）走抽屉入口仍需要——保留一种入口：宽屏用小眼睛，窄屏抽屉入口另说（见 7.4）

### 7.3 大纲小眼睛交互

**现状**：刚加的大纲隐藏按钮用 `ChevronRight` 箭头，不符合"持续显示 vs 隐藏"语义。

**新方案**：用 lucide 的 `Eye` / `EyeOff` 图标，行为：

| 当前状态 | 按钮图标 | 含义 | 点击后行为 |
|---------|---------|------|-----------|
| `outlinePinned=true`（大纲**持续显示**） | `EyeOff`（有斜杠） | 当前大纲一直显示，点击进入隐藏模式 | 切换到 `outlinePinned=false`，按钮变 `Eye` |
| `outlinePinned=false`（大纲**隐藏**） | `Eye`（无斜杠） | 当前大纲被隐藏，hover 大纲区域时临时展开 | 切换到 `outlinePinned=true`（**持续显示**），按钮变 `EyeOff` |

关键约束：

- **不自动关闭**：在 `pinned=true` 状态，用户点击正文/标题/其他位置**不会**自动隐藏大纲；只有再次点击小眼睛才会隐藏
- **隐藏态临时显示**：保留现有 CSS 的 `.editor-outline[data-pinned="false"]:hover/focus-within` 行为（细条 hover 临时展开）
- **无斜杠 → 有斜杠 状态切换**：点击 `Eye`（无斜杠）→ 固定显示（`EyeOff`）

### 7.4 大纲"无感"显示（与语雀一致：三栏文档流）

**现状**：当前宽屏大纲是 `position: fixed; right: 18px; width: 210px; top: 176px;` —— **浮动在主内容之上**，视觉上"凸出来一块"，与编辑页主体分隔。

**目标（参照语雀截图）**：宽屏布局为**三栏独立文档流**，左中右三栏宽度对齐、顶部基线一致：

```
┌─────────┬──────────────────────────┬──────────┐
│ 左栏    │ 主编辑区                  │ 大纲     │
│ 220px   │ flex: 1                   │ 220px    │
│ sticky  │                          │ sticky   │
│ 0..vh   │                          │ 0..vh    │
└─────────┴──────────────────────────┴──────────┘
```

三栏特征：

- **顶部对齐**：三栏从页面顶部（`top: 0`）开始，与正文区**同一水平基线**，不是浮在右上角的偏移面板
- **同高布局**：每栏独立撑满可视区高度（`min-height: 100vh` 或 `height: 100vh` + `overflow-y: auto`）
- **视觉无感**：右栏与左栏、中栏**等宽对齐**，有相同的内边距与背景过渡，不"凸出来"
- **粘性定位**：右栏 `position: sticky; top: 0;` 让用户滚动正文时大纲跟随但只在视口内停留
- **响应式**：≥1280px 显示右栏；<1280px 右栏隐藏（用户可从其它入口打开抽屉）

**方案**：

#### 7.4.1 结构调整

把 `.editor-outline` 从 `.editor-rich-editor` 的 sibling 改回 document flow 的同级位置，但确保它在宽屏时**作为三栏布局的第三列**：

- 父容器：`.editor-layout-grid` 仍是 `[左栏 | 主编辑区]` 两列（保留现有 grid 契约 `editor-css-contract.spec.ts`）
- `.editor-layout-main` 内部从单列改为 flex 容器：`flex: 1; display: flex; flex-direction: row;`
- 在 `.editor-layout-main` 内部：`.editor-rich-editor` `flex: 1; min-width: 0;` 缩窄，`.editor-outline` 作为文档流子元素 `width: 220px; flex: none;`
- 大纲从 `position: fixed` 改为 `position: sticky; top: 0; align-self: flex-start; height: 100vh;`

#### 7.4.2 内部结构

- 大纲容器：`.editor-outline { position: sticky; top: 0; width: 220px; height: 100vh; display: flex; flex-direction: column; border-left: 1px solid var(--product-line, var(--border)); background: var(--product-bg, var(--bg)); }`
- 顶部从 `top: 176px` 改为 `top: 0`，与正文顶端对齐
- 主内容 `.editor-paper` 自动通过 flex 缩窄，正文区与大纲等高

#### 7.4.3 响应式

- ≥1280px：右栏显示（flex 容器内文档流列）
- <1280px：右栏隐藏（媒体查询 `display: none`），用户可从抽屉入口打开 `.editor-outline-drawer`

#### 7.4.4 实现约束

- 不改 `.editor-layout-grid` 主契约（`editor-css-contract.spec.ts` 精确断言 `grid-template-columns`）
- 只改 `.editor-layout-main` 内部结构为 flex，子层 `.editor-rich-editor` 与 `.editor-outline` 并列
- 窄屏响应式：把 `.editor-outline` 在 `@media (max-width: 1023px)` 中设为 `display: none`，与现有契约一致

### 7.5 验收

- 搜索框及其上方间隔合计 ≤ 32px（品牌区底 → 搜索框顶）
- 仅有一个大纲入口（大纲自带的小眼睛），无页头"打开大纲"按钮
- 大纲按钮为 `EyeOff` 时大纲持续显示，点击正文不自动关闭；切换为 `Eye` 时大纲隐藏，hover 区域临时显示
- 宽屏大纲与编辑页主体同一文档流，无浮动"凸出"感
- 窄屏抽屉入口仍可用

- 大纲在视口宽度 ≥ 1280px：右侧固定列
- 视口宽度 < 1280px：隐藏右侧大纲，页头大纲按钮打开抽屉
- 抽屉仍为移动端唯一入口
- 所有隐藏按钮/折叠按钮都支持键盘 focus + `aria-label`

## 8. 搜索框与大纲吸顶/颜色一致（验收后第二次修订）

用户在 2026-08-12 第三轮验收后新增四项反馈，本节是修订方案。

### 8.1 搜索框视觉上仍占满容器

**现状**：`.editor-workspace-sidebar` 用 `grid-template-rows: auto auto 1fr auto; gap: 12px; padding: 12px 12px;`。搜索框 `min-height: 36px`，但视觉上仍像"占了一个完整容器"。原因：

- grid 第三行 `1fr` 让"笔记目录"占满剩余空间——目录列表短时空白被推到底部，但视觉上搜索框所在行（auto）紧邻目录区，**搜索框上下各 12px gap/padding** 让它"视觉占满"。
- 搜索框自身 `padding: 0 10px; gap: 8px;`，仍有内部视觉留白。

**方案**：

- 搜索框 `min-height: 36px` → `32px`
- 搜索框 `padding: 0 10px` → `0 8px`
- 搜索框 `gap: 8px` → `6px`
- 搜索框 `font-size` 隐式继承 14px → 13px（与笔记目录条目字号一致）
- **删除 grid 第三行的 `1fr`**：`grid-template-rows: auto auto auto auto;` —— 笔记目录改为自然高度，不再撑满剩余空间，留白自然落到目录下方
- 笔记目录区改为 `min-height: 0`（grid 自然高度）

### 8.2 大纲顶部不超过工具栏

**现状**：`.editor-outline { position: sticky; top: 0; height: 100vh; }`，从**页面顶部**开始吸顶。但工具栏和页头在编辑区上方占据顶部空间，大纲紧贴页面顶端与工具栏顶部齐平，视觉上"超过工具栏那一行"。

**方案**：

- 大纲 `top: 0` → `top: 120px`（与工具栏底部对齐；120px 为页头+工具栏大致高度，若实际偏差可在 PR review 中调整）
- 大纲 `height: 100vh` → `height: calc(100vh - 120px)`（不超出可视区下方）
- 大纲在大纲区域内部用 `overflow-y: auto`，确保标题多时可滚动

### 8.3 大纲与编辑页颜色一致（去割裂感）

**现状**：大纲 `background: var(--product-bg, var(--bg))`，编辑页正文 `background: var(--bg)`，两者使用不同 fallback token。实际渲染时大纲可能与正文背景色差（如大纲略白、编辑页略灰），形成明显边界。

**方案**：

- 大纲 `background: var(--product-bg, var(--bg))` → `background: transparent`（透传父容器背景）
- 或与编辑页统一为 `background: var(--bg)`（显式相同）
- 删掉大纲左侧 `border-left`（无颜色差异则无须视觉切割）
- 大纲内部不设独立背景色，让它与编辑页共享同一块背景

### 8.4 大纲持续吸顶工具栏下方

**现状**：§8.2 已把 `top` 调到 120px，sticky 行为正确（用户滚到正文底部，大纲仍贴在工具栏下方）。但需要确认：sticky 在 `.editor-edit-row` 内能正常工作（父容器高度足够）。

**方案**：

- `.editor-edit-row` 确保 `align-items: flex-start;`（大纲顶部对齐父容器顶部，但 sticky 行为由 `top` 决定）
- 测试断言：滚动到正文底部时，大纲仍可见（DOM 仍在视口内）

### 8.5 验收

- 搜索框自身高度 ≤ 32px；上下不再有"占满容器"的视觉留白
- 笔记目录不撑满剩余高度，目录下方自然留白
- 大纲顶部不超过工具栏底（即大纲与工具栏底部对齐或在其下方）
- 大纲背景色与编辑页一致，无边界割裂
- 滚动到正文底部时，大纲仍可见
- 类型检查通过；测试通过；Lint 0 error；git diff --check 通过

- 编辑器专属样式（大纲、选择浮层）继续收敛到 `editor-tokens.css`
- 不新增与现有 Dialog/Drawer 重叠的组件
- 通用 `Button` 继续复用

## 9. UI 库边界

## 10. 验收

- 评论可成功添加（含中文/含冒号评论均返回 201）
- 评论表单提交成功后 `network` 请求 `status === 201`，UI 标记只在下一次 `load()` 后落地
- 选中文本后浮层只出现一个（不与 AI 续写重复）
- 浮层使用浅色 token 样式，无黑色粗框
- 大纲可滚动（标题数 > 20 时仍能看到滚动条）
- 大纲点击可平滑滚动到对应 heading（验证：监听 `editor:scrollToHeading` 事件被触发且 `editor.commands.scrollIntoView` 执行）
- 大纲抽屉在窄屏使用语雀样式
- 左栏搜索框高度 ≤ 36px
- 左栏收起按钮在展开时位于右侧边界，半悬出，hover/focus 时变实色高亮
- 收起状态下触发器与展开态按钮视觉风格一致（浅色细窄触点）
- **左栏整体视觉密度收紧**（gap 12px、padding 12px），搜索框及上方间隔合计 ≤ 32px
- **大纲入口唯一**：仅小眼睛按钮；无页头"打开大纲"按钮
- **大纲小眼睛交互**：EyeOff（持续显示）+ Eye（hover 临时显示）；pinned=true 时点击正文不自动关闭
- **大纲无感显示**：宽屏大纲与编辑页主体同一文档流，不"凸出"
- **搜索框高度 ≤ 32px**，笔记目录不撑满剩余高度
- **大纲顶部不超过工具栏底**：top 设为工具栏高度（如 120px），与工具栏底对齐
- **大纲背景色与编辑页一致**，无边界割裂（去 border-left 或统一 background）
- **大纲持续吸顶**：滚动到正文底部时大纲仍可见
- 类型检查通过；测试 144/144；Lint 0 error；git diff --check 通过

## 11. 文件改动清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `notes-frontend/src/lib/comments-key.ts` | 新建 | 评论幂等键生成 |
| `notes-frontend/src/components/collab/CommentsPanel.tsx` | 改 | 使用 `buildCommentIdempotencyKey` |
| `notes-frontend/src/components/editor/TiptapAiActions.tsx` | 改 | 暴露 AI 续写 button 给 BubbleMenu |
| `notes-frontend/src/components/editor/TiptapEditor.tsx` | 改 | BubbleMenu 整合 AI 续写；FloatingMenu 保留 |
| `notes-frontend/src/components/editor/NoteEditorShell.tsx` | 改 | 大纲点击改派发 `editor:scrollToHeading`；大纲结构改 |
| `notes-frontend/src/components/editor/EditorWorkspaceSidebar.tsx` | 改 | 收起按钮移至右边界悬出触点；折叠态触发器样式对齐 |
| `notes-frontend/src/styles/editor-tokens.css` | 改 | 新增大纲/BubbleMenu/抽屉/搜索框/收起按钮样式；搜索框高度 32px、目录自然高度、大纲 sticky top 与编辑页同背景色 |
| `notes-frontend/__tests__/comments-key.spec.ts` | 新建 | 单测幂等键生成 |
| `notes-frontend/__tests__/editor-outline.spec.tsx` | 新建 | 大纲滚动 + 跳转契约 |
| `notes-frontend/__tests__/editor-selection-popover.spec.tsx` | 新建 | BubbleMenu 整合后 AI 续写入口契约 |
| `notes-frontend/__tests__/editor-sidebar-collapse.spec.tsx` | 新建 | 收起按钮位置 + 状态切换契约 |