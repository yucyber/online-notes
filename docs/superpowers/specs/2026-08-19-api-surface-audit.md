# 全量 API 表面审计与收口规格

## 审计目标

本规格对当前仓库的全部对外接口做静态交叉审计，范围包括：

- NestJS 20 个 Controller 中的 80 个 HTTP operation；
- Next.js 的 `/api/ai/[...path]` 代理；
- NestJS `/ws` WebSocket adapter 与独立 `y-websocket` 服务；
- 前端领域 API、页面调用方、DTO、Mongoose schema、OpenAPI 和现有测试。

本项目尚未上线，不保留旧数据、历史别名或仅为未来预留的接口。删除仍遵守“先建立替代路径和回归测试，再删除旧实现”的顺序。

审计结论分为四类：

- **保留**：当前有真实页面或运行链路使用；
- **迁移后删除**：当前调用的是冗余旧路径，先迁移到唯一规范路径；
- **直接删除**：仓库中没有调用方，也没有独立运行场景；
- **修复**：接口在用，但契约、权限或传输实现存在缺陷，不能当作冗余直接删掉。

## 总体结论

- 当前后端共有 **80** 个 HTTP operation，OpenAPI 记录 **79** 个；唯一未登记的是 `PATCH /api/users/me`。
- 建议删除 **13** 个 HTTP operation，最终保留 **67** 个：原先识别的 12 个无场景 operation，加上没有真实邮件投递链路支撑的公开邀请预览 `GET /invitations/:token`。
- 当前 NestJS `/ws` 没有 Gateway、事件处理器或前端连接方，应整体删除；独立 `y-websocket` 和 `POST /notes/:id/room-ticket` 必须保留。
- `scripts/check-api-contract.mjs` 只扫描聚合文件 `notes-frontend/src/lib/api.ts`，不会扫描实际请求所在的 `src/lib/api/*.ts`，并且只比较 path、不比较 method、参数或 schema。它当前显示的“仅 1 条漂移”不能证明接口契约完整。
- 后端没有 HTTP e2e/contract test。现有 Controller 级测试只直接覆盖 Semantic search、AI mindmap 和用户资料更新；其余主要是 Service 单元测试。接口删除前必须补最小契约测试。

## 全部 HTTP operation 清单

“调用”指当前仓库内存在实际页面或运行链路，不把只有 API wrapper、OpenAPI 或测试中的声明算作调用。

### AI（7）

| Operation | 当前调用 | 决策 | 说明 |
| --- | --- | --- | --- |
| `POST /ai/writer` | 无 | 直接删除 | 编辑器只使用流式 writer。 |
| `POST /ai/writer/stream` | 编辑器 AI 操作 | 保留 | Next AI 代理将 `writer` 转发到该路由。 |
| `POST /ai/mindmap` | 思维导图生成 | 保留 | `scenario` 被生成、扩展、优化流程消费。 |
| `POST /ai/mermaid` | 画板图表生成 | 保留 | `availableIcons` 被 prompt 消费。 |
| `POST /ai/knowledge-graph/proposal` | 知识库图谱生成 | 保留 | 直接由领域 API 调用。 |
| `POST /ai/pet` | AI 助手聊天 | 修复 | `conversationId` 前后端均未形成会话，应删除该字段及前端无效 localStorage 状态。 |
| `POST /ai/summary` | 笔记批量摘要 | 修复 | 当前发送完整 Note，服务只读取 `title/content/updatedAt`；改为严格的嵌套 DTO 和最小 payload。 |

### 审计、认证与用户（6）

| Operation | 当前调用 | 决策 | 说明 |
| --- | --- | --- | --- |
| `GET /audit/logs` | 活动日志页 | 修复并收窄 | 当前查询没有用户作用域，会向任意登录用户暴露全库日志；改为强制 `actorId=当前用户`，页面只保留 `page/size`。 |
| `POST /auth/register` | 注册页 | 保留 | 统一只返回规范 User。 |
| `POST /auth/login` | 登录页 | 保留 | 统一只返回规范 User。 |
| `POST /auth/logout` | 登出流程 | 修复 | 前端当前错误请求不存在的 Next `/api/auth/logout`，改走 backend API client。 |
| `GET /auth/me` | 无 | 直接删除 | 当前登录态展示来自登录结果和 localStorage。 |
| `PATCH /users/me` | 设置页 | 保留 | 补入 OpenAPI；移除没有写入入口的 `avatarUrl` 后，User 只暴露真实字段。 |

### 笔记（14）

| Operation | 当前调用 | 决策 | 说明 |
| --- | --- | --- | --- |
| `POST /notes` | 新建笔记、保存聚合摘要 | 保留 | 只接受单个 `categoryId`。 |
| `GET /notes` | 笔记列表、搜索 fallback | 保留并收窄 | 保留 `page/size`，删除 `limit/sortBy/sortOrder/cursor` 和响应 `nextCursor`；保留实际使用的筛选。 |
| `GET /notes/recommendations` | 推荐组件 | 保留 | 使用独立 DTO，不再继承列表分页/排序字段。 |
| `GET /notes/:id` | 编辑器详情 | 保留并收窄 | `categoryId/tags/userId` 统一为 string ID；删除客户端从不发送的 ETag/If-None-Match 条件读取。 |
| `PATCH /notes/:id` | 当前无调用 | 迁移后保留 | 作为唯一部分更新语义；前端从 PUT 迁移后启用，删除客户端从不发送的 If-Match 分支。 |
| `PUT /notes/:id` | 编辑器保存 | 迁移后删除 | 与 PATCH 调用同一 Service，且实际 payload 是部分字段。 |
| `DELETE /notes/:id` | 列表删除 | 保留 | 删除成功后统一失效列表缓存。 |
| `GET /notes/:id/acl` | 协作侧栏 | 保留 | owner 从 `note.userId` 派生，不持久化到 ACL。 |
| `POST /notes/:id/acl` | 无 | 直接删除 | 当前协作者只通过邀请加入。 |
| `PATCH /notes/:id/acl/:userId` | 协作侧栏角色修改 | 保留 | 仅允许 `editor/viewer`。 |
| `DELETE /notes/:id/acl/:userId` | 协作侧栏移除成员 | 保留 | owner 不进入 ACL，因此不能误删 owner。 |
| `POST /notes/:id/lock` | 编辑器挂载时调用 | 直接删除 | 调用方忽略结果，保存链路也从不校验该锁，因此不产生实际互斥能力。 |
| `DELETE /notes/:id/lock` | 编辑器卸载时调用 | 直接删除 | 与 lock 一并删除前端 effect、wrapper 和无效字段；Yjs/ACL 链路不变。 |
| `POST /notes/:id/room-ticket` | Yjs 协作编辑 | 保留 | 独立 y-websocket 的鉴权入口。 |

### 分类、标签与筛选器（16）

| Operation | 当前调用 | 决策 | 说明 |
| --- | --- | --- | --- |
| `POST /categories` | 分类管理 | 保留 | 分类树继续支持 `parentId`。 |
| `GET /categories` | 多页面分类字典 | 保留 | 输出只含 `id`，不含 `_id`。 |
| `GET /categories/:id` | 无 | 直接删除 | Service 内部按 ID 查询可保留。 |
| `PATCH /categories/:id` | 分类管理 | 保留 | 无别名。 |
| `DELETE /categories/:id` | 分类管理 | 保留 | 返回业务结果，由全局 interceptor 包装。 |
| `POST /tags` | 标签管理、编辑器新标签 | 保留 | 无别名。 |
| `GET /tags` | 多页面标签字典 | 保留 | 输出只含 `id`。 |
| `GET /tags/:id` | 无 | 直接删除 | Service 内部按 ID 查询可保留。 |
| `PATCH /tags/:id` | 标签管理 | 保留 | 无别名。 |
| `DELETE /tags/:id` | 标签管理 | 保留并收窄 | 前端只使用 remove；删除未使用的 `mode=reassign` 与 `targetId` 查询分支，重分配继续走 merge。 |
| `POST /tags/bulk` | 标签批量创建 | 保留 | 增加 DTO，替代裸 `@Body('names')`。 |
| `POST /tags/merge` | 标签合并 | 保留 | 增加 DTO。 |
| `POST /tags/sync` | 标签计数同步 | 保留 | 当前管理页使用。 |
| `POST /saved-filters` | 保存筛选器 | 保留 | `criteria` 改为严格 NoteFilter DTO，不再接受任意对象。 |
| `GET /saved-filters` | 筛选器选择 | 保留 | 删除旧多分类 criteria 兼容读取。 |
| `DELETE /saved-filters/:id` | 无 | 直接删除 | UI 没有删除筛选器场景，wrapper 也无人调用。 |

### 协作邀请、评论与版本（13）

| Operation | 当前调用 | 决策 | 说明 |
| --- | --- | --- | --- |
| `POST /invitations/notes/:id` | 协作侧栏邀请/重发 | 保留并收窄 | 固定 24 小时；删除 `ttlHours/requestId` body 字段，不再返回无人使用的明文 token。 |
| `GET /invitations/notes/:id` | 协作侧栏待接受成员 | 保留并收窄 | 只返回 pending invitation；响应不再携带恒定 `status`。 |
| `GET /invitations/mine` | 消息中心 | 保留并收窄 | 只列当前用户 pending invitation；删除未使用的 `status` 查询参数，不返回 token hash。 |
| `GET /invitations/:token` | 仅由当前 hash 跳转页使用 | 迁移后删除 | 仓库没有邮件发送器或外部邀请链接投递；消息中心改为用 invitation ID 直接接受。 |
| `POST /invitations/:token/accept` | 邀请接受页 | 迁移并保留路径 | 参数改为 invitation ID，继续强制校验登录用户邮箱与 inviteeEmail 一致。 |
| `DELETE /invitations/:token` | 协作侧栏撤销 | 迁移并保留路径 | 参数统一为 invitation ID，删除 token/hash 双形态查询。 |
| `GET /notes/:id/comments` | 评论侧栏 | 保留并收窄 | 保留选区 `start/end/intersects/limit`；删除未使用的 `blockId/versionId/cursor`。 |
| `POST /notes/:id/comments` | 评论侧栏 | 保留并收窄 | 只接受 `start/end/text`；删除未使用的 `anchor/blockId`。 |
| `POST /comments/:id/replies` | 评论侧栏 | 保留 | 使用严格 DTO。 |
| `DELETE /comments/:id` | 评论侧栏 | 保留 | 保留作者/笔记 owner 删除边界。 |
| `GET /notes/:id/versions` | 版本页 | 保留 | 删除手工 envelope。 |
| `POST /notes/:id/versions` | 手动快照 | 保留并收窄 | body 只含可选 `name`，requestId 只取 header。 |
| `POST /notes/:id/versions/:versionNo/restore` | 版本恢复 | 保留并收窄 | 不再接收空 body 或 body requestId。 |

### 知识库（9）

| Operation | 当前调用 | 决策 | 说明 |
| --- | --- | --- | --- |
| `POST /knowledge-bases` | 知识库页 | 保留 | 当前创建场景。 |
| `GET /knowledge-bases` | 知识库页 | 保留 | 当前列表场景。 |
| `PATCH /knowledge-bases/:id` | 无 | 直接删除 | wrapper 存在但无人调用。 |
| `DELETE /knowledge-bases/:id` | 无 | 直接删除 | wrapper 存在但无人调用。 |
| `POST /knowledge-bases/:id/notes` | 笔记批量加入知识库 | 保留 | 当前使用。 |
| `GET /knowledge-bases/:id/notes` | 知识库详情 | 保留 | 当前使用。 |
| `DELETE /knowledge-bases/:id/notes/:noteId` | 知识库移除笔记 | 保留 | 当前使用。 |
| `GET /knowledge-bases/:id/graph` | 知识图谱 | 保留 | 当前使用。 |
| `PUT /knowledge-bases/:id/graph` | 保存完整图谱 | 保留 | 这是完整替换语义，不与 PATCH 重复。 |

### 看板与思维导图（6）

| Operation | 当前调用 | 决策 | 说明 |
| --- | --- | --- | --- |
| `POST /v1/boards` | 画板新建、笔记插入 | 保留 | `_id` 是当前路由先生成 ID 的真实流程，不是旧兼容字段。 |
| `GET /v1/boards/:id` | 画板页 | 保留 | 当前使用。 |
| `PUT /v1/boards/:id` | 画板保存 | 保留并收窄 | 当前只保存完整 `content`；删除未使用的可选 `title` 更新字段。 |
| `POST /v1/mindmaps` | 思维导图新建、笔记插入 | 保留 | `_id` 同上。 |
| `GET /v1/mindmaps/:id` | 思维导图页 | 保留 | 当前使用。 |
| `PUT /v1/mindmaps/:id` | 思维导图保存 | 保留并收窄 | 当前只保存完整 `content`；删除未使用的可选 `title` 更新字段。 |

### 语义搜索、仪表盘、通知、健康和 RUM（9）

| Operation | 当前调用 | 决策 | 说明 |
| --- | --- | --- | --- |
| `GET /v1/semantic/search` | 语义搜索 | 保留并收窄 | 前端使用 `q/mode/page/limit/categoryId/tagIds`；删除未发送的 `threshold/tagsMode/categoriesMode`。 |
| `GET /v1/semantic/topics` | 仪表盘主题聚类 | 修复 | 删除手工 envelope，消除 `data.data.topics`。 |
| `POST /v1/semantic/topics/convert` | 主题转标签 | 保留 | 使用严格 DTO。 |
| `GET /dashboard/overview` | 仪表盘 | 保留 | category/tag 摘要是有意的读模型，不属于 Note 冗余嵌套。 |
| `GET /notifications` | 顶栏未读数、消息中心 | 保留并收窄 | 保留 `page/size/status`；删除未使用的 `type` 查询参数及对应索引。 |
| `PATCH /notifications/:id/read` | 消息中心 | 保留 | 当前使用。 |
| `GET /health` | 部署探针、网络状态 | 保留 | 返回业务 data，由 interceptor 包装；字段统一为 `serviceName`。 |
| `POST /rum/collect` | 根布局 RUM | 修复 | 当前存在 string beacon、额外 `ts`、丢弃 `value`，且 API client 会“直接发送 + dispatch 后再次发送”；统一单一 JSON keepalive transport 与 `{type,name,value?,meta?}`。 |
| `GET /rum/report` | 无 | 直接删除 | 内存报表没有页面、运维脚本或外部消费者。 |

## Next API 与 WebSocket

### Next.js AI 代理

`/api/ai/[...path]` 只允许 `writer/pet/mindmap/mermaid/summary`，五条均有前端调用。保留单一代理路由；其中 writer 只映射后端流式接口。知识图谱继续通过认证 API client 直连后端，因为它不在代理 allowlist 中。

### WebSocket

- 保留：`y-websocket` 服务、`NEXT_PUBLIC_YWS_URL`、`WebsocketProvider`、room ticket 和其测试。
- 删除：NestJS `JwtWsAdapter`、`main.ts` 中的 `/ws` adapter 安装、连接/消息 limiter 及仅服务该 adapter 的 Redis key。仓库没有 `@WebSocketGateway`、`SubscribeMessage` 或客户端连接它，它只会返回自定义 ACK，不承载 Yjs 协作。
- 修复：y-websocket 当前只执行 `jwt.verify`，没有校验 `type=room-ticket`、role、房间格式或 ticket.noteId 与 URL 是否一致；普通登录 JWT 会被当成可写连接。升级前必须同时校验这四项，并新增跨房间与普通 JWT 拒绝测试。
- 收窄：y-websocket 只接受 `/note:<noteId>?access_token=<room-ticket>`；删除没有调用方的 `token` 查询别名。
- 收窄：y-websocket 当前对任意 HTTP path 都返回 `200 okay`。改成明确的 `GET /health`，其他 path 返回 404，并同步 smoke/deployment 探针。

## 字段与模型收口

### 已确认删除

- Note/NoteVersion：`categoryIds`。
- Note 查询：`categoriesMode`、列表 `limit/sortBy/sortOrder/cursor`、响应 `nextCursor`。
- Note：`visibility=org`、持久化 ACL `owner`、ACL `addedBy/addedAt`、`editingBy/lockedAt`、`currentVersionId/versionCount`。
- Comment：`blockId/anchor` 及对应索引，列表 `versionId/cursor`。
- Invitation：`tokenHash/usedAt/requestId`；请求 `ttlHours/requestId`；列表响应中的恒定 status/hash。
- AuditEntry：从未写入的 `traceId/before/after`，以及与 `eventType` 重复且 UI 不读取的 `message`。保留 header `requestId` 作为链路关联字段。
- AiRun：从未传入的 `metadata`；内部完成方法不再返回无人消费的完整记录。
- AI Pet：`conversationId`。
- User/ACL response：没有上传或更新入口的 `avatarUrl`。
- Notification list：`type` 查询参数与 `idx_user_type_created` 索引。
- Tag delete：`mode/targetId` 查询参数。
- Board/Mindmap update：`title`。
- HTTP 条件请求：未被客户端使用的 `ETag/If-Match/If-None-Match` 代码与 CORS headers；并删除从未设置的 `X-Trace-Id` exposed header。
- Idempotency key：删除不存在的 `tenantId` 维度和随 ETag 一并失效的条件 header hash；评论的 `Idempotency-Key` 能力继续保留。
- 传输 header：`X-Search-ID` 只用于前端本地 RUM，不再发往后端；`X-Skip-Auth-Redirect` 改为 Axios 本地 config meta；无人读取的 `X-Idempotency-Applied` 不再暴露或返回。
- 前端：`RegisterData/ApiResponse/PaginationParams/PaginatedResponse/RoomTicketResponseDto`，以及迁移后无引用的 API wrapper。

### 必须保留

- 多标签 `tags` 与 notes list 的 `tagsMode`；这是当前筛选 UI 的真实功能。
- 分类树 `parentId`；它与“一篇笔记只能选一个分类”不冲突。
- Note `summary` 与 `embedding`；前者用于列表/知识库，后者用于语义检索。
- Board/Mindmap create 的客户端 `_id`；当前动态路由会先生成 ID，再创建同 ID 资源。
- Knowledge Graph 的 nodes/edges 嵌套；这是图谱资源本身，不是重复 DTO 包装。
- Dashboard Overview 的 category/tag 摘要对象；这是减少额外请求的页面读模型。

## 响应与资源标识

- 所有普通 Controller 只返回业务数据，由 `ApiEnvelopeInterceptor` 唯一包装 `{code,message,data,requestId,timestamp}`。
- Streaming AI 响应继续绕过普通 JSON envelope。
- Comments、Versions、Audit、Health、Semantic Topics 和 RUM 删除手工 envelope。
- 所有资源输出只使用 `id`，不再同时暴露 `_id`。
- 所有引用字段统一为 string ID。Note 列表和详情不再分别返回 string 与 populated object。
- `lean()` 查询必须显式走 serializer；前端随后删除 `id || _id`、object/string 和伪造 fallback ID。
- OpenAPI 的 User 从 `name` 改为 `displayName`，删除 `_id`；登录/注册响应不再声明实际不会返回的 token。
- 所有受保护 operation 在 OpenAPI 同时声明 CookieAuth 与 BearerAuth；公开 health、登录、注册和 RUM 明确 `security: []`。

## 邀请与通知边界

当前 `GET /invitations/mine` 返回 `tokenHash`，而 preview/accept 又把 64 位 hash 当成有效 bearer token；这等于把凭证交给客户端。建议收口为纯登录态流程：

1. pending invitation 以 `id` 暴露给匹配邮箱的已登录用户；
2. 接受接口按 invitation ID 查找，并再次校验登录用户邮箱；
3. 撤销接口按 invitation ID 查找，并校验 note owner；
4. 删除公开 preview、tokenHash 和明文 token 返回；
5. invitee 的 pending 列表已经是通知来源，不再额外写一条内容重复的 Notification；保留“邀请已被接受”给 inviter 的通知。

如果未来真正接入邮件服务，应另行设计一次性邮件 token，而不是保留当前没有投递方的半成品公开链路。

## 测试与契约门禁

### 当前覆盖缺口

- 无 Nest HTTP e2e test，无法验证路由、Guard、ValidationPipe、全局 interceptor 和真实响应 shape 的组合行为。
- OpenAPI gate 不扫描 `src/lib/api/*.ts`，不比较 HTTP method 和 schema。
- RUM 没有测试，因此 content-type、whitelist 和 value 丢失长期未被发现。
- Invitations、Notifications、Audit、Saved Filters、Categories、Tags、Health 缺少 Controller contract test。
- Audit 必须新增两个用户的数据隔离测试，禁止只验证“已登录即可访问”。
- y-websocket smoke 必须真实启动目标 server，并验证普通登录 JWT、错误 room、noteId 不匹配和 reader 写入均被拒绝；仅测试辅助函数不算链路覆盖。

### 实施门禁

1. 修复 contract checker：递归扫描领域 API 文件，以 `METHOD + normalized path` 比较 Controller/OpenAPI/client。
2. 为 67 个保留 operation 建立自动生成的 route inventory 断言，删除或新增路由都会显式失败。
3. 按模块补最小 e2e/contract test，至少验证鉴权、DTO whitelist、单层 envelope 和关键响应 ID。
4. 先迁移前端 PUT、邀请 ID、logout、RUM 等调用，再删除旧路由和字段。
5. 同步更新 `openapi.yaml`，确保 operation 数为 67，且 `PATCH /users/me` 已登记。
6. 运行后端完整测试/构建、前端完整测试/type-check/build、OpenAPI gate 和全仓 `rg` 残留扫描。

## 实施顺序建议

1. 契约门禁和最小 e2e 基线。
2. 单分类、Note serializer、PATCH 与缓存一致性。
3. ACL、邀请和评论模型收口。
4. 其他未使用 endpoint、DTO 参数、schema 字段与 wrapper 删除。
5. 单层 envelope、统一 `id` 和前端 fallback 删除。
6. RUM、logout 与通知重复修复。
7. OpenAPI、文档和最终全量验证。
