# 笔记单分类与接口收口设计

> 全量接口复核见 [2026-08-19-api-surface-audit.md](./2026-08-19-api-surface-audit.md)。该审计覆盖 80 个 NestJS HTTP operation、Next AI 代理、WebSocket、OpenAPI、DTO、schema、前端调用方与测试缺口；实施时以其中的 67 个保留 operation 清单为准。

## 背景

笔记当前同时保存 `categoryId` 和 `categoryIds`，编辑器也同时提供“分类”和“附属分类”。这使同一个分类概念拥有两套字段、保存路径、计数逻辑和展示兼容分支。项目尚未上线，不需要迁移或兼容旧数据，因此直接收口为单分类模型。

## 目标

- 一篇笔记最多属于一个分类，只使用 `categoryId`。
- API 响应中的 `categoryId` 始终是 string ID，不再返回分类对象或额外的 `category` 别名。
- 删除所有多分类写入、附属分类 UI、旧数据兼容和重复计数逻辑。
- 分类保存成功后，返回笔记列表立即显示新分类；保留本次已实现的前后端列表缓存失效机制。
- 删除没有当前调用场景的接口、字段和兼容别名，统一请求方法、分页参数、资源 ID 与响应包。
- 清理前后功能等价：保留多标签、分类树、邀请协作、版本、评论、推荐和 owner 展示能力。

## 删除范围

### 前端

- 从 `Note`、`CreateNoteDto`、`UpdateNoteDto` 和 `NoteFilterParams` 删除 `categoryIds` 与 `categoriesMode`。
- 从新建页和编辑器删除“附属分类”区域、树形选择、相关 state、props、快照及自动保存字段。
- 从笔记 API 的请求构造、缓存 key、推荐上下文和响应归一化删除 `categoryIds`。
- 搜索栏只保留单个 `categoryId` 筛选，删除多分类选择与 any/all 模式。
- 列表分类文案只根据 `note.categoryId` 和分类字典解析，不再读取 `note.category` 或嵌套分类对象。

### 后端

- 从 Note schema 删除 `categoryIds` 字段和索引。
- 从 NoteVersion schema、快照与恢复逻辑删除 `categoryIds`。
- 从 create、update 和 filter DTO 删除 `categoryIds` 与 `categoriesMode`。
- 创建和更新时只校验 `categoryId`，不再合并单值与数组。更新请求中省略字段表示“不修改”，显式传 `null` 表示“清空分类”。
- 列表查询只按 `categoryId` 过滤，删除针对 `categoryIds` 的 `$in`/`$all` 分支，以及 ObjectId/String 双形态兼容查询。
- 列表、推荐和版本查询不再 select/project `categoryIds`。
- `NoteCounterService` 只接收单个 `categoryId`，删除收集和去重多分类 ID 的辅助逻辑。
- 审计字段白名单移除 `categoryIds`。

## 数据与接口形态

笔记读取与创建字段统一为：

```ts
categoryId?: string
```

更新接口需要区分“不修改”和“清空”，因此使用：

```ts
categoryId?: string | null
```

详情和列表接口均只返回 string ID。后端内部 schema 仍保存 MongoDB `ObjectId`，由 Mongoose JSON 序列化为 string。前端通过分类列表构建 `Record<categoryId, categoryName>`，展示时查表获取名称。

项目未上线，因此不编写数据迁移脚本，不读取或回填已有 `categoryIds`，也不保留兼容分支。

## 缓存一致性

- 笔记 create、update、delete 成功后清理前端列表缓存。
- 后端使用 Redis 列表 revision 使 owner 和协作者视角的旧列表同时失效。
- 后台重验证事件与当前页使用同一个规范化缓存 key，包含筛选、页码和页大小。

## 接口收口

### 笔记接口

- 更新笔记只保留 `PATCH /notes/:id`；删除实现重复且语义不符的 `PUT /notes/:id`，前端同步改用 PATCH。客户端从不发送 ETag 条件请求，因此一并删除 `ETag/If-Match/If-None-Match` 分支。
- 笔记列表分页只接受 `page` 与 `size`。删除列表接口中的 `limit` 别名；推荐接口使用独立 DTO，并继续用 `limit` 表示推荐数量。
- 删除语义搜索中没有被 Service 消费的 `categoriesMode`。
- 删除无调用方的 `GET /categories/:id`、`GET /tags/:id` 和 `POST /notes/:id/acl`。Category/Tag Service 的内部查询方法不因 Controller 路由删除而删除。
- 删除未使用的 `GET /auth/me` 和 `authAPI.getCurrentUser`。客户端当前用户展示继续使用登录结果和 localStorage；所有受保护接口仍由 JWT Cookie 在后端校验。

### 协作与可见性

- Note 的所有者只由 `userId` 表示。ACL 持久化角色只允许 `editor` 与 `viewer`，删除持久化的 `owner` 角色。
- ACL 查询响应继续返回一条派生的 owner 成员，用于协作侧栏展示；该 owner 不写入 ACL 数组。
- 删除 ACL 条目中没有读取方的 `addedBy` 与 `addedAt`。
- 可见性只保留 `private` 与 `public`。删除没有组织实体、成员关系和读取规则支撑的 `org` 值及 UI 选项。
- 删除 `editingBy`、`lockedAt`、lock/unlock 路由和前端调用。当前保存链路从未校验这两个字段，删除它们不改变实际并发编辑行为；Yjs 协作与 ACL 写权限继续生效。
- 删除 Note 中从未被读写的 `currentVersionId` 与 `versionCount`；版本功能继续以 NoteVersion 集合为唯一数据源。

### 响应与资源标识

- Controller 只返回业务数据，统一由 `ApiEnvelopeInterceptor` 包装 `{ code, message, data, requestId, timestamp }`。
- 删除 Comments、Versions、Audit、Health 中的手工响应包；删除 Semantic Topics 和 RUM 当前造成 `data.data` 的二次包装。
- API 资源统一输出 `id`，不同时暴露 `_id`。Note 的 `categoryId`、`tags`、`userId` 等引用统一输出 string ID。
- 对使用 `lean()` 的查询显式经过资源 serializer，避免依赖 Mongoose `toJSON` transform。前端在服务端契约统一后删除 `id/_id`、对象/string 的兼容 fallback。
- Dashboard Overview 保留面向展示的 category/tag 摘要对象；它是独立读模型，可避免仪表盘额外请求，不属于 Note 写模型的冗余嵌套。

### 前端 API 层

- 将现有 `@/lib/api` 过渡聚合层的调用迁移到各领域 API 模块，再删除重复别名导出。
- 删除没有引用的 `RegisterData`、`ApiResponse`、`PaginationParams`、`PaginatedResponse` 和 `RoomTicketResponseDto`。
- 登出改为通过配置了 backend baseURL 的 API client 调用 `POST /auth/logout`，成功或失败后都清理本地用户信息；不再请求不存在的 Next.js `/api/auth/logout` 路由。
- body 中不再接受与 `X-Request-ID` 重复的 requestId；审计关联统一使用 Header requestId。响应 envelope 仍保留 requestId。
- 现有 API contract gate 必须改为递归扫描 `src/lib/api/*.ts`，并比较 `METHOD + path`；当前脚本只扫描聚合导出文件，无法覆盖真实调用。

### 全量复核新增收口项

- 删除无调用场景的 `POST /ai/writer`、`GET /rum/report`、`DELETE /saved-filters/:id`、`PATCH/DELETE /knowledge-bases/:id`。
- 删除 NestJS 未承载业务消息的 `/ws` adapter；保留独立 `y-websocket` 与 room ticket 链路。
- 笔记列表删除未使用的 `sortBy`、`sortOrder`、`cursor` 和响应 `nextCursor`；固定使用当前 `updatedAt desc` 页码分页。
- Comments 删除未使用的 `blockId`、`anchor`、`versionId`、`cursor` 及对应索引。
- Invitation 改为登录态 invitation ID 流程，删除公开 preview、token/hash 双形态、`tokenHash`、`usedAt`、`ttlHours` 和持久化 requestId。
- AI summary 只接收 `title/content/updatedAt`，AI pet 删除未消费的 `conversationId`。
- RUM 使用严格 JSON keepalive payload，并把 `value` 传入统计服务；删除客户端额外 `ts`。
- AuditEntry 删除 `traceId/before/after/message`；AiRun 删除未使用的 `metadata`；User 删除无写入入口的 `avatarUrl`。
- `GET /audit/logs` 强制按当前 `actorId` 隔离，修复现有“登录后可读取全库审计记录”的权限缺口。
- y-websocket 必须校验 room-ticket 类型、role、房间名与 noteId；当前仅验证 JWT 签名会让普通登录 token 获得写连接。

## 功能等价与风险控制

| 清理项 | 当前事实 | 替代路径或保证 | 风险 |
| --- | --- | --- | --- |
| `categoryIds`/`categoriesMode` | 一篇笔记存在两套分类语义 | 单值 `categoryId`；多标签能力不变 | 中 |
| PUT 更新路由 | 与 PATCH 调用同一 Service | 前端先迁移到 PATCH，再删除 PUT | 低 |
| `limit` 列表别名 | 前端笔记列表使用 `size` | 推荐接口保留独立 `limit` | 低 |
| 未使用 GET/ACL 路由 | 当前仓库没有调用方，项目未上线 | 内部 Service 保留；邀请流程不变 | 低 |
| 持久化 ACL owner | 与 `note.userId` 重复 | owner 响应由 `userId` 派生 | 中 |
| `org` 可见性 | 没有组织模型或读取规则 | 保留 private/public | 低 |
| lock 字段与接口 | 更新逻辑不检查锁，前端忽略结果 | Yjs 与 ACL 继续负责协作和写权限 | 低 |
| 手工 envelope | 与全局拦截器重复，部分接口形成双层 data | Controller 返回业务数据 | 中 |
| `id/_id` fallback | 后端资源序列化不一致 | 先统一 serializer，再删除前端 fallback | 中 |
| 前端 API 聚合层 | 与领域 API 重复 | 逐文件迁移 import 后删除聚合层 | 中 |
| 登出相对路径 | 指向不存在的 Next.js 路由 | 改用 backend API client | 低，且修复现有缺陷 |

实施必须按“建立标准路径 → 加回归测试 → 迁移调用方 → 删除旧路径”的顺序执行。任何仍有生产代码调用的字段、端点或导出不得直接删除。

## 测试

- 类型检查保证前后端不再引用已删除字段。
- 单元测试覆盖创建、更新、删除时的单分类计数和分类归属校验。
- 列表查询测试确认只生成 `categoryId` 条件。
- 前端回归测试确认更新分类后不会命中旧列表缓存。
- 接口契约测试覆盖 PATCH 更新、单层 envelope、统一 `id` 和 logout backend 路径。
- ACL 测试覆盖 owner 派生展示、editor 写入、viewer 只读，以及非 owner 无法管理成员。
- 运行前端完整测试、类型检查和生产构建，以及后端完整单元测试和构建。
- 最后再次执行全仓 `rg`，确认生产代码中不存在已删除字段、路由和兼容 fallback。

## 非目标

- 不改变分类管理本身的父子层级；分类树仍可用于组织分类，但笔记只能选择其中一个节点。
- 不修改标签的多选能力。
- 不迁移或兼容旧数据库数据。
- 不新增组织系统、所有权转移或悲观锁；这些能力若需要，应分别设计而不是保留无效占位字段。
