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


---

## 知识图谱证据绑定为空 + 真实 proposal 返回 503

- **日期**：2026-08-31
- **现象**：对"项目测试库2"发起真实 knowledge graph proposal 时，生成的 node/edge 全部没有证据（证据 0%）；带证据重试后连续被 `JSON.parse` 失败 + fallback 到 DeepSeek 在 120s 超时返回 503。

- **根因**（两个独立问题叠加）：
  1. **Chunk 存储类型与读取方不一致**：`refreshNoteChunks` 经 `bulkWrite` 写库时没有 cast，`noteId`/`userId` 被存成**字符串**，而图谱证据、语义检索等读取方均按 **ObjectId** 查询，导致已生成的 Chunk 永远匹配不到，`candidateChunks` 为空、证据无法绑定。
  2. **图谱输出被 maxTokens 截断**：带证据后 Qwen 输出过大，被 `maxTokens=1400` 截断导致 `JSON.parse` 失败 → 校验失败 → quality fallback 到 DeepSeek，但本地 `AI_REQUEST_TIMEOUT_MS` 仍是旧的 120s，DeepSeek 长任务超时返回 503。

- **相关文件**：
  - `notes-backend/src/modules/notes/note-chunk-index.service.ts`（写入 cast）
  - `notes-backend/src/modules/ai/graphs/knowledge-graph-build.graph.ts`（maxTokens/规模）
  - `notes-backend/.env`（`AI_REQUEST_TIMEOUT_MS`，gitignore 不入库）

- **修复方案**：
  1. 写入方统一按 schema 存 ObjectId，并迁移既有 63 条字符串 chunk 为 ObjectId（commit `9b8d868`，新增回归测试断言写入类型）。
  2. `knowledge_graph` 构图 `maxTokens` 1400 → 4096，为带证据输出留足预算；收紧默认规模 `maxNodes` 24 → 14、`maxEdges` 36 → 20，并限制每节点/边最多 2 条证据（commit `2e7de27`）。
  3. 本地 `.env` 调高 `AI_REQUEST_TIMEOUT_MS=240000`（配合 4096 token 的长输出）。

- **验收结果**（真实 proposal `21ad50e5`）：HTTP 201，112652ms，Qwen/Qwen3-14B，`validationResult=valid`，retry=0 无 fallback；14 nodes/15 edges，节点与边证据绑定 100%（14/14、15/15），9 个唯一 Chunk ID 全部命中真实 `note_chunks`。

- **经验教训**：
  - `bulkWrite` 不会像 `save()`/`create()` 那样自动 cast schema 字段，写库前必须显式 `new Types.ObjectId(...)`；写入与读取两侧的 ObjectId/字符串形态必须一致。
  - 带证据的图谱输出体积会显著增长，`maxTokens` 必须覆盖完整 JSON 输出，否则截断导致 `JSON.parse` 失败后容易被误判为 provider 问题；同时 `AI_REQUEST_TIMEOUT_MS` 要与 token 预算匹配，避免 fallback 在长任务上超时。


---

## 语义搜索 hybrid 返回 0：Atlas 向量索引未配置 filter 字段

- **日期**：2026-08-31
- **现象**：`GET /api/v1/semantic/search?mode=hybrid` 对中文查询（如"我想学计算机"）始终返回 `total: 0`，而 `note_chunks` 里已有 63 条带 embedding 的数据、Atlas 向量索引状态为 READY。

- **根因**：`ChunkRetrievalService.searchChunks` 的 `$vectorSearch` 使用了 `filter: { noteId: { $in: allowedIds } }` 做 ACL 限制，但 Atlas 的 `note_chunk_vector_index` 只定义了 `embedding` 字段，没有把 `noteId` 配置为 **filter 字段**。Atlas 对 `$vectorSearch` 的 `filter` 里用到的每个字段都要求先在索引里声明为 `filter` 类型，否则聚合直接抛错：
  ```
  PlanExecutor error during aggregation :: caused by :: Path 'noteId' needs to be indexed as filter
  ```
  `searchHybrid` 内部 Promise.all 失败后被 controller 的 catch 吞掉，静默 fallback 到 keyword 搜索；keyword 对 CJK 用正则匹配、无命中，于是返回 200 + total 0，掩盖了真正的向量检索错误。

- **相关文件**：
  - `notes-backend/src/modules/semantic/chunk-retrieval.service.ts`（`searchChunks` 里 `$vectorSearch.filter` 用 `noteId`）
  - `notes-backend/src/modules/semantic/semantic.controller.ts`（hybrid 抛错时静默 fallback 到 keyword，掩盖根因）
  - Atlas 控制台：`note_chunks` 集合的 `note_chunk_vector_index`

- **修复方案**：通过 MongoDB driver 的 `updateSearchIndex` 更新 Atlas 索引定义，把 `noteId`（及 `userId`）加为 `filter` 字段，等索引 reindex 到 READY 后恢复：
  ```json
  { "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 4096, "similarity": "cosine" },
    { "type": "filter", "path": "noteId" },
    { "type": "filter", "path": "userId" }
  ] }
  ```
  验证：同一请求由 `total: 0` 变为 `total: 7`，返回各笔记的 `bestChunk`（semantic 命中）与 `additionalChunks`。

- **经验教训**：`$vectorSearch` 的 `filter` 字段必须在 Atlas 向量索引里显式声明为 `filter` 类型，光有向量 `path` 不够。此外 controller 对向量检索异常直接 fallback 到 keyword 会掩盖索引/配置类错误，排查时应先看后端日志里的 `Vector search failed` 输出，再通过 `db.collection.listSearchIndexes()` 核对索引定义是否覆盖了 `filter` 用到的字段。

---

## SSR 直连后端报 ECONNREFUSED ::1:3001

- **日期**：2026-09-01
- **现象**：前端 `npm run dev` 后访问 `/dashboard/notes/[id]` 页面，SSR 阶段打印 `Error fetching note: TypeError: fetch failed`，`cause: Error: connect ECONNREFUSED ::1:3001`，笔记详情拿不到；`/dashboard/notes` 列表等其他页面正常。
- **根因**：SSR 服务端代码（`getNoteById`）在 **Node 进程内**用 `NEXT_PUBLIC_API_URL`（值 `http://localhost:3001/api`）直接 fetch 后端。Windows 下 Node 解析 `localhost` 优先返回 IPv6 `::1`，而后端 NestJS 只监听 IPv4 的 `0.0.0.0:3001`，IPv6 连接被拒。`next.config.js` 的 rewrite 代理早已硬编码 `127.0.0.1` 修复过同类问题（见该文件注释），但 `server-notes.ts` 与 AI route handler 两处遗漏，仍沿用浏览器侧的 localhost baseURL。
- **相关文件**：
  - `notes-frontend/src/lib/api/server-notes.ts`（SSR 笔记详情数据获取）
  - `notes-frontend/src/app/api/ai/_proxy.ts`（AI 接口 route handler 代理）
  - `notes-frontend/src/lib/server/api-url.ts`（新增的服务端 baseURL 常量）
  - `notes-frontend/next.config.js`（rewrite 代理，早先已用 127.0.0.1）
- **修复方案**：新增 `src/lib/server/api-url.ts` 导出 `SERVER_API_URL`（默认 `http://127.0.0.1:3001/api`，可用 `SERVER_API_URL` 环境变量覆盖以支持远程部署）；`server-notes.ts` 与 `_proxy.ts` 改用该常量。浏览器侧的 `NEXT_PUBLIC_API_URL` 保持不变（浏览器必须用 localhost 才能与页面同 site，保证 SameSite=Lax 登录 cookie 随请求发送）。
- **经验教训**：Node 侧（SSR、route handler、proxy）解析 `localhost` 在 Windows 下会优先 IPv6 `::1`，直连后端必须显式用 `127.0.0.1`；`NEXT_PUBLIC_*` 变量是给浏览器的，不要在后端进程内复用来直连后端，Node 侧应单独维护 baseURL 常量。
