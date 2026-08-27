# AI 模型路由与 Reasoning 分级设计

## 目标

为在线笔记的摘要、知识图谱、RAG、整理提案和普通聊天建立统一的模型路由。调用方只声明业务任务和推理等级，gateway 负责选择模型、转换供应商参数、执行有限重试与跨供应商降级。

本设计解决三个问题：

1. 避免推理模型把 `max_tokens` 消耗在 reasoning 后返回空正文；
2. 避免所有链路无差别使用 DeepSeek-V4-Flash；
3. 让主模型限流或临时不可用时可以安全切换 fallback，同时保留审计信息。

## 已验证事实

2026-08-27 使用当前项目密钥，以长摘要、图谱 JSON、提案 JSON和带笔记引用的问答进行相同输入实测：

| 模型 | 长摘要 | 图谱 | 提案 | RAG 回答 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 硅基流动 `Qwen/Qwen3-14B` | 通过 | 通过 | 通过 | 通过 | 第一阶段综合主模型 |
| 硅基流动 `Qwen/Qwen3.5-4B` | 通过 | 通过 | 通过 | 引用格式不合格 | 仅承担低风险短任务 |
| B.AI `deepseek-v4-flash` | 通过 | 通过 | 通过 | 通过 | 能力合格，但存在突发 429 |
| B.AI `mimo-v2.5` | 空正文 | 空正文 | 空正文 | 通过 | reasoning 可能耗尽输出预算 |
| B.AI `hy3` | 空正文 | 空正文 | 空正文 | 空正文 | 当前接口行为不适合作为主链路 |
| AgentRouter `claude-opus-4-8`（低预算） | 摘要超长 | 空正文 | 空正文 | 正文截断 | 不能沿用 standard 小预算 |
| AgentRouter `claude-opus-4-8`（4096 token） | 不作为高频摘要模型 | 通过 | 通过 | 通过 | 复杂任务的可选专家质量升级模型 |
| AgentRouter `claude-opus-5` | 摘要超长 | JSON 截断 | JSON 截断 | 引用不完整 | 当前无替换优势 |
| AgentRouter `gpt-5.6-sol` | 通过 | 通过但延迟高 | `<think>` 污染 JSON | `<think>` 污染正文 | 当前输出清洁度不满足生产契约 |
| AgentRouter `deepseek-v4-flash` | 摘要可用 | 空正文 | 通过 | 正文截断 | 不优于现有同模型通道 |
| AgentRouter `glm-5.3` | 空正文 | 空正文 | 空正文 | 空正文 | reasoning 耗尽当前预算 |

MiMo、Hy3 和 AgentRouter GLM-5.3 的失败响应为 HTTP 200、`finish_reason=length`、reasoning 非空而 content 为空。这不是限流；限流由 HTTP 429 表示。它们不进入本次生产路由，后续只有重新通过固定评测集后才能启用。

AgentRouter `claude-opus-4-8` 在 900～1100 token 下出现空正文、截断或不完整回答，提高到 4096 token 后才通过图谱 JSON、复杂提案和带引用 RAG 样本，单次耗时约 13～22 秒。因此它不替换 economy/standard/deep 的日常主模型，只作为指定复杂任务的 `qualityFallback` 或显式专家复核目标。AgentRouter 网关还要求固定 `User-Agent: claude-cli/2.1.75 (external, cli)`；该参数由 gateway adapter 注入，业务调用不得自行拼接。

## 路由模型

### 业务任务

```ts
type AiTask =
  | 'note_summary'
  | 'aggregate_summary'
  | 'knowledge_graph'
  | 'organizer_proposal'
  | 'rag_answer'
  | 'query_rewrite'
  | 'query_plan'
  | 'search_hit_explanation'
  | 'writer'
  | 'topic_name'
  | 'pet_chat'
  | 'mindmap'
  | 'mermaid'
  | 'destructive_reorganization'
  | 'conflict_analysis'
  | 'proposal_revision'
```

### 推理等级

```ts
type AiReasoningMode = 'off' | 'auto' | 'deep'
```

- `off`：要求供应商关闭显式 thinking。用于提取、压缩、改写、普通问答和严格 JSON 输出。
- `auto`：模型自行决定，但不依赖隐藏推理完成任务。第一版只保留接口，不作为默认路由。
- `deep`：明确允许深度推理，并为 reasoning 和正文预留更高输出预算。

关闭 reasoning 不等于模型不进行判断；它只是避免显式长思考占用输出 Token。普通 Transformer 生成仍会结合上下文完成语义判断。

### 三个模型层级

| 层级 | 主模型 | Reasoning | 适用范围 |
| --- | --- | --- | --- |
| `economy` | 硅基流动 `Qwen/Qwen3.5-4B` | `off` | query rewrite、主题命名、搜索命中说明、宠物聊天 |
| `standard` | 硅基流动 `Qwen/Qwen3-14B` | `off` | 单篇/聚合摘要、图谱、普通 RAG、基础提案、写作、思维导图 |
| `deep` | 硅基流动 `deepseek-ai/DeepSeek-V4-Flash` | `deep` | 冲突分析、拆分合并、复杂返工、复杂 Mermaid 生成与修复 |

B.AI `deepseek-v4-flash` 只承担跨供应商容灾。由于当前观察到 B.AI 有突发 429，它不作为唯一生产通道。同为 DeepSeek-V4-Flash 的硅基流动实例用于同供应商能力升级，两者名称相近，但触发原因不同。

AgentRouter `claude-opus-4-8` 不构成第四个默认层级，定义为可选的 `expertQualityTarget`：仅在指定 deep 任务的主响应通过 HTTP 但未通过结构、完整性或冲突校验时使用。它不是 provider fallback，也不参与摘要、普通图谱、普通 RAG、query rewrite、Planner、宠物聊天等高频链路。

## AI 链路矩阵

| AI 链路 | 层级 | 主模型 | 质量 fallback | 供应商 fallback | Reasoning | 原因 |
| --- | --- | --- | --- | --- | --- | --- |
| 单篇及长笔记分段摘要 | standard | Qwen3-14B | 原文截断摘要 | B.AI DeepSeek-V4-Flash | off | 稳定覆盖信息；质量失败可本地安全降级 |
| 多篇笔记聚合摘要 | standard | Qwen3-14B | 硅基流动 DeepSeek-V4-Flash | B.AI DeepSeek-V4-Flash | off；发现冲突才升级 deep | 日常是综合，冲突才需要复杂比较 |
| 知识图谱抽取 | standard | Qwen3-14B | 硅基流动 DeepSeek-V4-Flash | B.AI DeepSeek-V4-Flash | off | JSON 或结构校验失败时升级能力 |
| 基础标签、分类、归属提案 | standard | Qwen3-14B | 硅基流动 DeepSeek-V4-Flash | B.AI DeepSeek-V4-Flash | off | 属于受约束语义匹配 |
| 拆分、合并、内容修改提案 | deep | 硅基流动 DeepSeek-V4-Flash | AR Claude Opus 4.8 | B.AI DeepSeek-V4-Flash | deep；AR ≥4096 token | 高风险动作在结构或完整性校验失败时升级专家模型 |
| 用户反馈后的复杂返工 | deep | 硅基流动 DeepSeek-V4-Flash | AR Claude Opus 4.8 | B.AI DeepSeek-V4-Flash | deep；AR ≥4096 token | 需要理解旧方案与修改意见的差异 |
| 普通 RAG 最终回答 | standard | Qwen3-14B | 重新检索或明确证据不足 | B.AI DeepSeek-V4-Flash | off | 不用换强模型掩盖证据不足 |
| 检索证据冲突分析 | deep | 硅基流动 DeepSeek-V4-Flash | AR Claude Opus 4.8 | B.AI DeepSeek-V4-Flash | deep；AR ≥4096 token | 需要识别冲突、版本和不确定性 |
| Query rewrite | economy | Qwen3.5-4B | Qwen3-14B | B.AI DeepSeek-V4-Flash | off | 输出短、风险低 |
| Query Planner | 本地规则优先 | Qwen3.5-4B | 固定安全工具组 | 无 | off | 明显问题不产生额外模型调用 |
| 搜索命中说明 | economy | Qwen3.5-4B | 直接展示 Chunk | 无 | off | 失败不影响搜索证据本身 |
| 主题名称 | economy | Qwen3.5-4B | 本地关键词兜底 | 无 | off | 只生成 2～6 个词 |
| 宠物聊天 | economy | Qwen3.5-4B | 无 | B.AI DeepSeek-V4-Flash | off | 不检索用户笔记，低风险 |
| 续写、润色 | standard | Qwen3-14B | 无 | B.AI DeepSeek-V4-Flash | off | 主要关注表达质量 |
| 思维导图 | standard | Qwen3-14B | 硅基流动 DeepSeek-V4-Flash | B.AI DeepSeek-V4-Flash | off | 优先保证 JSON 合法；修复时可升级 |
| Mermaid | deep | 硅基流动 DeepSeek-V4-Flash | AR Claude Opus 4.8（仅复杂修复） | B.AI DeepSeek-V4-Flash | deep；AR ≥4096 token | 普通失败先本地校验修复，复杂结构失败才升级 |
| 主题/Chunk embedding | 专用模型 | Qwen3-Embedding-8B | 不自动切模型 | 无 | 不适用 | 必须保持向量维度和索引一致 |
| Rerank | 专用模型 | Qwen3-Reranker-8B | 原始融合排序 | 无 | 不适用 | 失败可安全退回已有检索分数 |

RAG 助手和宠物聊天必须保持为两条内部链路。RAG 会执行权限过滤、Chunk 检索、可选图谱扩展、rerank 和引用生成；宠物聊天默认不读取用户笔记。当宠物入口收到知识型问题时，由 Query Planner 转交 RAG，而不是让宠物模型凭自身知识回答用户经历。

## 供应商参数适配

业务调用不得直接传 `enable_thinking` 或任意供应商字段。统一由 adapter 转换：

```text
SiliconFlow Qwen:
  off  -> enable_thinking=false
  auto -> 不发送 enable_thinking
  deep -> enable_thinking=true

支持 reasoning_effort 的模型:
  off  -> reasoning_effort=none（仅当该模型文档明确支持）
  auto -> 不发送 reasoning_effort
  deep -> reasoning_effort=high

无法关闭 reasoning 的模型:
  off  -> 不选择该模型
  deep -> 使用该模型并提高输出预算
```

模型能力表由代码维护，不能根据 provider 名称猜测参数支持。未知参数不得发送到远端。

AgentRouter Claude Opus 当前不发送 `reasoning_effort`。其 reasoning 无可靠关闭参数，只有 deep 任务可以选择，并为 reasoning 和正文共同预留至少 4096 token。返回 `<think>`、空正文、截断 JSON 或无效引用都视为质量失败，reasoning 不得作为正文使用。

## 两类 Fallback 与重试边界

fallback 必须按目的拆分，不能用一个模糊字段同时表示“模型能力不足”和“供应商不可用”：

```ts
interface AiModelPolicy {
  primary: ModelTarget
  qualityFallback?: ModelTarget | LocalFallback
  providerFallback?: ModelTarget
}
```

- `qualityFallback`：主请求已经成功返回，但正文为空、结构不合法或任务质量校验失败。它可以是同供应商更强模型、指定复杂任务的 AgentRouter Claude Opus 4.8，也可以是原文截断、原始检索结果等本地安全降级。
- `providerFallback`：主供应商发生 429、超时、网络错误或临时 5xx。它必须使用另一供应商，当前固定为 B.AI DeepSeek-V4-Flash。

知识图谱的典型策略是：

```text
SiliconFlow Qwen3-14B
  ├─ JSON 或业务结构校验失败
  │    → qualityFallback: SiliconFlow DeepSeek-V4-Flash
  └─ SiliconFlow 429、超时或临时 5xx
       → providerFallback: B.AI DeepSeek-V4-Flash
```

两种 fallback 都不是无条件的第二、第三次模型调用。单次任务最多使用一个 fallback；根据错误类型直接选择对应分支，禁止先执行质量 fallback、失败后再执行供应商 fallback，避免一次用户操作形成无界请求链。

一次调用流程：

```text
任务策略解析
→ 主模型最多执行网络/429退避重试
→ 校验 HTTP、非空正文和任务输出结构
→ 质量错误选择 qualityFallback
→ 供应商错误选择 providerFallback
→ 单次任务最多执行一个 fallback
→ 记录最终 provider、model、attempt、fallbackType 和 fallbackReason
```

允许选择 `providerFallback`：

- 429；
- 502、503、504；
- 网络超时；

允许选择 `qualityFallback`：

- HTTP 200 但正文为空；
- `finish_reason=length` 且提高预算重试后仍无正文；
- 图谱、提案、思维导图等任务的结构校验失败，且本地修复失败。

不允许盲目 fallback：

- 400 参数或 prompt 契约错误；
- 401、403 凭据和权限错误；
- 用户取消；
- 权限过滤未通过；
- 内容安全拒绝。

流式响应在正文已经发送给客户端后不得静默换模型，否则可能拼接两个模型的回答。fallback 仅发生在收到第一个正文 chunk 之前；首 chunk 之后失败应明确结束并提示重试。

## 输出预算

`max_tokens` 是本地后端发送给远端模型的最大输出预算。关闭 reasoning 的链路按正文需要设置小预算；deep 链路同时为 reasoning 和正文留出空间。

| 任务 | 初始最大输出 Token |
| --- | ---: |
| 主题名称、query rewrite | 64～256 |
| 单段摘要 | 256 |
| 普通 RAG、宠物聊天 | 600～1200 |
| 图谱、提案、思维导图 | 1600～3000 |
| deep 提案、Mermaid | 4000～8000 |
| AR Claude Opus 4.8 专家质量升级 | 4096～8000 |

只有 `finish_reason=length` 且任务允许时才扩大一次预算。不得把 reasoning 当作正文 fallback，也不得将 reasoning 写入 summary、图谱或用户回答。

## 配置与密钥

建议增加显式模型配置：

```env
SILICONFLOW_ECONOMY_TEXT_MODEL=Qwen/Qwen3.5-4B
SILICONFLOW_STANDARD_TEXT_MODEL=Qwen/Qwen3-14B
SILICONFLOW_DEEP_REASONING_MODEL=deepseek-ai/DeepSeek-V4-Flash

BAI_API_KEY=
BAI_BASE_URL=https://api.b.ai/v1
BAI_FALLBACK_MODEL=deepseek-v4-flash

AR_API_KEY=
AR_BASE_URL=https://ps.air-outer.com/v1
AR_MODEL=claude-opus-4-8
```

SenseNova 已从活动运行时和配置模板中移除。`AI_TEXT_PROVIDER` 与 `AI_REASONING_PROVIDER` 均固定为 `siliconflow`；AR 只能由明确的复杂 `AiTask` 策略选择。配置检查只能输出 provider、model 和能力，不得输出密钥。

## 可观测性

每次 AI run 至少记录：

- task；
- reasoningMode；
- provider 和 model；
- durationMs；
- HTTP status；
- finishReason；
- contentChars 和 reasoningChars；
- retryCount；
- fallbackUsed、fallbackType（`quality | provider`）和 fallbackReason；
- 结构校验结果。

不记录 API Key、完整用户笔记、完整 prompt、完整 reasoning。摘要异步任务仍记录 `ai / passthrough / fallback` 来源。

## 验收标准

- 每条现有 AI 链路都映射到明确 `AiTask`，调用点不再自行选择 provider 参数。
- `off` 模式对硅基流动 Qwen 发送 `enable_thinking=false`，不再错误地只发送 `reasoning_effort=none`。
- standard 链路默认使用 Qwen3-14B；economy 链路使用 Qwen3.5-4B；deep 链路才使用 DeepSeek-V4-Flash。
- MiMo-V2.5 和 Hy3 不进入生产路由。
- AgentRouter Claude Opus 4.8 只用于指定 deep 任务的专家质量升级，预算不低于 4096 token；不得成为默认 text provider。
- 质量错误只选择 quality fallback；429、临时 5xx 和超时只选择跨供应商 fallback。
- 单次任务最多执行一个 fallback，不形成“主模型→质量 fallback→供应商 fallback”的连续调用链。
- 400、401、403 不会通过 fallback 掩盖配置问题。
- 流式响应不会拼接两个模型的正文。
- 结构化链路在返回业务层前完成 JSON schema 校验。
- embedding 和 reranker 模型保持不变。
- 固定评测集分别验证摘要信息覆盖、JSON 合法率、引用正确率、空正文率、P95 延迟和 fallback 成功率。
