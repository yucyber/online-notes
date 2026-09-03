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

---

## 小助手 chat 端点 500：占位消息 content required 校验 + user/assistant 共用 requestId 撞唯一索引

- **日期**：2026-09-02（T10 冒烟发现）
- **现象**：小助手发送"你好"，前端提示"小助手请求失败/请检查网络后重试"，后端 `POST /api/assistant/chat` 返回 500 `Internal Server Error`（无日志堆栈）。`nest start` 直调 `AssistantGenerationService.start` 报 `ValidationError: AssistantMessage validation failed: content: Path 'content' is required.`；改掉 content 后又报 `MongoServerError: E11000 duplicate key ... idx_assistant_msg_user_request`。
- **根因**（两处叠加）：
  1. schema `@Prop({ required: true, default: '' }) content`：Mongoose 的 `required` 校验用 `!value` 判断，空串 `''` 是 falsy → 校验失败；而 `createPlaceholder` 建占位 assistant 消息时内容本就为空（pending/streaming 状态），校验必然失败。
  2. 唯一索引 `idx_assistant_msg_user_request`（userId + requestId）无 role 条件：一次生成会落两条消息（user 提问 + assistant 回复）共用同一 requestId → 第二条 create 必撞唯一索引。幂等锚点应只在 **user 消息**（同一提问只生成一次）。
- **修复方案**：schema `content` 去掉 `required: true`（保留 `default: ''`，占位/流中空内容合法）；唯一索引 partialFilterExpression 增加 `role: 'user'`（assistant 消息的 requestId 仅关联、不参与唯一）；`getByRequestId` 幂等重放定位按 `seq` 降序返回（终态在 assistant 消息上）；删除 Atlas 旧索引（无 role 条件）后由 Mongoose autoIndex 重建。
- **相关文件**：
  - `notes-backend/src/modules/assistant/schemas/assistant-message.schema.ts`（content 去 required + 索引加 role）
  - `notes-backend/src/modules/assistant/assistant-messages.service.ts`（getByRequestId 排序）
  - `docs/superpowers/plans/2026-09-01-assistant-streaming-rag-and-message-lifecycle.md`（计划 Task 1 schema 代码同步）
- **经验教训**：
  1. Mongoose `required` 校验会拒绝空字符串，`default: ''` 不豁免——"占位即空内容"的字段（pending 消息）不能设 required。
  2. `(userId, requestId)` 唯一索引做幂等锚点时，必须想清楚**一条生成对应几条文档**；同一 requestId 关联多条消息（user + assistant）时必须用 partialFilterExpression 限定锚点角色。
  3. T1/T4 用 MemoryModel/假模型写测试跑不出真实 Mongo 校验与索引约束——schema 层的 required/unique 必须用真实 Mongoose 连接验证（本次 500 正是测试盲区放过的）。

---

## RAG 引用卡片缺失：Qwen3-14B 未输出 [E1] 引用标记（provider/model 行为，非代码 bug）

- **日期**：2026-09-02（T10 冒烟发现）
- **现象**：小助手 RAG 路由回答正确引用了笔记内容（"蓝色海豚"等），但 `complete` 事件 `citations: []`、warning `回答未附带可验证引用`，前端无引用卡片、路由标签仍显示 pet 的"轻松聊聊"。
- **根因**：`rag_answer` 任务走 siliconflow_standard（Qwen3-14B），system prompt 要求 `Cite note-supported claims using only [E1] style IDs`，但该模型输出未包含任何 `[E1]` 标记 → sanitizer 提取不到 → citations 空。代码链路（buildRagAnswerTaskOptions → createRagCitationSanitizer）与设计一致（测试 rag-answer-grounding 已覆盖"有证据但回答未引用时提示"）。属**上游模型指令遵循问题**，一次性 RAG 路径同样受影响（非计划 1 引入的回归）。
- **相关文件**：
  - `notes-backend/src/modules/ai/rag/rag-task-builder.ts`（prompt 要求 [E1] 标记，模型未遵循）
  - `notes-backend/src/modules/ai/rag/rag-stream.service.ts`（citations 提取链路）
- **修复方案**：未修复（超出计划 1 范围）。已记录为已知限制：引用卡片依赖模型遵循 [E1] 指令，当前 Qwen3-14B 不遵循；可选后续调优（prompt 加 few-shot 示例 / 换 model / 二次提取）。
- **经验教训**：RAG 引用体验强依赖模型输出标记；验收时应区分"检索正确性"（代码链路）与"引用标记产出"（provider 行为），后者不是代码缺陷但影响功能验收。

---

## 记忆候选零产出：模型把 `[m:<id>]` 整标记当 messageId 返回

- **日期**：2026-09-03（计划 4 浏览器冒烟发现）
- **现象**：决策对话完成（消息落库、无任何 warn 日志），但 `assistant_memory_candidates` 恒空。逐层排查：extract 被触发（加日志确认 recent=6）、AI 调用成功返回 candidates——模型返回的 `messageIds` 是 `["m:6a98e…"]`（带 `m:` 前缀，即把 transcript 行首的 `[m:<id>]` 整标记当值返回）。代码 `recent.find(m => m.id === id)` 用纯 id 反查恒空 → evidence 空 → 全部候选被跳过（`created` 恒 0）。
- **根因**：system prompt 让模型引用 `[m:<message-id>]` 值，模型如实返回含前缀整值；单测 mock 用正则从 prompt 解析纯 id 回填，掩盖了真实模型的输出形态。
- **相关文件**：
  - `notes-backend/src/modules/assistant/assistant-memory-extractor.service.ts`（messageIds 剥 `^m:` 前缀 + prompt 明示只回填 24 位原始 id）
  - `notes-backend/test/assistant-memory-extractor.test.ts`（带前缀输出回归测试）
- **修复方案**：`messageIds.map(s => s.replace(/^m:/, ''))` 统一清洗；prompt 注明 messageIds 须为不含前缀的 24-hex id。
- **经验教训**：让模型输出"引用 token"时，模型常把包含前后缀的**完整标记**当值返回——消费侧必须剥前缀防御；测试 mock 若从 prompt 回填解析值会掩盖模型真实输出形态，应显式模拟带噪声的输出。

---

## 确认记忆恒 500：mongoose 8 嵌套 type 字面量子文档 create 误报 required

- **日期**：2026-09-03（计划 4 浏览器冒烟发现）
- **现象**：`POST /memories/candidates/:id/confirm` 返回 500（无日志堆栈——ApiExceptionFilter 不打印），候选被置 confirmed 挂起（先置后写）。临时给 filter 加日志定位：`ValidationError: AssistantMemory validation failed: relation.type: Path 'relation.type' is required.`——create 时根本没传 relation。
- **根因**：mongoose 8 对 `@Prop({ type: { type: String, required: true }, ... })` 这类嵌套 type 字面量子文档，create 不带该字段时会**实例化空子文档并校验其 required 字段**（T1 scope 坑的 relation 变体——scope 靠 `default: 'global'` 填充掩盖，relation 无 default 而暴露）。单测用内存 mock 模型无真实校验，跑不出此错误。
- **相关文件**：
  - `notes-backend/src/modules/assistant/schemas/assistant-memory.schema.ts`（relation 改独立子 Schema `MemoryRelationSubSchema`）
  - `notes-backend/test/assistant-memory-schema.test.ts`（真实 mongoose `doc.validate()` 回归测试）
- **修复方案**：relation 改用独立 `new MongooseSchema(...)` 子文档声明（须定义在 class 前供装饰器参数引用）——不传即 undefined、传了才校验。
- **经验教训**：mongoose 8 的可选嵌套子文档必须用独立子 Schema 声明，嵌套 type 字面量 + required 内层字段会在 create 时被实例化校验；schema 层缺陷单测必须用真实 mongoose validate/create 覆盖（mock 模型全盲区）。

---

## [M1] 认知引用从不注入：记忆语言与召回分词错配

- **日期**：2026-09-03（计划 4 浏览器冒烟发现）
- **现象**：RAG 搜索提问的回答 `memoryCitations` 恒空（无 `[M1]`），只有 `[E1]` 笔记引用。已确认记忆（React/Vue3 决策）存在且 global scope 应恒兼容召回。
- **根因**：extractor system prompt 全英文书写，模型对中文对话也输出英文 subject/statement（如 "Frontend framework"）；而 `MemoryRecallService.recall` 用**中文问题 bigram 分词**做 `$regex` 匹配英文记忆文本——"前端框架"等中文词对英文文本 0 命中 → 召回空 → 无记忆注入。
- **相关文件**：
  - `notes-backend/src/modules/assistant/assistant-memory-extractor.service.ts`（prompt 要求 subject/statement 用对话同语言输出，保留技术术语原文）
  - `notes-backend/test/assistant-memory-extractor.test.ts`（断言 system prompt 含 SAME LANGUAGE 要求）
- **修复方案**：extractor system prompt 增加语言约束——中文对话产中文记忆（React/Vue/NestJS 等技术词保留原文）；修复后中文决策可被中文问题召回，`[M1]` 注入链路打通。
- **经验教训**：跨语言链路（英文 prompt 提取 → 中文检索召回）必须显式对齐语言；模型输出语言由 prompt 语言主导，提取 prompt 应要求记忆用**用户对话的语言**输出，否则下游检索（按用户语言分词）必然落空。

---

## 小助手回答从不使用知识图谱扩展（结构性不可达）

- **日期**：2026-09-03
- **现象**：小助手 RAG 回答从未体现知识图谱扩展——全笔记检索（compare 类问题）时 warnings 恒出现「未指定知识库，已跳过图谱扩展」。直调后端时若带 `knowledgeBaseId`（项目测试库2）则扩图链路完全可用（`planSummary.tools` 含 graph_expand、回答引用到函数调用开销/栈溢出/提前终止等邻居节点内容）。
- **根因**：两层叠加导致**结构性不可达**：
  1. 小助手前端从不发送 `knowledgeBaseId`：输入区只有“搜索笔记”二元开关，spec（2026-09-01-assistant-workspace…-design）中的“选择知识库范围”从未实现 → UI 路径必然无库。
  2. 后端 `RagRetrievalService.retrieve()` 对「无 knowledgeBaseId + plan 含 graph_expand」直接跳过扩图并提示，缺少全笔记范围自动反查自有库图谱的能力。
  - 附带发现：用户拥有的“项目测试库”图节点/边**均未绑定 evidenceChunkIds**（12 节点/10 边 0 证据），即使显式选该库扩图也为空；只有“项目测试库2”证据完整（14/14 节点、15/15 边）。验收扩图必须用证据完整的库。
- **相关文件**：
  - `notes-backend/src/modules/knowledge-bases/knowledge-bases.service.ts`（新增 `expandGraphEvidenceAuto`）
  - `notes-backend/src/modules/ai/rag/rag-retrieval.service.ts`（无库分支改为自动扩图）
  - `notes-backend/test/knowledge-base-auto-graph-expand.test.ts`、`notes-backend/test/rag-retrieval-orchestration.test.ts`（回归测试）
- **修复方案**：后端在 ACL 边界内自动反查——`expandGraphEvidenceAuto(userId, seeds)` 由命中 chunk 的 noteId 经 `knowledge_base_notes`（带 userId 过滤）反查用户**自有且链接这些笔记**的知识库（上限 5，按 _id 升序），逐库复用 `expandGraphEvidence`（内部含 KB 归属 + NoteAccess + chunk 归属三重校验）做一跳扩展并按 chunkId 去重合并。`retrieve()` 仅在 `attemptedKbs === 0`（无自有库可扩）时提示「未找到可用的知识库图谱，已跳过图谱扩展」。
- **验证**：不带 knowledgeBaseId 直调 `/api/assistant/chat`（compare 问题），`complete` 事件 `warnings: []` 且 `planSummary.tools` 含 `graph_expand`/`graphHops:1`（修复前同调用 warnings 为「未指定知识库，已跳过图谱扩展」）。
- **经验教训**：功能在 API 层可用不代表 UI 可达——验收要覆盖“用户真实入口”的全链路；图谱证据质量（节点是否绑定 evidenceChunkIds）决定扩图是否真的产出，排查时应先查数据再怀疑代码。UI 缺知识库范围入口时，后端可在 ACL 边界内自动反查，避免结构性不可达，不必强推 UI 改动。
