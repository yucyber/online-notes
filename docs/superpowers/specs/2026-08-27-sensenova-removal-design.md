# SenseNova 运行时移除设计

## 目标

从在线笔记的活动运行时、配置模板、配置检查和当前架构文档中移除 SenseNova，同时保持现有 AI 功能的请求契约、失败降级、流式响应和专用向量链路不变。

“移除干净”指活动代码和部署配置不再读取、校验或调用任何 `SENSENOVA_*` 变量。历史计划、旧事故记录和已完成设计保留原文，并明确标记为历史背景，不把过去发生过的迁移记录改写掉。

## 最终路由

| 用途 | Provider / Model | 约束 |
| --- | --- | --- |
| 默认 text、standard | SiliconFlow `Qwen/Qwen3-14B` | `off` 映射为 `enable_thinking=false` |
| economy | SiliconFlow `Qwen/Qwen3.5-4B` | 只用于低风险短任务 |
| reasoning、deep | SiliconFlow `deepseek-ai/DeepSeek-V4-Flash` | 为 reasoning 与正文共同预留 deep 预算 |
| provider fallback | B.AI `deepseek-v4-flash` | 只处理 429、网络错误、超时和临时 5xx |
| expert quality target | AgentRouter `claude-opus-4-8` | 只用于指定复杂任务，预算 4096～8000 |
| embedding | SiliconFlow `Qwen/Qwen3-Embedding-8B` | 不自动更换模型或维度 |
| rerank | SiliconFlow `Qwen/Qwen3-Reranker-8B` | 失败退回原始融合排序 |

## 代码迁移

`AiGatewayClient` 的旧 `text | reasoning` route 继续保留，以免现有调用点同时大改；但两个 route 都解析为 SiliconFlow：text 使用 `SILICONFLOW_STANDARD_TEXT_MODEL`，reasoning 使用 `SILICONFLOW_DEEP_REASONING_MODEL`。`AI_TEXT_PROVIDER` 和 `AI_REASONING_PROVIDER` 仍可保留为显式配置，唯一允许值为 `siliconflow`。

已有 `AiTask` 路由优先于旧 route。`note_summary` 继续使用 standard SiliconFlow，并在供应商错误时切换 B.AI。AR 不成为默认 text/reasoning provider；后续只由复杂任务策略选择。

删除 `chatProviderKeys` 中的 SenseNova 分支、默认值和所有 `SENSENOVA_*` 读取。流式与非流式请求继续共用同一 Provider 配置和 `postJson`，避免迁移后行为分叉。

## 配置迁移

`.env.example` 和 `check-ai-config.mjs` 删除所有 SenseNova 变量。最终默认值为：

```env
AI_TASK_ROUTING_ENABLED=true
AI_TEXT_PROVIDER=siliconflow
AI_REASONING_PROVIDER=siliconflow
AI_EMBEDDING_PROVIDER=siliconflow
AI_RERANKER_PROVIDER=siliconflow
```

配置检查必须报告 SiliconFlow economy、standard、deep、embedding、reranker，B.AI fallback 和可选 AR expert 配置；输出只显示是否配置和长度，不泄露 Key。live check 使用 SiliconFlow standard 模型验证普通 chat，使用 deep 模型验证 reasoning 正文，并继续验证 embedding、reranker 与可选 AR。

## 兼容与失败边界

- 不修改 controller、DTO 或前端 API 契约。
- 不修改 summary、图谱、RAG、writer、pet、mindmap、Mermaid 的 prompt 和返回结构。
- SiliconFlow Qwen 的 `reasoningEffort: none` 转换为 `enable_thinking=false`；DeepSeek 不发送未经确认的供应商参数。
- 400、401、403、ACL 拒绝和用户取消不得 fallback。
- 流式请求发出首个正文 chunk 后不得切换 Provider。
- 数据库中的历史 `AiRun.provider/model` 不重写；它们是审计事实。

## 测试与验收

先写失败测试，再修改生产代码：

1. 默认 text route 使用 SiliconFlow standard model。
2. 默认 reasoning route 使用 SiliconFlow deep model。
3. 显式 `AI_TEXT_PROVIDER=sensenova` 被拒绝，不会静默回退。
4. Qwen text 请求正确关闭 thinking，deep 请求保持模型能力适配。
5. 现有 JSON、重试、流式、摘要 B.AI fallback、embedding 和 rerank 测试不回归。
6. 配置检查不再出现 SenseNova/MiMo，并能检查 SiliconFlow、B.AI 与 AR。
7. 后端全量单测、TypeScript build、配置 dry-run 和最小 live smoke test 全部通过。

活动路径验收使用限定搜索：`notes-backend/src`、`notes-backend/test`、`notes-backend/.env.example`、`scripts/check-ai-config.mjs` 中不得再出现 `sensenova` 或 `SENSENOVA_`。历史文档命中允许保留，但当前总计划和当前模型路由设计必须明确标记 SenseNova 已淘汰。
