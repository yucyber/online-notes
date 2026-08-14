# Dashboard 全站双主题交互原型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有“我的笔记”HTML 扩展为可切换九个视图、浅色／暗色主题和墨点助手的完整交互原型。

**Architecture:** 保持单文件静态原型，以共享 AppShell 承载导航、顶部栏、主题和 AI 助手；每个页面使用独立 `data-view` section，原生 JavaScript 负责 URL hash 路由、主题持久化和局部演示交互。编辑器视图复用同一语义 token，但采用沉浸式三栏工作区。

**Tech Stack:** HTML5、CSS3、内联 Lucide 风格 SVG、原生 JavaScript、Microsoft Edge headless 验收

## Global Constraints

- 仅修改 `docs/superpowers/mockups/notes-list-yuque-preview.html`，并新增本计划文档。
- 覆盖仪表盘、我的笔记、知识库、活动日志、分类管理、标签管理、消息中心、版本记录和编辑器九个视图。
- 浅色／暗色必须共享语义 token；暗色使用中性炭黑而不是偏蓝黑。
- 墨点助手不得使用机器人图标、绿色在线点或蓝紫渐变。
- 原型不得请求真实 API 或加载外部运行时依赖。
- 1440、1024、768、375px 下不得产生页面横向溢出。
- 所有图标按钮有可访问名称，移动端触控目标至少 44×44px，并支持 `focus-visible` 与 `prefers-reduced-motion`。

---

### Task 1: 建立多视图壳层与双主题路由

**Files:**
- Modify: `docs/superpowers/mockups/notes-list-yuque-preview.html`

**Interfaces:**
- Produces: `navigate(view)`, `applyTheme(theme)`, `[data-view]`, `[data-nav]`, URL hash 与 `localStorage` 主题状态

- [ ] **Step 1:** 将导航项改为带 `data-nav` 的按钮，并为消息、版本和编辑器补充可达入口。
- [ ] **Step 2:** 将当前笔记内容包装为 `<section class="view" data-view="notes">`，新增其余八个 view section。
- [ ] **Step 3:** 实现 `navigate(view)`，同步 active 导航、面包屑、页面标题、AI 上下文和 URL hash。
- [ ] **Step 4:** 实现 `applyTheme(theme)`，同步 `data-theme`、按钮 label 和 `localStorage`。
- [ ] **Step 5:** 用 Edge `--dump-dom` 验证页面标题、九个 view 与 hash 路由脚本均存在。

### Task 2: 完成八个管理页面视图

**Files:**
- Modify: `docs/superpowers/mockups/notes-list-yuque-preview.html`

**Interfaces:**
- Consumes: Task 1 的 `.view`、页面壳层和语义 token
- Produces: dashboard、notes、knowledge-bases、activity、categories、tags、notifications、versions 视图

- [ ] **Step 1:** 实现紧凑数字概览、最近笔记和继续写作的仪表盘。
- [ ] **Step 2:** 保留并适配“我的笔记”轻列表，增加进入编辑器和版本页入口。
- [ ] **Step 3:** 实现知识库目录／内容两栏与创建面板演示状态。
- [ ] **Step 4:** 实现中文日期分组活动时间线及筛选状态。
- [ ] **Step 5:** 实现分类层级列表、右侧编辑面板与健康提示。
- [ ] **Step 6:** 实现标签矩阵与仅在选择后出现的合并工具栏。
- [ ] **Step 7:** 实现统一消息收件箱与类型筛选。
- [ ] **Step 8:** 实现版本时间线、创建快照和查看差异演示状态。

### Task 3: 保持现有编辑器结构并统一暗色主题

**Files:**
- Modify: `docs/superpowers/mockups/notes-list-yuque-preview.html`

**Interfaces:**
- Consumes: 全局主题 token 和 `navigate(view)`
- Produces: 与现有 `EditorWorkspaceSidebar + NoteEditorHeader + TiptapToolbar + editor-paper + editor-outline` 对齐的只读主题演示

- [ ] **Step 1:** 复用现有编辑器左侧目录、中间页头／工具栏／正文和右侧大纲结构，不新增或移动控件。
- [ ] **Step 2:** 使用中性炭黑 token 完成编辑器暗色，覆盖正文、工具栏、代码块、引用和选区。
- [ ] **Step 3:** 实现返回笔记、目录切换和大纲收起演示交互。
- [ ] **Step 4:** 验证编辑器浅色／暗色主题切换时不存在独立蓝黑硬编码表面。

### Task 4: 完成墨点助手与响应式验收

**Files:**
- Modify: `docs/superpowers/mockups/notes-list-yuque-preview.html`

**Interfaces:**
- Consumes: 当前 view、全局主题与页面壳层
- Produces: `toggleInkAssistant()`, 上下文文案、快捷动作、模拟消息和移动底部抽屉

- [ ] **Step 1:** 用 44px `N ✦` 圆形入口替换机器人按钮与在线点。
- [ ] **Step 2:** 实现 360px 桌面悬浮面板和移动端底部抽屉。
- [ ] **Step 3:** 实现页面上下文、三个快捷动作、输入和模拟发送。
- [ ] **Step 4:** 在 1440、1024、768、375px 使用 Edge 渲染并检查无横向溢出。
- [ ] **Step 5:** 运行静态检查，确认九个 view、主题、hash、AI、focus、reduced-motion、无外部脚本和无 API。
- [ ] **Step 6:** 运行 `git diff --check` 并核对只修改目标原型和计划文档。
