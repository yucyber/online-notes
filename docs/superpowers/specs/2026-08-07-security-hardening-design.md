# 安全加固、输入边界与质量治理设计 Spec

日期：2026-08-07

## 目标

基于《项目安全、重复逻辑与功能验收扫描报告-2026-08-07》的 P0/P1/P2 全部约 15 项问题，制定完整修复方案并执行。覆盖安全边界、输入边界、依赖治理、重构与质量治理四大领域。

## 关键决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| Yjs 房间 ACL | Room Ticket | y-websocket 无需连 MongoDB，解耦彻底 |
| JWT 存储 | HttpOnly Cookie | XSS 无法读取 token |
| HTTP 限流 | @nestjs/throttler + rate-limiter-flexible + Redis | 与现有 Redis 基础设施一致，支持分布式 |

## P0：安全修复

### 1.1 Yjs 房间 ACL — Room Ticket

**后端新增：**

- `POST /api/notes/:id/room-ticket` 在 `NotesController` 中新增，需 JWT Guard
  - 调用 `NoteAccessService.readScope(noteId, userId)` 查询笔记是否存在且可读
  - 若可读，用 `JwtService.sign()` 签发短时 room ticket（5 分钟过期），payload：`{ noteId, userId, role, exp }`
  - `role` 来自 ACL 检查：owner/editor → `writer`，viewer/公开读者 → `reader`
- 前端 `useTiptapCollab` 连接前先 `fetch('/api/notes/:id/room-ticket')` 获取 ticket
- WS 连接时 `params: { access_token: roomTicket }` 替代当前的用户 JWT

**y-websocket server.js 改造：**

- upgrade 阶段验证 ticket 签名（用 `YWS_JWT_SECRET || JWT_SECRET`）
- 从 URL 路径提取房间名 `note:<noteId>[:<versionKey>]`，解析出 noteId
- 校验 `ticket.noteId === noteId`（房间名必须与 ticket 中的 noteId 一致）
- 校验 `ticket.role`：`reader` 仅允许 Sync 读取，`writer` 允许写入（在 `wss.on('connection')` 中拦截 message 类型实现）
- 房间名格式校验：只允许 `note:<objectId>` 或 `note:<objectId>:<versionKey>` 格式，拒绝任意房间名

### 1.2 YWS 安全配置加固

- 生产环境（`NODE_ENV=production`）拒绝启动于 `YWS_AUTH_DISABLED=1`
- `new WebSocket.Server({ noServer: true, maxPayload: 10 * 1024 * 1024 })`（10MB 上限）
- 每客户端连接数限制：`maxConnsPerIp`（默认 10）
- 每房间连接数限制：连接时检查 `docs.get(docName).conns.size`，超过 `maxConnsPerRoom`（默认 20）时拒绝

### 1.3 JWT 存储收敛 — HttpOnly Cookie

**后端改造：**

- `auth.controller.ts` 的 `register` 和 `login` 改为 `@Res({ passthrough: true })`，设置 `Set-Cookie: notes_token=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
- 新增 `POST /api/auth/logout` — 清除 Cookie
- `jwt.strategy.ts` 的 `jwtFromRequest` 改为 `fromExtractors([fromAuthHeaderAsBearerToken(), (req) => req?.cookies?.notes_token])`
- `room-ticket` 接口从 Cookie 提取 userId（经 JWT Guard 后 `req.user.id`）

**前端改造：**

- `lib/auth.ts` 移除 `localStorage` 和 `document.cookie` 逻辑
- `getToken()` 改为通过 `GET /api/auth/me` 验证是否已登录（200=已登录，401=未登录）
- API client 移除 `Authorization` header，改用 Cookie 自动携带（`credentials: 'include'`，已有 Next.js rewrite 同域代理）
- Server Components 通过 `cookies()` 读取 `notes_token` 传给后端

### 1.4 HTTP 限流 — Redis + Throttler

- 安装 `@nestjs/throttler`
- `app.module.ts` 引入 `ThrottlerModule.forRootAsync`，使用 `rate-limiter-flexible` + Redis 后端
- 自定义 `ThrottlerGuard` 子类，按场景区分 key：
  - **登录**：`auth:login:ip:<ip>` + `auth:login:email:<email>`，分别 10 次/分钟和 5 次/分钟
  - **注册**：`auth:register:ip:<ip>`，3 次/小时
  - **AI**：`ai:user:<userId>`，30 次/分钟；`ai:user:<userId>:model:<model>`，10 次/分钟
  - **RUM collect**：`rum:collect:ip:<ip>`，60 次/分钟
- 在对应 controller 上使用 `@Throttle` 装饰器
- `rum.controller.ts` 的 `/report` 接口增加 `@UseGuards(AuthGuard('jwt'))` 管理鉴权

## P1：近期治理

### 2.1 依赖漏洞升级

逐项升级，每次升级后重跑全量验收，不做 `npm audit fix --force`。

- **后端**：`mongoose` ^8.0.4 → ^8.8.x；`ws`/`path-to-regexp`/`multer` 通过 `overrides` 收敛
- **前端**：`next` 14.2.x 最新 patch；`sharp` → 0.33.x；`axios` → ^1.7.x；其他传递依赖通过 `overrides` 收敛
- **y-websocket**：确认 `ws` ^8.18.3 和 `jsonwebtoken` ^9.0.2 无漏洞
- **根目录 ws**：检查来源，通过根 `package.json` overrides 收敛

每次升级后执行：`build` + `test:unit` + `type-check` + `lint` + `ci:test`。

### 2.2 Regex 搜索加固

`notes.service.ts:109-115` 的 regex 搜索改造：

- `NoteFilterDto.keyword` 增加 `@MaxLength(100)`
- regex 模式下对 keyword 做正则特殊字符转义：`keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`
- 保留 `text` 模式（`$text` 索引）作为安全默认选项
- 不改变现有 API 响应结构和前端调用方式

### 2.3 DTO 长度和数组上限

| 位置 | 新增限制 |
|------|---------|
| `CreateNoteDto.title` / `UpdateNoteDto.title` | `@MaxLength(200)` |
| `CreateNoteDto.content` / `UpdateNoteDto.content` | `@MaxLength(500000)` |
| `comments.controller.ts` create body | 新建 `CreateCommentDto`，`@IsString @MaxLength(10000)` text，`@IsInt` start/end |
| `comments.controller.ts` reply body | 新建 `CreateReplyDto`，`@IsString @MaxLength(10000)` text |
| `ai.controller.ts` 各 input | 新建带装饰器的 DTO 替代 interface，`@MaxLength(50000)` prompt |
| `ai.controller.ts` summary body | `@IsArray @ArrayMaxSize(50)` notes |
| `rum.controller.ts` collect body | 新建 `RumCollectDto`，`@IsString @MaxLength(50)` type/name，`@IsObject` meta |
| `knowledge-bases` 图谱节点/边 | `@ArrayMaxSize(500)` nodes/edges |

同时在 `main.ts` 设置 Express body limit：`app.use(express.json({ limit: '2mb' }))`。

### 2.4 移除 typescript.ignoreBuildErrors

- 删除 `notes-frontend/next.config.js:23` 的 `typescript: { ignoreBuildErrors: true }` 行
- 当前 type-check 已通过，移除后 build 应能正常通过
- 若 Windows 构建环境出现 EPERM 权限问题，在 CI 中单独执行 `tsc --noEmit` 作为门禁

### 2.5 y-websocket 独立部署

- 确认 `y-websocket/package.json` 依赖完整
- 新增 `y-websocket/README.md` 说明启动方式
- `DEPLOYMENT.md` 更新：明确使用自定义 `server.js`，启动命令 `node start.js`
- 新增 `y-websocket/scripts/smoke.js` 启动 smoke test（HTTP 存活 + 鉴权拒绝）

## P2：重构与质量治理

### 3.1 board/mindmap 共享访问辅助

- 新建 `notes-backend/src/modules/notes/resource-access.ts`
- 导出 `parseObjectId(id, label)`、`assertOwnedIds(ids, userId, model)`、`canReadSourceNote(noteId, userId, noteAccessService)`
- `BoardsService` 和 `MindmapsService` 引用共享函数，保留各自字段序列化逻辑

### 3.2 NoteEditorShell 保存/状态 Hook 拆分

分步拆分 `NoteEditorShell.tsx`（约 900 行）：

1. 抽 `useNoteSave(noteId, status)` — 统一普通保存和草稿保存
2. 抽 `useNoteMetadata(noteId)` — 管理分类树、标签、笔记元数据加载
3. 抽 `useEditorShortcuts(editor, handlers)` — 集中快捷键绑定

每步拆分后跑 `ci:test` 和 `type-check` 确保不回归。不在本次重构中重写 `EditorWorkspace` 组件。

### 3.3 auth.service.ts toAuthResponse 抽取

- 新增私有方法 `private toAuthResponse(user)`，统一返回字段
- P0 HttpOnly Cookie 改造后，`toAuthResponse` 不再返回 `token`，改为只返回 `user`，token 由 controller 层写 Cookie

### 3.4 分页工具统一

- 新建 `notes-backend/src/common/pagination.ts`
- 导出 `normalizePageSize(limit, max = 100, default = 20)` 和 `buildPageResult(items, total, page, limit)`
- 各 service 引用，统一默认值和上限，不改变现有 API 响应结构

### 3.5 前端 API 类型治理

- 在 `lib/api/client.ts` 上新增 typed helpers：`getTyped<T>(url)`、`postTyped<T>(url, body)`
- 优先处理 `notesAPI`、`authAPI`、`aiAPI` 三个高频模块
- 其余模块标记 TODO，后续迭代逐步收敛

### 3.6 taxonomy 共享校验

- 新建 `notes-backend/src/modules/taxonomy/taxonomy-ownership.ts`
- 导出 `assertOwnedObjectIds(ids, userId, model, label)`
- `CategoriesService` 和 `TagsService` 引用，保留各自独立 service

### 3.7 Lint warning 清理

- **hook 依赖遗漏（约 12 个）：** 补全依赖或添加 `useCallback`/`useMemo` 包裹
- **可访问性（约 8 个）：** 补充 `aria-label`、`role`、键盘事件处理
- 处理后 `npm run lint` 应为 0 warning

### 3.8 i18n 文案迁移

- 按 `ci:i18n` 报告的文件列表逐个迁移到 `t('key')` 调用
- 在 `messages/zh-CN.json` 和 `messages/en.json` 中添加对应 key
- 本次优先处理登录、Dashboard、编辑器三个区域，其余区域标记 TODO
- 迁移完成后 `ci:i18n` 应通过，设为发布门禁

### 3.9 embed 页面抽取

- 抽 `ResourceEmbedPage` 组件，接受 `loader` 和 `renderer` 配置
- `embed/boards/[id]` 与 `embed/mindmaps/[id]` 复用同一壳
- 仅做 UI 壳抽取，不制造复杂泛型

### 3.10 端到端验收脚本

- 新建 `notes-backend/tests/e2e/` 目录
- `auth.e2e.ts`、`acl.e2e.ts`、`collab.e2e.ts`、`rum.e2e.ts`
- 使用 MongoDB 测试实例，不依赖 mock
- 通过 `npm run test:e2e` 执行

## CORS 收敛

生产环境只允许明确的正式域名和受控 preview 域名：

- `main.ts` 中 `CORS_ALLOWED_PATTERNS` 在生产环境默认为空，需显式配置
- 开发环境保留 `^https://.*\.vercel\.app$` 默认值

## RUM 存储改进

- `RumService` 的进程内 Map 增加历史日期淘汰：只保留最近 7 天数据
- `/collect` 接口按 IP 限流（P0 已覆盖）
- `/report` 接口增加 JWT 管理鉴权（P0 已覆盖）

## 测试策略

- 每个修复项完成后立即跑对应的单元测试
- P0 安全修复完成后跑全量 `build` + `test:unit` + `type-check` + `lint` + `ci:test`
- Yjs ACL 修复完成后重新运行附录 A 的 smoke test 验证修复效果
- P2 的 E2E 脚本在所有修复完成后统一执行

## 执行顺序

1. P0 安全修复（1.1 → 1.2 → 1.3 → 1.4），每项完成后回归测试
2. P1 近期治理（2.1 → 2.2 → 2.3 → 2.4 → 2.5），每项完成后回归测试
3. P2 重构与质量治理（3.1 → 3.10），按依赖顺序逐项推进
4. 全量验收：重跑扫描报告中所有检查项，更新报告状态

## 不在本次范围

- 前端 API 类型治理的剩余模块（仅处理 notesAPI/authAPI/aiAPI）
- i18n 文案迁移的剩余区域（仅处理登录/Dashboard/编辑器）
- `EditorWorkspace` 组件重写
- AI provider live call 验证（需线上前置环境）
- MongoDB 真实事务/并发恢复验收
