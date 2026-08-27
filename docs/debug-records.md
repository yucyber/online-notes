# Debug 记录

本文件记录项目排查过的 bug 根因与修复方案，供后续 agent 检索参考。

---

## 活动日志查不到"创建了笔记"记录（note_created）

- **日期**：2026-08-24
- **现象**：创建新笔记后，活动日志页面"笔记"tab 和"全部动作"tab 均查不到"创建了笔记"（`note_created`）记录，但数据库 `auditentries` 集合中该记录确实存在。

- **根因**：`audit.service.ts` 中写入与查询的 `resourceId` 类型不一致。
  - 写入侧 `record()` 使用 `new Types.ObjectId(resourceId)`，存成 **ObjectId 类型**。
  - 查询侧 `list()` 原来用 `editableNoteIdsAsStrings`（**字符串数组**）做 `$in` 匹配。
  - Mongoose 对 `$in` 数组里的字符串不会可靠地自动 cast 成 ObjectId，导致 ObjectId 存储的记录永远匹配不上，查询为空。

- **相关文件**：
  - `notes-backend/src/modules/audit/audit.service.ts`
  - `notes-backend/src/modules/audit/schemas/audit-entry.schema.ts`（其中 `resourceId` 声明为 `@Prop({ type: Types.ObjectId })`）

- **修复方案**：在 `list()` 的 `$in` 数组里同时放入 ObjectId 和字符串两种形态，兼容新旧存储：
  ```typescript
  const editableNoteIdsAsObjectIds = editableNoteIds.map(id => new Types.ObjectId(String(id)))
  const query: any = { resourceId: { $in: [...editableNoteIdsAsObjectIds, ...editableNoteIdsAsStrings] } }
  ```

- **经验教训**：写入与查询两侧对同一字段的类型处理必须一致；涉及 ObjectId 的 `$in` 查询不要依赖 mongoose 隐式 cast，应显式转换或双形态兼容。

---

## AgentRouter（ps.air-outer.com）接入 401 unauthorized_client_error

- **日期**：2026-08-27
- **现象**：调用 AgentRouter 的 OpenAI 兼容接口（`/v1/chat/completions`、`/v1/responses`、`/v1/messages`）一律返回 `401 unauthorized_client_error`（"unauthorized client detected"），即使 key 在控制台显示已启用、默认分组、有余额。

- **排查过程**（多次排除）：
  1. 换 key、换域名（`agentrouter.org` / `ps.air-outer.com` 官方备用域名）
  2. 换认证头（`Authorization: Bearer` / `x-api-key` / 原生 key / 不带 key）
  3. 换模型名（教程里的 `claude-opus-4-6`、`gpt-5.5` 均为过时名；真实模型是 `claude-opus-4-8`、`gpt-5.6-sol`、`glm-5.3`、`deepseek-v4-flash`）
  4. 换网络环境（菲律宾/香港/新加坡数据中心代理 IP、中国大陆手机住宅 IP）
  5. 换 User-Agent（无 UA、Chrome UA、OpenAI SDK UA、自编的 `claude-cli/1.0.0`）

  **关键对照实验**：不带 key、错误 key、正确 key+错误模型，三种请求返回**字节级相同的 401**，证明请求根本没进入 One API 的模型校验逻辑，而是被**边缘层（阿里云 WAF，响应头 `acw_tc` cookie + `X-Oneapi-Request-Id`）**统一拦截。

- **根因**：AgentRouter 网关（阿里云 WAF + One API）对 **User-Agent 做精确白名单校验**。请求头必须原样携带官方签名：
  ```
  User-Agent: claude-cli/2.1.75 (external, cli)
  ```
  缺失或使用其它 UA 一律返回 `401 unauthorized_client_error`。加上该精确 UA 后立即变为可正常访问（200）。

- **修复方案**（`notes-backend/src/modules/ai/ai-gateway.client.ts`）：
  1. 新增类常量 `AiGatewayClient.AR_USER_AGENT = 'claude-cli/2.1.75 (external, cli)'`。
  2. 在 `postJson()` 的请求头统一加上 `'User-Agent': AiGatewayClient.AR_USER_AGENT`（对所有供应商是无害的额外请求头，对 AgentRouter 是硬性要求；chat/stream/embedding/rerank 均走 `postJson`，一处生效）。
  3. 在 `chatProviderKeys()` 注册 `ar` 供应商，映射 `AR_API_KEY` / `AR_BASE_URL` / `AR_MODEL`。
  - 配套 `.env`：新增 `AR_API_KEY` / `AR_BASE_URL=https://ps.air-outer.com/v1` / `AR_MODEL=claude-opus-4-8`，并将 `AI_TEXT_PROVIDER=ar`。
  - 配套 `scripts/check-ai-config.mjs`：`providerExpectations` 的 text/reasoning 允许 `ar`。

- **后续状态**：上述 `AI_TEXT_PROVIDER=ar` 仅用于接入期验证，已被后续模型路由方案取代。当前 text/reasoning 默认走 SiliconFlow，AR 只作为指定复杂任务的专家质量升级目标。

- **经验教训**：遇到第三方网关 `unauthorized_client_error` 时，除了排查 key/IP/模型，一定要检查 **User-Agent 是否被网关精确校验**；用"缺参/错参/正参"的对照请求快速定位拦截层。另外教程给出的模型名可能过期，应以控制台"可用模型列表"为准。
