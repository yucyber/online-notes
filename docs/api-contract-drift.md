# API 契约漂移登记表

记录前端 `notes-frontend/src/lib/api.ts` 实际调用、后端 NestJS controllers、`notes-backend/openapi.yaml` 三者之间的不一致。每条决策落在以下集合之一：

- `implement-now`：本阶段必须补最小实现。
- `hide-client-entry`：前端入口隐藏或返回明确「暂不可用」提示。
- `mark-planned-or-remove`：OpenAPI 标注 planned 或从契约移除。
- `document-openapi`：后端已经有，OpenAPI 补齐。

每行配套 `scripts/check-api-contract.mjs`，可重复运行；脚本不固化行数，输出实际 drift 数。

## Planned APIs

这些 API 有长期产品价值，但当前没有后端 controller。它们不应出现在 `notes-backend/openapi.yaml` 的正式 `paths` 中；等实现 controller、service 和调用入口后再重新纳入正式契约。

| Path | Reason | Re-entry condition |
| --- | --- | --- |
| `/api/v1/drafts/auto-save` | 服务端离线草稿保存对未来多端编辑有价值，但当前草稿仍是本地 `localStorage/IndexedDB` 能力。 | 增加 drafts controller/service 和前端调用入口。 |
| `/api/v1/drafts/sync` | 草稿冲突合并/同步对未来离线恢复有价值，但当前没有同步模型和后端实现。 | 增加同步冲突模型、controller、service 和 UI 恢复流程。 |
| `/api/v1/vector/upsert` | 单条向量写入可用于未来索引维护，但当前 embedding 写入是内部逻辑。 | 增加受保护的 vector controller 或管理任务入口。 |
| `/api/v1/vector/batch-upsert` | 批量向量写入可用于未来重建索引，但当前没有公开批处理 API。 | 增加明确的重建流程、权限边界和批处理服务。 |

## Discarded APIs

这些 API 已明确从当前契约中舍弃。

| Path | Reason | Replacement |
| --- | --- | --- |
| `/api/v1/network/status` | 没有后端 controller 或前端依赖，且与轻量连通性检查重复。 | `/api/health` 和前端 fallback ping。 |
| `/api/v1/network/diagnostics` | 没有当前产品工作流，随意暴露诊断接口还可能泄漏实现细节。 | 运维日志与定向健康检查。 |

| 路径 | 消费者 | 后端状态 | OpenAPI 状态 | 决策 | 验证方式 |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/assets/:id` | `notes-frontend/src/lib/api.ts` `assetsAPI.getById` | 缺失 | 缺失 | `hide-client-entry` | 前端入口需要返回明确不可用提示，避免静默失败。 |
| `/api/v1/assets/base64` | `notes-frontend/src/lib/api.ts` `assetsAPI.uploadBase64` | 缺失 | 缺失 | `hide-client-entry` | 前端入口需要返回明确不可用提示，避免静默失败。 |
| `/api/v1/embeds` | `notes-frontend/src/lib/api.ts` `embedsAPI.create` | 缺失 | 缺失 | `hide-client-entry` | Embed 创建路径返回明确不可用提示，而不是静默失败。 |
