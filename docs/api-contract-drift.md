# API 契约漂移登记表

记录前端 `notes-frontend/src/lib/api.ts` 实际调用、后端 NestJS controllers、`notes-backend/openapi.yaml` 三者之间的不一致。每条决策落在以下集合之一：

- `implement-now`：本阶段必须补最小实现。
- `hide-client-entry`：前端入口隐藏或返回明确「暂不可用」提示。
- `mark-planned-or-remove`：OpenAPI 标注 planned 或从契约移除。
- `document-openapi`：后端已经有，OpenAPI 补齐。

每行配套 `scripts/check-api-contract.mjs`，可重复运行；脚本不固化行数，输出实际 drift 数。

| 路径 | 消费者 | 后端状态 | OpenAPI 状态 | 决策 | 验证方式 |
| --- | --- | --- | --- | --- | --- |
| `/api/audit/logs` | `notes-frontend/src/lib/api.ts` `auditAPI.list` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖审计日志列表与分页参数。 |
| `/api/auth/login` | `notes-frontend/src/lib/api.ts` `authAPI.login` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖登录请求和 envelope 响应。 |
| `/api/auth/me` | `notes-frontend/src/lib/api.ts` `authAPI.me` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖当前用户读取契约。 |
| `/api/auth/register` | `notes-frontend/src/lib/api.ts` `authAPI.register` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖注册请求和错误码。 |
| `/api/categories` | `notes-frontend/src/lib/api.ts` `categoriesAPI` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖分类列表和创建契约。 |
| `/api/categories/:id` | `notes-frontend/src/lib/api.ts` `categoriesAPI` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖分类详情、更新和删除契约。 |
| `/api/comments/:id` | `notes-frontend/src/lib/api.ts` `commentsAPI.delete` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖评论删除契约。 |
| `/api/comments/:id/replies` | `notes-frontend/src/lib/api.ts` `commentsAPI.reply` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖评论回复创建契约。 |
| `/api/dashboard/overview` | `notes-frontend/src/lib/api.ts` `dashboardAPI` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖仪表盘概览契约。 |
| `/api/invitations/:id` | `notes-frontend/src/lib/api.ts` `invitationsAPI` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖邀请预览/撤销契约。 |
| `/api/invitations/:id/accept` | `notes-frontend/src/lib/api.ts` `invitationsAPI.accept` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖邀请接受契约。 |
| `/api/invitations/mine` | `notes-frontend/src/lib/api.ts` `invitationsAPI.mine` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖我的邀请列表契约。 |
| `/api/invitations/notes/:id` | `notes-frontend/src/lib/api.ts` `invitationsAPI.list/create` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖笔记邀请列表与创建契约。 |
| `/api/notes/:id` | `notes-frontend/src/lib/api.ts` `notesAPI` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖笔记详情、更新和删除契约。 |
| `/api/notes/:id/acl` | `notes-frontend/src/lib/api.ts` `aclAPI` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖 ACL 读取和创建契约。 |
| `/api/notes/:id/acl/:id` | `notes-frontend/src/lib/api.ts` `aclAPI` | 存在 | 缺失 | `document-openapi` | 实际参数为 `noteId/userId`；OpenAPI 覆盖 ACL 更新和删除契约。 |
| `/api/notes/:id/comments` | `notes-frontend/src/lib/api.ts` `commentsAPI.list/add` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖笔记评论列表和创建契约。 |
| `/api/notes/:id/lock` | `notes-frontend/src/lib/api.ts` `lockAPI` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖笔记锁定与解锁契约。 |
| `/api/notes/:id/versions` | `notes-frontend/src/lib/api.ts` `versionsAPI` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖版本列表和快照契约。 |
| `/api/notes/:id/versions/:id/restore` | `notes-frontend/src/lib/api.ts` `versionsAPI.restore` | 存在 | 缺失 | `document-openapi` | 实际参数为 `noteId/versionNo`；OpenAPI 覆盖版本恢复契约。 |
| `/api/notes/recommendations` | `notes-frontend/src/lib/api.ts` `notesAPI.recommendations` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖推荐笔记契约。 |
| `/api/saved-filters` | `notes-frontend/src/lib/api.ts` `savedFiltersAPI` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖保存筛选器列表和创建契约。 |
| `/api/saved-filters/:id` | `notes-frontend/src/lib/api.ts` `savedFiltersAPI.delete` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖保存筛选器删除契约。 |
| `/api/tags` | `notes-frontend/src/lib/api.ts` `tagsAPI` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖标签列表和创建契约。 |
| `/api/tags/:id` | `notes-frontend/src/lib/api.ts` `tagsAPI` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖标签更新和删除契约。 |
| `/api/tags/bulk` | `notes-frontend/src/lib/api.ts` `tagsAPI.bulkCreate` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖批量创建标签契约。 |
| `/api/tags/merge` | `notes-frontend/src/lib/api.ts` `tagsAPI.merge` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖标签合并契约。 |
| `/api/tags/sync` | `notes-frontend/src/lib/api.ts` `tagsAPI.sync` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖标签计数同步契约。 |
| `/api/v1/assets/:id` | `notes-frontend/src/lib/api.ts` `assetsAPI.getById` | 缺失 | 缺失 | `hide-client-entry` | 前端入口需要返回明确不可用提示，避免静默失败。 |
| `/api/v1/assets/base64` | `notes-frontend/src/lib/api.ts` `assetsAPI.uploadBase64` | 缺失 | 缺失 | `hide-client-entry` | 前端入口需要返回明确不可用提示，避免静默失败。 |
| `/api/v1/boards` | `notes-frontend/src/lib/api.ts` `boardsAPI.create`、`createBoard` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖画板创建契约和 409 冲突。 |
| `/api/v1/boards/:id` | `notes-frontend/src/lib/api.ts` `boardsAPI.get`、`getBoard`、`updateBoard` | 存在 | 缺失 | `implement-now` | 归属权限测试通过（任务 3），并补充 OpenAPI 条目。 |
| `/api/v1/embeds` | `notes-frontend/src/lib/api.ts` `embedsAPI.create` | 缺失 | 缺失 | `hide-client-entry` | Embed 创建路径返回明确不可用提示，而不是静默失败。 |
| `/api/v1/mindmaps` | `notes-frontend/src/lib/api.ts` `mindmapsAPI.create`、`createMindMap` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖思维导图创建契约和 409 冲突。 |
| `/api/v1/mindmaps/:id` | `notes-frontend/src/lib/api.ts` `mindmapsAPI.get`、`getMindMap`、`updateMindMap` | 存在 | 缺失 | `implement-now` | 归属权限测试通过（任务 3），并补充 OpenAPI 条目。 |
| `/api/v1/semantic/topics` | `notes-frontend/src/lib/api.ts` `semanticAPI.topics` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖主题列表契约。 |
| `/api/v1/semantic/topics/convert` | `notes-frontend/src/lib/api.ts` `semanticAPI.convertTopic` | 存在 | 缺失 | `document-openapi` | OpenAPI 覆盖主题转标签契约。 |
| `/api/v1/drafts/auto-save` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/drafts/sync` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/network/diagnostics` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/network/status` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/semantic/search` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 对齐现有 semantic routes，或补前端调用。 |
| `/api/v1/vector/batch-upsert` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
| `/api/v1/vector/upsert` | 仅 OpenAPI | 缺失 | 存在 | `mark-planned-or-remove` | OpenAPI 将该接口标为 planned，或从当前契约中移除。 |
