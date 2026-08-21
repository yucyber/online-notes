# 新建笔记编辑器统一设计

## 背景

`/dashboard/notes/new` 仍使用旧版独立页面，而已有笔记详情页已经迁移到新版编辑器视觉体系。旧页面还向通用 `TiptapEditor` 传入占位值 `noteId="new"`，导致协作 Hook 请求 `/api/notes/new/room-ticket`，后端因 `new` 不是合法 ObjectId 返回 400，并在 Next.js 开发环境触发错误浮层。

## 目标

- 新建页与当前笔记详情页使用一致的编辑器视觉语言、间距、颜色和控件。
- 未保存笔记只在本地编辑，不请求 room ticket，也不建立 WebSocket 或 IndexedDB 协作房间。
- 首次保存仍调用现有创建笔记接口；成功后跳转到真实笔记详情页，由详情页启用协作。
- 保留分类、标签、可见性和全屏编辑能力。

## 非目标

- 不重构已有笔记详情页的数据流。
- 不改变后端创建笔记或 room-ticket 接口。
- 不为未保存笔记增加多人协作。
- 不引入新的 UI 框架或状态管理库。

## 方案选择

### 采用：复用视觉组件，保留独立创建流程

新建页继续使用 `useNewNotePage` 管理创建前的表单状态，但页面结构改用现有编辑器的 header、toolbar、properties 和 CSS token。`TiptapEditor`/协作 Hook 增加明确的本地模式输入，使新建页不依赖伪造 ID。

优点是改动集中，不需要让面向已持久化资源的 `NoteEditorShell` 同时承担创建态和详情态两套复杂数据流。

### 未采用：先创建空白草稿再进入详情页

进入新建页即请求后端创建笔记，可以立刻获得真实 ID 并复用完整详情页，但会产生大量用户未保存的空白记录，也改变“点击保存才创建”的现有产品语义。

### 未采用：直接让 `NoteEditorShell` 支持 `id=null`

视觉复用最彻底，但 `NoteEditorShell` 内包含加载、ACL、评论、版本、自动保存和协作等已持久化笔记逻辑。为创建态增加大量条件分支，风险和回归面明显高于本次需求。

## 组件与数据流

### 新建页

- 使用新版编辑器容器类和现有 product/editor token，不再使用旧的渐变标题与大白卡片结构。
- 顶部提供返回、创建状态和保存操作。
- 标题与正文作为主要写作区域。
- 分类、标签和可见性收进紧凑的属性区域，避免长期占用正文上方的大块空间。
- 保存按钮和工具栏保存命令复用同一个 `handleSave`，防止产生两套创建逻辑。

### 本地编辑模式

- 给编辑器协作边界增加显式开关，而不是根据特殊字符串推断。
- 本地模式下不调用 `notesAPI.getRoomTicket`、不创建 `WebsocketProvider`，编辑器保持可写。
- 本地模式不使用以伪造 note id 命名的 Yjs/IndexedDB 房间，避免不同新建会话互相污染。
- 已有详情页默认行为不变，仍然启用协作和持久化。

### 首次保存

1. 用户填写标题、正文及属性。
2. 前端调用现有 `createNote`。
3. 创建成功后跳转 `/dashboard/notes/{note.id}`。
4. 详情页用真实 ID 请求 room ticket 并建立协作连接。
5. 创建失败时保留当前输入并显示可恢复的错误反馈。

## 错误与权限边界

- 标题为空时沿用现有校验，不发送创建请求。
- 元数据加载失败不影响正文编辑；页面展示现有错误信息。
- 新建态不存在远端 ACL，编辑权限由“本地创建表单”决定，不伪装成 writer room role。
- 只有创建成功后的真实笔记才进入后端 ACL 和协作鉴权流程。

## 测试与验收

- 回归测试证明本地编辑模式不会调用 `getRoomTicket`。
- 回归测试证明本地模式编辑器保持可写。
- 页面契约测试证明新建页使用新版编辑器结构，不再出现旧渐变标题/旧卡片结构。
- 创建测试证明保存仍提交标题、正文、分类、标签与可见性，并跳转到真实详情页。
- 运行前端相关测试、type-check、lint 和 `git diff --check`。
- 浏览器验证打开新建页时 Network 中无 `room-ticket` 请求、控制台无 Axios 400，宽屏和窄屏布局均正常。

## 预计改动范围

- `notes-frontend/src/app/dashboard/notes/new/page.tsx`
- `notes-frontend/src/app/dashboard/notes/new/useNewNotePage.ts`
- `notes-frontend/src/components/editor/TiptapEditor.tsx`
- `notes-frontend/src/components/editor/useTiptapCollab.ts`
- 必要的 editor/product 样式与前端回归测试

不修改后端。
