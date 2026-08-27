# AI 模型路由与 Reasoning 分级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前 `text / reasoning` 两档路由升级为按业务任务选择 economy、standard、deep 模型的统一路由，并实现供应商参数适配、受控 fallback、审计和固定评测。

**Architecture:** 新增纯配置的任务策略表和 provider adapter；`AiService`、Graph 和后续 RAG 只提交 `AiTask`、`reasoningMode` 与输出约束。`AiGatewayClient` 按策略依次执行主模型和 fallback，只有在可降级错误上切换，并将尝试结果写入 `AiRunService`。

**Tech Stack:** NestJS 10、TypeScript、Node Test Runner、OpenAI-compatible Chat Completions、SiliconFlow、B.AI、Mongoose 8。

## Global Constraints

- economy 使用 `Qwen/Qwen3.5-4B`，standard 使用 `Qwen/Qwen3-14B`，deep 使用 `deepseek-ai/DeepSeek-V4-Flash`。
- B.AI `deepseek-v4-flash` 仅作为跨供应商 fallback；MiMo-V2.5 和 Hy3 不进入生产路由。
- `off / auto / deep` 是业务统一语义；供应商字段只能在 adapter 内生成。
- `off` 模式下，硅基流动 Qwen 必须发送 `enable_thinking: false`。
- 429、502、503、504、网络超时、空正文和允许修复的结构错误可以 fallback；400、401、403、权限错误和安全拒绝不得盲目 fallback。
- 流式请求只有在输出首个正文 chunk 前允许 fallback。
- reasoning 不能作为用户正文、summary 或结构化结果写回。
- embedding 继续使用 `Qwen/Qwen3-Embedding-8B`；rerank 继续使用 `Qwen/Qwen3-Reranker-8B`。
- 不输出或提交任何 API Key。
- 复杂业务原因和失败降级使用简洁中文注释；普通分支不写复述性注释。
- Commit message 使用中文，格式为 `类型(范围): 简述`。

---

### Task 1: 定义任务、推理模式和模型策略

**Files:**
- Create: `notes-backend/src/modules/ai/ai-model-policy.ts`
- Modify: `notes-backend/src/modules/ai/ai-gateway.types.ts`
- Create: `notes-backend/test/ai-model-policy.test.ts`

**Interfaces:**
- Produces: `AiTask`、`AiReasoningMode`、`AiModelTier`、`AiModelPolicy`、`resolveAiModelPolicy(task)`。
- Consumes: 后续 gateway 和业务调用点以 `AiTask` 解析主模型、fallback、reasoning 和默认预算。

- [ ] **Step 1: 编写策略表失败测试**

```ts
test('摘要和图谱使用 standard 且关闭 reasoning', () => {
  assert.deepEqual(resolveAiModelPolicy('note_summary'), {
    tier: 'standard', reasoningMode: 'off', maxTokens: 256,
    fallback: 'bai_deepseek',
  })
  assert.equal(resolveAiModelPolicy('knowledge_graph').tier, 'standard')
  assert.equal(resolveAiModelPolicy('knowledge_graph').reasoningMode, 'off')
})

test('破坏性整理与冲突分析才使用 deep', () => {
  for (const task of ['destructive_reorganization', 'conflict_analysis', 'proposal_revision'] as const) {
    assert.equal(resolveAiModelPolicy(task).tier, 'deep')
    assert.equal(resolveAiModelPolicy(task).reasoningMode, 'deep')
  }
})
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node --test -r ts-node/register test/ai-model-policy.test.ts`

Expected: FAIL，提示无法加载 `ai-model-policy`。

- [ ] **Step 3: 定义类型和穷尽策略表**

`AiTask` 必须覆盖设计文档中的全部业务任务。使用 `satisfies Record<AiTask, AiModelPolicy>` 保证新增任务未配置时编译失败。首版不实现运行时按内容自动升级；调用方必须显式选择普通提案或破坏性提案。

- [ ] **Step 4: 运行策略测试和类型检查**

Run: `node --test -r ts-node/register test/ai-model-policy.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add notes-backend/src/modules/ai/ai-model-policy.ts notes-backend/src/modules/ai/ai-gateway.types.ts notes-backend/test/ai-model-policy.test.ts
git commit -m "feat(ai): 定义任务模型策略"
```

---

### Task 2: 增加 SiliconFlow 与 B.AI provider 配置

**Files:**
- Modify: `notes-backend/src/modules/ai/ai-gateway.client.ts`
- Modify: `notes-backend/.env.example`
- Modify: `notes-backend/test/ai-gateway.test.ts`
- Modify: `scripts/check-ai-config.mjs`

**Interfaces:**
- Consumes: `SILICONFLOW_ECONOMY_TEXT_MODEL`、`SILICONFLOW_STANDARD_TEXT_MODEL`、`SILICONFLOW_DEEP_REASONING_MODEL`、`BAI_API_KEY`、`BAI_BASE_URL`、`BAI_FALLBACK_MODEL`。
- Produces: `resolveModelTarget(tier | fallback): AiProviderConfig`；错误消息只包含缺失变量名。

- [ ] **Step 1: 编写各层级解析和密钥脱敏失败测试**

```ts
test('standard 解析到 SiliconFlow Qwen3-14B', () => {
  const target = client.describeTaskRoute('knowledge_graph')
  assert.deepEqual(target, { provider: 'siliconflow', model: 'Qwen/Qwen3-14B' })
})

test('fallback 解析到 B.AI DeepSeek 且缺失配置不泄密', () => {
  assert.throws(() => missingBaiClient.describeFallbackRoute('note_summary'), /BAI_API_KEY/)
  assert.doesNotThrow(() => JSON.stringify(client.describeTaskRoute('note_summary')))
})
```

- [ ] **Step 2: 运行测试并确认当前 gateway 不支持 SiliconFlow chat 和 B.AI provider**

- [ ] **Step 3: 扩展 provider 配置解析**

`.env.example` 增加：

```env
SILICONFLOW_ECONOMY_TEXT_MODEL=Qwen/Qwen3.5-4B
SILICONFLOW_STANDARD_TEXT_MODEL=Qwen/Qwen3-14B
SILICONFLOW_DEEP_REASONING_MODEL=deepseek-ai/DeepSeek-V4-Flash
BAI_API_KEY=your_bai_api_key_here
BAI_BASE_URL=https://api.b.ai/v1
BAI_FALLBACK_MODEL=deepseek-v4-flash
```

迁移期间保留原 SenseNova 变量，但策略路由不读取它们。

- [ ] **Step 4: 扩展配置检查脚本**

脚本只报告变量是否存在、模型名和 base URL host，不打印 key。live 模式分别发送一个 16 Token 的 SiliconFlow 与 B.AI 请求，失败时记录 HTTP 状态和供应商 request ID。

- [ ] **Step 5: 运行测试与配置静态检查**

Run: `node --test -r ts-node/register test/ai-gateway.test.ts`

Run: `node scripts/check-ai-config.mjs`

Expected: 单测通过；静态检查不需要真实调用并且不输出密钥。

- [ ] **Step 6: 提交**

```powershell
git add notes-backend/src/modules/ai/ai-gateway.client.ts notes-backend/.env.example notes-backend/test/ai-gateway.test.ts scripts/check-ai-config.mjs
git commit -m "feat(ai): 配置分层模型与备用通道"
```

---

### Task 3: 实现供应商 Reasoning 参数适配

**Files:**
- Create: `notes-backend/src/modules/ai/ai-provider-adapter.ts`
- Create: `notes-backend/test/ai-provider-adapter.test.ts`
- Modify: `notes-backend/src/modules/ai/ai-gateway.client.ts`

**Interfaces:**
- Consumes: `{ provider, model, reasoningMode }`。
- Produces: `buildProviderOptions(input): Record<string, unknown>`。

- [ ] **Step 1: 编写参数映射失败测试**

```ts
test('SiliconFlow Qwen off 关闭 thinking', () => {
  assert.deepEqual(buildProviderOptions({
    provider: 'siliconflow', model: 'Qwen/Qwen3-14B', reasoningMode: 'off',
  }), { enable_thinking: false })
})

test('SiliconFlow DeepSeek deep 开启 thinking', () => {
  assert.deepEqual(buildProviderOptions({
    provider: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4-Flash', reasoningMode: 'deep',
  }), { enable_thinking: true })
})

test('未知能力不猜测 reasoning_effort', () => {
  assert.deepEqual(buildProviderOptions({ provider: 'unknown', model: 'x', reasoningMode: 'off' }), {})
})
```

- [ ] **Step 2: 运行测试并确认 adapter 不存在**

- [ ] **Step 3: 用显式能力表实现 adapter**

能力表至少记录 `supportsThinkingToggle` 和 `supportsReasoningEffort`。B.AI DeepSeek 首版不发送 `reasoning_effort=none`，因为实测路由曾对允许值产生不一致响应；作为 deep fallback 时只使用供应商已验证参数。

- [ ] **Step 4: 让 `chatBody` 合并 adapter 输出并删除通用的无条件 `reasoning_effort` 透传**

保留旧字段仅作为迁移入口，在类型层标记 deprecated；所有新调用使用 `reasoningMode`。

- [ ] **Step 5: 运行 adapter 与 gateway 测试**

Run: `node --test -r ts-node/register test/ai-provider-adapter.test.ts test/ai-gateway.test.ts`

Expected: PASS；请求快照中不存在供应商不支持的字段。

- [ ] **Step 6: 提交**

```powershell
git add notes-backend/src/modules/ai/ai-provider-adapter.ts notes-backend/src/modules/ai/ai-gateway.client.ts notes-backend/test/ai-provider-adapter.test.ts notes-backend/test/ai-gateway.test.ts
git commit -m "refactor(ai): 适配供应商推理参数"
```

---

### Task 4: 实现受控重试、输出校验与跨供应商 Fallback

**Files:**
- Create: `notes-backend/src/modules/ai/ai-output-validator.ts`
- Create: `notes-backend/test/ai-output-validator.test.ts`
- Modify: `notes-backend/src/modules/ai/ai-gateway.client.ts`
- Modify: `notes-backend/test/ai-gateway.test.ts`

**Interfaces:**
- Consumes: `chatTask({ task, system, prompt, maxTokens?, temperature?, responseFormat? })`。
- Produces: `{ content, attempt: { provider, model, retryCount, fallbackUsed, fallbackReason } }`。

- [ ] **Step 1: 编写错误分类和 fallback 失败测试**

```ts
test('429 退避耗尽后切换到 fallback', async () => {
  const result = await client.chatTask({ task: 'note_summary', prompt: 'text' })
  assert.equal(result.content, 'fallback summary')
  assert.equal(result.attempt.fallbackReason, 'rate_limited')
})

test('400 和 401 不切换模型', async () => {
  await assert.rejects(() => client.chatTask({ task: 'knowledge_graph', prompt: 'x' }), /rejected/)
  assert.equal(fallbackCalls, 0)
})

test('length 重试仍为空时切换 fallback，reasoning 不作为正文', async () => {
  const result = await client.chatTask({ task: 'note_summary', prompt: 'x' })
  assert.equal(result.content, 'usable content')
  assert.doesNotMatch(result.content, /hidden reasoning/)
})
```

- [ ] **Step 2: 为结构化任务编写校验测试**

`knowledge_graph` 必须包含合法 `nodes / edges`；`organizer_proposal` 必须包含合法 action type 和输入范围内的 note ID；普通文本至少包含非空 content。校验器不得承担业务权限校验。

- [ ] **Step 3: 实现错误分类**

返回枚举：`rate_limited | upstream_unavailable | timeout | empty_content | length_exhausted | invalid_output | rejected | unauthorized | forbidden | cancelled`。只有设计允许的前六类进入 fallback。

- [ ] **Step 4: 实现非流式 fallback 状态机**

主模型沿用最多三次退避请求；`finish_reason=length` 只扩大预算一次。主模型失败后 fallback 使用自身策略预算，不继承已膨胀到上限的预算。

- [ ] **Step 5: 实现流式首 chunk 边界**

请求在第一个正文 chunk 前失败可以重新连接 fallback；一旦向客户端 enqueue 正文，后续失败只关闭并上报错误，禁止拼接第二个模型输出。

- [ ] **Step 6: 运行 gateway、validator 和流式回归测试**

Run: `node --test -r ts-node/register test/ai-output-validator.test.ts test/ai-gateway.test.ts`

Expected: 所有错误分类、预算重试和首 chunk 边界通过。

- [ ] **Step 7: 提交**

```powershell
git add notes-backend/src/modules/ai/ai-output-validator.ts notes-backend/src/modules/ai/ai-gateway.client.ts notes-backend/test/ai-output-validator.test.ts notes-backend/test/ai-gateway.test.ts
git commit -m "feat(ai): 增加受控模型降级"
```

---

### Task 5: 将现有 AI 链路迁移到任务策略

**Files:**
- Modify: `notes-backend/src/modules/ai/ai.service.ts`
- Modify: `notes-backend/src/modules/ai/graphs/aggregate-summary.graph.ts`
- Modify: `notes-backend/src/modules/ai/graphs/knowledge-graph-build.graph.ts`
- Modify: `notes-backend/test/ai-gateway.test.ts`
- Modify: `notes-backend/test/aggregate-summary-graph.test.ts`
- Modify: `notes-backend/test/knowledge-graph-build-graph.test.ts`

**Interfaces:**
- Consumes: `AiGatewayClient.chatTask` 和 `streamTask`。
- Produces: 所有现有 AI 调用明确声明 `AiTask`，不再声明旧 `route` 或供应商 reasoning 参数。

- [ ] **Step 1: 编写链路映射失败测试**

验证：摘要=`note_summary`；聚合摘要=`aggregate_summary`；图谱=`knowledge_graph`；写作=`writer`；主题命名=`topic_name`；宠物=`pet_chat`；思维导图=`mindmap`；Mermaid=`mermaid`。

- [ ] **Step 2: 运行测试并确认当前仍提交 `text / reasoning` route**

- [ ] **Step 3: 迁移摘要、图谱、写作和主题命名**

摘要保持现有 1600 字符分段和 256 Token 初始预算；调用点不再传 `reasoningEffort: 'none'`，由任务策略设置 `off`。

- [ ] **Step 4: 迁移宠物聊天并保留与 RAG 的边界**

`chatPet` 只提交用户消息，不接收检索 Chunk。后续知识助手使用独立 `rag_answer` 任务；Query Planner 才能把知识型问题转入 RAG。

- [ ] **Step 5: 迁移 Mindmap 和 Mermaid**

Mindmap 默认 standard/off；本地解析失败后的修复调用升级为 deep。Mermaid 生成和修复均使用 deep。

- [ ] **Step 6: 运行现有 AI 与图谱测试**

Run: `npm run test:unit --prefix notes-backend`

Expected: 全部通过；不存在生产调用点继续提交 `route: 'text' | 'reasoning'`。

- [ ] **Step 7: 提交**

```powershell
git add notes-backend/src/modules/ai notes-backend/test/ai-gateway.test.ts notes-backend/test/aggregate-summary-graph.test.ts notes-backend/test/knowledge-graph-build-graph.test.ts
git commit -m "refactor(ai): 按业务任务选择模型"
```

---

### Task 6: 扩展 AI Run 审计与安全日志

**Files:**
- Modify: `notes-backend/src/modules/ai/ai-run.service.ts`
- Modify: `notes-backend/src/modules/ai/schemas/ai-run.schema.ts`
- Modify: `notes-backend/src/modules/ai/ai.service.ts`
- Create: `notes-backend/test/ai-run-routing-audit.test.ts`

**Interfaces:**
- Consumes: gateway 返回的 attempt 元数据。
- Produces: task、reasoningMode、provider、model、durationMs、finishReason、contentChars、reasoningChars、retryCount、fallbackUsed、fallbackReason、validationResult。

- [ ] **Step 1: 编写成功、fallback 和失败审计测试**

测试必须断言审计记录不包含 `apiKey`、完整 prompt、完整正文或完整 reasoning。

- [ ] **Step 2: 运行测试并确认 schema 缺少路由字段**

- [ ] **Step 3: 扩展 schema 与生命周期方法**

旧记录字段保持可选，避免迁移现有测试数据。业务成功与审计写入失败继续解耦；审计失败只记录 warning。

- [ ] **Step 4: 运行审计测试和 AI 全量单测**

Run: `node --test -r ts-node/register test/ai-run-routing-audit.test.ts test/ai-gateway.test.ts`

Run: `npm run test:unit --prefix notes-backend`

Expected: PASS，日志和 MongoDB 写入中没有敏感正文。

- [ ] **Step 5: 提交**

```powershell
git add notes-backend/src/modules/ai notes-backend/test/ai-run-routing-audit.test.ts
git commit -m "feat(ai): 记录模型路由与降级审计"
```

---

### Task 7: 建立固定模型评测与上线开关

**Files:**
- Create: `notes-backend/scripts/evaluate-ai-routes.ts`
- Create: `notes-backend/test/ai-route-evaluation.test.ts`
- Modify: `notes-backend/package.json`
- Modify: `notes-backend/.env.example`
- Modify: `docs/superpowers/plans/2026-08-26-knowledge-search-graph-rag-phased-plan.md`

**Interfaces:**
- Produces: `npm run evaluate:ai-routes`，输出 JSON 报告但不保存原始笔记正文。
- Consumes: 固定匿名测试样本和当前环境模型配置。

- [ ] **Step 1: 编写评分器失败测试**

评分器至少检查：摘要关键事实覆盖、JSON 合法、note ID 范围、RAG 引用标题正确、空正文、P50/P95 延迟、fallback 成功率。

- [ ] **Step 2: 实现匿名固定样本和报告结构**

```ts
interface AiRouteEvaluationReport {
  startedAt: string
  routes: Array<{
    task: AiTask
    provider: string
    model: string
    samples: number
    validRate: number
    emptyContentRate: number
    fallbackRate: number
    p50Ms: number
    p95Ms: number
  }>
}
```

每个核心任务至少运行 5 次。失败响应只保留错误类别、HTTP status、长度和 request ID，不保存 prompt、正文或 reasoning。

- [ ] **Step 3: 增加上线开关**

```env
AI_TASK_ROUTING_ENABLED=false
```

关闭时保持旧路由；开启时使用新策略。旧路由至少保留一个发布周期，再根据审计数据删除。

- [ ] **Step 4: 更新分阶段总计划**

在第二阶段 GraphRAG 和第三阶段整理提案前置条件中引用本模型路由方案；明确 `rag_answer`、`organizer_proposal`、`destructive_reorganization` 的任务等级。

- [ ] **Step 5: 执行完整验证**

Run: `npm run test:unit --prefix notes-backend`

Run: `npm run build --prefix notes-backend`

Run: `npm run check:ai-config:live`

Run: `npm run evaluate:ai-routes --prefix notes-backend`

Expected: 单测和构建通过；核心任务有效率 100%，空正文率 0%；故障注入下 fallback 成功率 100%。真实评测未达到门槛时保持 `AI_TASK_ROUTING_ENABLED=false`。

- [ ] **Step 6: 提交**

```powershell
git add notes-backend/scripts/evaluate-ai-routes.ts notes-backend/test/ai-route-evaluation.test.ts notes-backend/package.json notes-backend/.env.example docs/superpowers/plans/2026-08-26-knowledge-search-graph-rag-phased-plan.md
git commit -m "test(ai): 建立模型路由评测门槛"
```

---

## 最终验收清单

- [ ] 所有 AI 调用点声明业务任务，而不是直接选择 `text / reasoning`。
- [ ] economy、standard、deep 分别使用 Qwen3.5-4B、Qwen3-14B、DeepSeek-V4-Flash。
- [ ] 硅基流动 Qwen 的 `off` 请求真实包含 `enable_thinking=false`。
- [ ] 摘要、图谱、普通 RAG、宠物聊天和写作不会开启显式 reasoning。
- [ ] 冲突分析、拆分合并、复杂返工和 Mermaid 使用 deep。
- [ ] MiMo-V2.5 和 Hy3 不出现在生产策略表。
- [ ] B.AI DeepSeek 只作为跨供应商 fallback。
- [ ] 空正文不会被 reasoning 替代，也不会写入业务数据。
- [ ] 429、临时 5xx、超时、空正文和可修复结构错误按规则 fallback。
- [ ] 400、401、403、权限和安全错误不会盲目 fallback。
- [ ] 流式响应不会拼接不同模型的正文。
- [ ] AI run 能追踪模型、耗时、重试和 fallback，但不保存密钥、完整 prompt、正文或 reasoning。
- [ ] embedding 与 reranker 配置、维度和 Atlas 索引不变。
- [ ] 固定评测达到核心任务有效率 100%、空正文率 0%，再打开新路由开关。
- [ ] `npm run test:unit --prefix notes-backend` 和 `npm run build --prefix notes-backend` 通过。

