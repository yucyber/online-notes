# 我的笔记页黑灰简约原型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“我的笔记”静态原型改造成包含左侧导航、顶部栏、主列表和辅助栏的黑灰简约 Dashboard 工作台，并完成多视口交互验收。

**Architecture:** 保持单文件静态原型，不引入构建工具或外部运行时依赖。HTML 负责完整语义结构，CSS 变量统一浅色与深色令牌、响应式布局和交互状态，少量原生 JavaScript 负责侧栏、移动抽屉、主题和筛选控件的演示交互。

**Tech Stack:** HTML5、CSS3、内联 Lucide 风格 SVG、原生 JavaScript、浏览器自动化验收

## Global Constraints

- 仅修改 `docs/superpowers/mockups/notes-list-yuque-preview.html`。
- 延续冷灰白、深石墨和少量雾蓝的 Calm Minimal 视觉，不使用渐变、大面积品牌色、厚阴影或卡片抬升。
- 图标使用线性 SVG，不使用 emoji。
- 1024px 以下侧栏变为覆盖抽屉，768px 以下辅助栏移动到主列表之后，375px 下无横向溢出。
- 图标按钮必须有可访问名称，移动端点击区域至少 44×44px，并支持 `focus-visible` 与 `prefers-reduced-motion`。
- 不修改真实 React 页面、API、权限或业务行为。

---

### Task 1: 重建完整工作台结构与黑灰视觉

**Files:**
- Modify: `docs/superpowers/mockups/notes-list-yuque-preview.html`

**Interfaces:**
- Consumes: 已确认的 `docs/superpowers/specs/2026-08-13-notes-page-black-gray-prototype-design.md`
- Produces: `.app-shell`、`.sidebar`、`.workspace`、`.topbar`、`.notes-layout`、`.notes-list` 与 `.assistant-rail` 静态结构

- [ ] **Step 1: 记录修改前基线**

运行：

```powershell
Select-String -Path 'docs/superpowers/mockups/notes-list-yuque-preview.html' -Pattern '<aside class="sidebar"|class="topbar"|emoji|prefers-reduced-motion'
```

预期：缺少完整工作台结构和 reduced-motion 规则，旧原型仍是孤立 `.page` 布局。

- [ ] **Step 2: 替换设计令牌和页面框架**

在单文件中建立浅色为主的语义变量：`--bg`、`--sidebar-bg`、`--surface`、`--surface-muted`、`--line`、`--text`、`--text-secondary`、`--muted`、`--accent`、`--focus`、`--danger`、`--shadow-float`。将根结构改为：

```html
<div class="app-shell" id="appShell">
  <aside class="sidebar" id="sidebar">...</aside>
  <div class="mobile-scrim" id="mobileScrim"></div>
  <main class="workspace">
    <header class="topbar">...</header>
    <div class="content-wrap">
      <section class="notes-main">...</section>
      <aside class="assistant-rail">...</aside>
    </div>
  </main>
</div>
```

侧栏渲染真实项目中的品牌、主导航、管理分组和底部设置；顶部栏渲染菜单、面包屑、主题、通知和账户入口。

- [ ] **Step 3: 重绘标题、控制带、列表和辅助栏**

将主操作改为黑色“新建笔记”，批量管理保持轻量；搜索与筛选使用紧凑灰阶控制带。列表使用顶部线与行分隔，操作按钮使用内联 SVG，hover/focus 显示纸张式预览。将两个推荐卡片合并为带左侧细线的 `.assistant-rail`。

- [ ] **Step 4: 添加交互与响应式规则**

添加以下行为：

```javascript
sidebarToggle.addEventListener('click', toggleSidebar)
mobileScrim.addEventListener('click', closeMobileSidebar)
themeToggle.addEventListener('click', toggleTheme)
```

桌面收起通过 `.app-shell.sidebar-collapsed` 控制；小于 1024px 使用 `.sidebar.mobile-open` 和遮罩；小于 768px 将内容改为单栏；小于 520px 精简 meta、换行工具栏和标题操作。补充 `:focus-visible`、44px 触控目标和 `prefers-reduced-motion`。

- [ ] **Step 5: 运行静态结构检查**

运行：

```powershell
Select-String -Path 'docs/superpowers/mockups/notes-list-yuque-preview.html' -Pattern 'class="sidebar"','class="topbar"','class="assistant-rail"','aria-label=','prefers-reduced-motion','mobile-open','sidebar-collapsed'
```

预期：所有关键结构、可访问名称和响应式状态均存在。

### Task 2: 浏览器视觉与交互验收

**Files:**
- Verify: `docs/superpowers/mockups/notes-list-yuque-preview.html`

**Interfaces:**
- Consumes: Task 1 生成的单文件工作台原型
- Produces: 1440、1024、768、375px 的布局与交互验证结果

- [ ] **Step 1: 在浏览器打开本地原型**

打开绝对路径对应的本地文件，确认页面标题为“我的笔记 · 黑灰简约工作台原型”。

- [ ] **Step 2: 验证 1440px 桌面布局**

确认左侧栏、顶部栏、主列表与右侧辅助栏同时可见；点击侧栏按钮后左栏收起、内容扩展，再次点击可恢复。检查列表 hover 预览、操作按钮、主题切换和分页状态。

- [ ] **Step 3: 验证 1024px 与 768px 布局**

确认侧栏以抽屉出现且遮罩可关闭；768px 下辅助栏移动到列表之后，标题操作与筛选控件不重叠。

- [ ] **Step 4: 验证 375px 与键盘可达性**

确认页面无横向滚动，按钮点击目标可用；使用 Tab 导航检查菜单、主按钮、筛选、笔记操作、分页与右侧推荐项均有清晰焦点。

- [ ] **Step 5: 检查控制台并记录结果**

预期：控制台无 JavaScript 错误；所有视口无遮挡、溢出或不可操作控件。若出现问题，回到 Task 1 做最小 CSS/JS 修正并重复对应视口检查。

### Task 3: 最终静态复核

**Files:**
- Verify: `docs/superpowers/mockups/notes-list-yuque-preview.html`

**Interfaces:**
- Consumes: 浏览器验收通过的原型
- Produces: 可交付的单文件静态原型

- [ ] **Step 1: 检查原型没有外部业务依赖**

运行：

```powershell
Select-String -Path 'docs/superpowers/mockups/notes-list-yuque-preview.html' -Pattern '<script[^>]+src=','fetch\(','axios','/api/'
```

预期：没有外部脚本、网络请求或真实业务 API。

- [ ] **Step 2: 检查变更范围**

运行：

```powershell
git diff -- 'docs/superpowers/mockups/notes-list-yuque-preview.html'
git status --short
```

预期：本次实施只新增或修改指定原型及本次设计/计划文档，不覆盖用户已有的其他工作区改动。
