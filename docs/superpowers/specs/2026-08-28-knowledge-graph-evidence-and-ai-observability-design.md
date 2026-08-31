# 知识图谱证据体验、跨笔记关系与 AI 性能观测设计

## 背景与目标

当前知识图谱已支持 node/edge 绑定 `evidenceChunkIds`，但节点详情仍只展示笔记 summary，尚未调用证据接口。最近两次知识图谱 proposal 的 `AiRun.durationMs` 分别为 59.154 秒和 57.157 秒，均由 SiliconFlow `Qwen/Qwen3-14B` 单次请求消耗；没有 retry、fallback 或 reasoning。现有审计只有总耗时，无法区分上下文准备、容量等待、模型请求、校验和保存阶段。

本轮设计同时解决四个问题：

1. 节点或关系可查看完整的单个 Chunk，并跳转到笔记中的对应位置；
2. 知识图谱优先发现有证据支撑的跨笔记关系，不再默认形成互不相连的单篇子图；
3. 关系名称尽量使用简洁中文；
4. 建立适用于所有 AI task 的用户级性能面板，并把知识图谱常见生成耗时优先压缩到约 15～25 秒。

## 范围与约束

- “完整内容”指完整的单个 Chunk，不是整篇 Note 正文。
- 证据仍按当前用户、knowledgeBase link、NoteAccess 和 NoteChunk 范围实时校验。
- 没有可靠跨笔记关系时允许图谱断开，不为连通性编造关系。
- 首版性能面板只展示当前用户自己的 AI 请求。
- 不保存或展示 prompt、Note/Chunk 正文、reasoning、API key 或供应商完整响应。
- 继续复用现有 `AiRun`、模型路由和 provider 容量控制，不引入 OpenTelemetry、Jaeger 或第二套审计系统。
- 本轮不进入 GraphRAG、整理 proposal 或自动写笔记。

## 一、完整 Chunk 证据与原文定位

### API 契约

证据接口继续返回服务端净化后的纯文本，但将当前截断字段扩展为：

```ts
type KnowledgeGraphEvidence = {
  noteId: string
  noteTitle: string
  chunkId: string
  headingPath: string[]
  preview: string
  content: string
}
```

- `content` 是完整单个 Chunk 的纯文本内容；移除 script、style、HTML 标签和危险 markup。
- `preview` 由服务端生成有界摘要，供默认折叠状态直接显示。
- 不通过证据接口返回整篇 Note。
- 结果继续稳定排序、去重并忽略已删除或失权 Chunk。
- 旧图谱没有证据时保持 `legacy_graph_without_evidence` 兼容结果。

### 前端交互

- 用户选中 node 后请求 node evidence；选中 edge 后请求 edge evidence。
- 详情面板按 `headingPath` 和笔记标题展示证据卡片。
- 卡片默认显示 `preview`，点击“展开更多”显示完整 `content`，再次点击可收起。
- 每张证据卡提供“定位到原文”。目标 URL 携带 `chunkId`，并可携带 headingPath 作为降级定位线索。
- 笔记页优先按 `chunkId` 定位；若 Chunk 已重建或 ID 失效，则按 headingPath 尝试定位；仍失败时正常打开笔记顶部并给出轻量提示。
- 切换 node/edge 或 knowledgeBase 时取消或忽略陈旧请求，避免旧证据串入新详情。

## 二、跨笔记关系与中文关系名称

### 模型输入和 prompt

继续使用受权限过滤、有数量和字符上限的 Chunk 候选。prompt 增加以下明确约束：

- 先识别每篇笔记内部概念，再比较不同 noteId 的概念、事实、因果、依赖、对比、补充和冲突；
- 有证据时优先生成跨 noteId 的 edge；
- 不得为了让图谱连通而编造关系，无可靠证据时允许子图断开；
- edge 的 `evidenceChunkIds` 必须足以支持关系；
- relation 使用简洁中文动词或短语，例如“依赖”“导致”“对比”“补充”“适用于”；
- node/edge 仍只能引用输入候选中的 noteId 和 chunkId。

归一化阶段不把英文关系机械翻译成中文，避免改变模型语义；语言要求在生成源头解决。`related to` 等本地 fallback 改为中文安全词“相关”，只用于模型缺少关系名称的兼容场景。

### 成功标准

- fixture 中存在明确跨笔记证据时，proposal 至少生成一条连接不同 noteId 范围的 edge；
- 无跨笔记证据 fixture 不要求连线；
- 新生成关系名称为中文或允许的通用技术术语，不再出现 `has_high`、`can_lead_to` 等默认英文关系；
- 所有跨笔记 edge 仍通过候选集校验和保存期 ACL/knowledgeBase/NoteChunk 二次校验。

## 三、知识图谱延迟优化

### 已确认根因

最近两次 proposal：

| 模型 | 总模型耗时 | retry | fallback | 输出字符 |
| --- | ---: | ---: | --- | ---: |
| Qwen3-14B | 59.154 秒 | 0 | 无 | 4657 |
| Qwen3-14B | 57.157 秒 | 0 | 无 | 4657 |

因此首要问题是单次模型生成时长，而不是数据库准备、重试或 fallback。

### 首轮优化

- 暂时保留 Qwen3-14B，避免在跨笔记关系质量尚未建立基线时直接降级模型。
- 默认上限收紧到约 24 个 nodes、36 条 edges，并降低 `maxTokens`。
- prompt 要求合并重复或近义概念，优先保留跨笔记关系和高价值内部关系，减少每篇笔记的细枝末节。
- 继续单次模型调用，不增加第二次“跨笔记补边”调用。
- 使用性能面板观察 `knowledge_graph` 的 P50/P95、输出规模和跨笔记边命中率。

若真实样本仍无法稳定进入约 15～25 秒，再用固定评测集比较 Qwen3.5-4B 主模型与 Qwen3-14B 主模型；只有速度收益明确且图谱质量达标时才调整路由。

## 四、通用 AI 性能观测

### 数据模型

扩展现有 `AiRun`，增加阶段与安全规模指标：

```ts
type AiRunStage = {
  name:
    | 'request'
    | 'context_prepare'
    | 'capacity_wait'
    | 'provider'
    | 'validation'
    | 'persistence'
    | 'response'
  durationMs: number
  status: 'succeeded' | 'failed' | 'skipped'
  attempt?: number
  provider?: string
  model?: string
  fallbackType?: 'quality' | 'provider'
}

type AiRunMetrics = {
  inputChars?: number
  candidateNotes?: number
  candidateChunks?: number
  outputChars?: number
}
```

- stages 只记录时间、状态和路由元数据。
- metrics 只记录数量或字符规模，不记录实际内容。
- provider 的每次 primary/retry/fallback 作为独立 `provider` stage，便于区分模型慢、退避等待和降级。
- `capacity_wait` 单独记录容量预约等待；当前直接 deferred 的请求也记录失败或跳过状态。
- 历史 `AiRun` 没有 stages 时仍展示现有 `durationMs`，标记“旧记录无阶段明细”。

### 计时边界

- controller 或业务入口创建 run，并记录 request 开始时间。
- 业务服务记录 context_prepare；例如知识图谱包含 knowledgeBase、ACL、Note、Chunk 查询和 prompt 候选准备。
- gateway 记录 capacity_wait、每个 provider attempt 和 validation。
- 需要写数据库的 AI task 由业务服务记录 persistence。
- response 在业务结果完成序列化前结束。
- 任一阶段失败都要关闭已开始的 stage，最终 run 标记 failed，避免永久 running。

### 查询权限与 API

- 查询只使用认证上下文中的 userId。
- 提供当前用户的 run 列表、聚合指标和单次 run 详情。
- 支持时间范围、task、provider、model、status、fallback 筛选。
- 聚合返回请求数、成功率、fallback 率、P50、P95，以及按 task/阶段的平均耗时。
- 服务端限制时间范围、分页和最大聚合窗口，避免性能面板反向造成重查询。

### 性能面板

首版放在设置/管理区域，包含：

1. 概览卡：请求数、成功率、fallback 率、P50、P95；
2. task 筛选和日期范围；
3. 各 task 平均阶段耗时的堆叠图；
4. 最近请求表：时间、task、模型、状态、总耗时、retry/fallback；
5. 单次请求抽屉：阶段瀑布、输入规模、输出规模和安全错误码。

知识图谱生成区域同时显示本次请求进度。服务端暂时无法主动推送细阶段时，前端先显示“准备数据/生成中”；响应完成后展示服务端返回或随后查询到的真实阶段耗时。后续若需要实时阶段更新，再单独设计 SSE/WebSocket 协议，本轮不扩展。

## 五、错误处理和兼容

- 完整 Chunk 已删除、失权或移出知识库：证据接口自动过滤，不返回 500。
- 定位目标失效：打开笔记并提示未找到原位置，不阻止导航。
- 阶段写审计失败：记录安全日志但不让 AI 主请求失败。
- 性能面板查询失败：显示可重试空态，不影响其他设置页面。
- provider 错误只展示安全分类和 request/run ID，不展示供应商原始正文或密钥。
- 旧 graph、旧 AiRun 和部分阶段缺失的数据均可读取。

## 六、测试与验收

### 后端

- 证据接口返回完整纯文本 Chunk，同时过滤 script/style/HTML。
- node/edge evidence 每次重新应用 ACL、knowledgeBase 与 NoteChunk 范围。
- 构图 prompt 和归一化测试覆盖跨笔记关系、中文关系、无证据断开和非法 evidence ID。
- AiRun stage 测试覆盖成功、provider retry、quality/provider fallback、validation 失败和审计写入失败降级。
- 性能查询测试覆盖当前用户隔离、筛选、分页、P50/P95 和旧记录兼容。

### 前端

- node/edge 切换时加载正确证据，陈旧请求不能覆盖当前详情。
- 默认预览、展开完整 Chunk、收起和定位链接均有组件测试。
- 笔记页覆盖 chunkId 定位、headingPath 降级和定位失败提示。
- 性能面板覆盖筛选、指标、阶段瀑布、旧记录和错误空态。
- 知识图谱生成状态覆盖等待、成功、失败和耗时结果。

### 真实验收

- 三篇存在明确关联的测试笔记生成至少一条有真实 Chunk 证据的跨笔记中文关系。
- 无可靠关系的笔记不会被强行连接。
- 点击证据能展开完整 Chunk，并定位到笔记中的对应内容。
- 知识图谱常见请求目标为约 15～25 秒；若未达到，以面板数据明确指出瓶颈，再决定是否切换更快模型。
- 当前用户可在 AI 性能面板查看不同 task 的 P50/P95 和单次阶段耗时，且看不到其他用户数据。
