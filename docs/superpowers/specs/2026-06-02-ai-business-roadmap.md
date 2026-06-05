# 在线笔记 AI 能力总体方案与业务路线图

日期：2026-06-02
状态更新：2026-06-04

## 0. 当前落地状态

截至 2026-06-04，P0 AI provider 迁移已经完成：

- 后端已新增统一 `AiGatewayClient` 和 `AiController`。
- 前端 `/api/ai/*` 已改为代理后端 `/api/ai/*`，不再直连 Coze。
- 文本生成默认走 SenseNova `deepseek-v4-flash`。
- 推理/长上下文默认走 MiMo `mimo-v2.5-pro`。
- embedding 和 reranker 默认走 SiliconFlow Qwen。
- Coze、Zhipu、ModelArk 不再作为当前主链路或 fallback。
- AI Pet 当前只保留文本聊天；图片聊天等待 MiMo omni 或其他视觉模型接入后再恢复。
- 6 个后端 AI endpoint 已补入 `notes-backend/openapi.yaml`。

本文后续涉及 Coze/Zhipu 的描述若出现在“历史现状”“迁移前问题”语境中，仅作为迁移背景保留，不代表当前实现。

## 1. 方案目标

本方案面向当前 `online-notes` 项目的真实业务功能，目标不是简单替换模型供应商，而是把历史上散落在前端 BFF、后端 service、Coze Workflow、Zhipu Embedding 中的 AI 能力，逐步升级为一套可配置、可诊断、可审计、可回退、可扩展的 AI 能力体系。

核心目标：

1. 让现有 AI 功能恢复稳定可用，解决 key 过期、余额不足、public key 暴露和 provider 绑定过深的问题。
2. 支持 MiMo、DeepSeek/SenseNova、SiliconFlow 或未来模型供应商的可切换接入；Coze/Zhipu 只作为历史迁移背景保留。
3. 用 LangGraph 承接真正有业务状态、多步骤校验、失败重试、人工确认的工作流。
4. 为未来 OpenClaw-like agent、function calling、tools、长期会话、自动整理和外部资料导入预留边界。
5. 保持核心笔记、权限、协作链路安全可控，不让 agent 直接绕过业务权限修改用户数据。

## 2. 当前 AI 业务现状

### 2.1 已存在的 AI 功能

| 业务能力 | 当前入口 | 当前实现 | 主要问题 |
| --- | --- | --- | --- |
| AI 续写/润色/摘要 | `notes-frontend/src/lib/ai-writer.ts` -> `/api/ai/writer` | Next BFF 代理后端 `/api/ai/writer/stream`，由 AI Gateway 路由 SenseNova/MiMo | 仍需沉淀提示词版本和可观测指标 |
| AI 宠物助手 | `notes-frontend/src/components/ai/AIPet.tsx` / `ChatWindow.tsx` -> `/api/ai/pet` | 后端 AI Gateway 文本流式聊天 | 图片聊天已暂停，需接入视觉模型后恢复 |
| 多笔记聚合摘要 | `AggregateSummaryDialog` -> `/api/ai/summary` | 后端 `AiService.generateAggregateSummary` 走 reasoning provider | 后续可升级为 `AggregateSummaryGraph` |
| 思维导图生成 | `dashboard/mindmaps/[id]/page.tsx` -> `getAIMindMapData` -> `/api/ai/mindmap` | `notes-frontend/src/lib/ai-gateway.ts` 代理后端 AI Gateway | JSON schema 仍需更强校验和修复链路 |
| 画板 Mermaid 生成 | `DrawnixBoard.tsx` -> `getAIMermaidData` -> `/api/ai/mermaid` | AI Gateway 生成 Mermaid，再转 Excalidraw | Mermaid 语法和素材映射缺少自动校验/修复 |
| 单篇笔记摘要 | `NotesService.generateAndSaveSummary` -> `AiService.generateSummary` | 后端异步 AI Gateway 摘要，失败 fallback 截断正文 | 仍需摘要状态和重试观测 |
| embedding / 语义搜索 | `EmbeddingService.generateEmbedding` + `SemanticService.searchVector` | SiliconFlow `Qwen/Qwen3-Embedding-8B` + MongoDB `$vectorSearch` | 需要补向量重建和 reranker 落地链路 |
| 智能推荐 | `SmartRecommendations` -> `/notes/recommendations` | 后端优先向量，失败回退 tag/recent/draft | 推荐逻辑在 `NotesService`，和 embedding 状态耦合 |
| 主题发现/转标签 | `/v1/semantic/topics` / `topics/convert` | SiliconFlow embedding + kmeans + AI Gateway topic 命名 | 可用，但仍需知识库边界和人工审批 |

### 2.2 当前配置检查结果

已新增 `npm run check:ai-config` 和 `npm run check:ai-config:live`。

2026-06-04 live 结果：

- MiMo chat：OK。
- SenseNova DeepSeek chat：OK。
- SiliconFlow model catalog：OK。
- SiliconFlow Qwen embedding：OK，返回 4096 维向量。
- SiliconFlow Qwen reranker：OK。

结论：

- 当前主链路不依赖 Coze Workflow。
- 当前 embedding 不依赖 Zhipu。
- Coze/Zhipu/ModelArk 配置已从当前 provider fallback 中移除。

## 3. 业务线拆分

### 3.1 笔记创作线

面向用户写笔记、改笔记、生成内容的场景。

当前场景：

- AI 续写：在编辑器中基于当前上下文继续生成内容。
- AI 润色：对选中内容或全文进行表达优化。
- AI 摘要：对当前笔记生成短摘要，用于列表展示或复盘。

未来场景：

- 写作风格模板：学术、日报、产品方案、会议纪要、技术文档。
- 结构化输出：把散乱笔记整理成大纲、行动项、待办、问题列表。
- 多轮编辑会话：用户可以要求“再短一点”“按 PRD 格式重写”“保留技术细节”。
- 版本对比辅助：AI 解释本次修改差异，辅助版本回滚。

推荐技术路线：

- P0：已用 AI Gateway 替换 `/api/ai/writer` 的直连 Coze。
- P0：默认模型使用 SenseNova DeepSeek 和 MiMo，不再把 Coze 作为 fallback。
- P1：为写作引入轻量会话状态，但不需要 LangGraph。
- P1：把“保存为新版本/插入到编辑器”做成用户确认动作。

不建议：

- 不要让 agent 直接自动覆盖用户原文。
- 不要在编辑器输入时实时无限调用模型，必须有显式触发和取消。

### 3.2 知识整理线

面向标签、分类、主题、重复内容、知识库清理的场景。这里的核心不是“让模型给笔记贴标签”，而是把一个知识库内部的笔记变成可检索、可聚类、可解释、可整理的知识资产。

当前场景：

- 分类/标签筛选。
- 主题发现：基于 embedding 聚类，AI Gateway text provider 命名 topic。
- 主题转标签：把 topic 批量转成 tag。
- 推荐笔记：基于向量、标签和最近笔记回退。

未来场景：

- 自动标签建议：根据新笔记内容推荐已有标签或新标签。
- 分类建议：建议放入一个或多个分类。
- 重复笔记发现：找出高度相似的笔记，提示合并或关联。
- 知识库健康报告：未分类笔记、重复标签、长期未更新主题、空内容草稿。
- 批量整理任务：选择一个知识库或一组笔记，生成整理建议，用户确认后执行。
- 知识库内主题演化：展示某个知识库近一段时间新增了哪些主题、哪些主题正在变淡。

知识库边界：

- 不默认把全量笔记混成一个图或一个向量空间。
- 默认以 `knowledgeBaseId` 作为整理、检索、图谱构建的边界。
- 一个笔记可以加入多个知识库，但通过 membership 关联，不复制笔记正文。
- 跨知识库整理必须是用户显式选择的高级模式。

推荐 embedding/reranker 路线：

- P0：已接入硅基流动 `Qwen/Qwen3-Embedding-8B`，替换历史 Zhipu embedding。
- P0：抽象 `EmbeddingProvider`，不要让业务代码依赖某个供应商的 token 格式。
- P0.5：预留 `RerankerProvider`，先把接口和配置位留好。
- P1：接入 Qwen reranker 或同类 reranker，用于 RAG、相似笔记、重复检测和图谱边权重重排。
- P1：检索链路采用 embedding + keyword/BM25 + reranker 的混合召回。

推荐检索链路：

```text
query
  -> query normalize / rewrite
  -> embedding topK=50
  -> keyword/BM25 topK=50
  -> merge and dedupe
  -> reranker topK=10
  -> graph expansion
  -> answer / organize / recommend
```

向量数据库策略：

- P0：继续用当前 MongoDB Vector Search 或现有 MongoDB 向量字段，减少基础设施变更。
- P1：如果知识库规模、召回质量或本地部署诉求上来，再评估 Qdrant。
- P2：如果出现复杂图查询、多租户高并发或图算法需求，再评估 Neo4j / Milvus / Weaviate。
- 图谱数据先用 MongoDB 独立集合承载，不急着引入图数据库。

核心 tools：

- `searchNotes(query, filters)`
- `getNoteById(noteId)`
- `listTags(knowledgeBaseId)`
- `listCategories(knowledgeBaseId)`
- `createTag(name, knowledgeBaseId)`
- `proposeNoteTags(noteId, tagIds)`
- `proposeNoteCategories(noteId, categoryIds)`
- `commitApprovedNoteChanges(proposalId)`

### 3.3 检索与问答线

面向用户“问自己的知识库”的场景。

当前场景：

- 关键词搜索。
- 语义搜索：`/v1/semantic/search`。
- 混合模式：前端 `SearchFilterBar` 支持 keyword/vector/hybrid。

未来场景：

- 自然语言问答：“我之前关于 JWT 鉴权怎么设计的？”
- 带引用回答：每个答案给出引用笔记和片段。
- 多轮追问：基于上一次检索上下文继续问。
- 范围限定：只问某个分类、标签、时间段、某组笔记。
- 对比式问答：比较两篇方案差异。

推荐技术路线：

- P0：保持现有 semantic search 可用，先修 embedding 资源问题。
- P1：引入 `NoteRagGraph`：
  - 解析问题和筛选条件。
  - 调用 keyword/vector/hybrid tools。
  - 权限过滤。
  - 构造上下文。
  - 生成答案和引用。
  - 返回可追踪的 source list。
- P1：为回答加入“引用不足”状态，避免模型强行回答。

不建议：

- 不要让模型直接拼 MongoDB 查询。
- 不要绕过 `NoteAccessService` 或后端权限边界。

### 3.4 可视化知识线：知识图谱、思维导图与画板

这一条业务线不应只停留在“输入一句 prompt 生成导图”。更长期的方向是借鉴 `nashsu/llm_wiki` 的思路：对一个知识库内的资料做增量 ingest，维护持久化 wiki/知识图谱，再把图谱局部子图输出为 Mindmap、Board、Mermaid 或 RAG 上下文。

参考点：

- `llm_wiki` 强调 persistent wiki，而不是每次临时 RAG。
- 它通过 ingest 维护长期知识结构。
- 它支持 knowledge graph，并用多种信号衡量节点相关性。
- 它把 review 队列作为人类确认层，避免模型自动污染知识库。

对本项目的改造方向：

```text
knowledgeBaseId
  -> collect notes in this knowledge base
  -> chunk / summarize
  -> extract concepts, entities, claims, relations
  -> link to existing graph nodes
  -> compute edge weights and communities
  -> expose graph view
  -> generate Mindmap / Board / Mermaid from selected subgraph
```

当前场景：

- 思维导图页面可以输入主题，让 AI 生成导图。
- 画板可以让 AI 生成 Mermaid，再转换为 Excalidraw。
- 画板素材库可以注册自定义素材，让 AI 生成时使用名称映射。

未来真实业务场景：

- 某个知识库内一键生成知识图谱，而不是全量笔记混合建图。
- 点击某个图谱节点，查看相关笔记、标签、分类、摘要和关系解释。
- 选择图谱中的一个主题子图，生成思维导图。
- 从技术方案知识库生成架构图、流程图、依赖图。
- 从会议纪要知识库生成责任分工图和行动项图。
- 从学习知识库生成“知识地图”，展示已学、薄弱、重复、待补充主题。
- 从图谱发现重复概念、孤岛笔记和跨主题连接。

知识库隔离原则：

- 默认每个 `knowledgeBaseId` 独立建图。
- 不同知识库的 node、edge、embedding、graph run 不混用。
- 跨知识库图谱只能由用户显式启用。
- 图谱构建必须复用笔记权限边界，不能把无权笔记纳入图谱。

建议数据模型：

```text
knowledge_bases
knowledge_base_notes
knowledge_nodes
knowledge_edges
knowledge_graph_runs
note_chunks
note_embeddings
```

推荐技术路线：

- P0：把 `/api/ai/mindmap` 和 `/api/ai/mermaid` 接入 AI Gateway。
- P0：新增 schema/语法校验：
  - Mindmap JSON 使用明确 schema。
  - Mermaid 使用解析或最小渲染校验。
- P0：增加 `KnowledgeGraphBuildGraph` 的最小版本，只支持单个知识库、手动触发、只生成 proposal。
- P1：把图谱节点和边持久化到 MongoDB。
- P1：增加图谱子图浏览和“子图转 Mindmap/Board”。
- P1：引入 reranker 改善图谱边权重和相关笔记质量。

LangGraph 场景：

```text
User prompt / note content / selected subgraph
  -> generate mindmap json or mermaid
  -> validate schema or syntax
  -> repair if invalid
  -> normalize ids
  -> return preview
  -> user confirms save
```

### 3.5 协作与团队知识线

面向多人协作、共享知识、权限控制的场景。

当前场景：

- Yjs + y-websocket 协作。
- Note ACL、Board/Mindmap 权限已修。
- 编辑器支持协作 token。

未来场景：

- AI 总结多人协作修改。
- AI 提取评论和讨论中的待办。
- AI 生成协作日报：“今天团队更新了哪些知识？”
- 分享前风险检查：是否包含敏感信息、是否引用了私有笔记。
- 权限感知 RAG：只回答用户有权访问的内容。

推荐技术路线：

- P1：所有 AI tools 必须携带 `userId`，并复用现有权限 service。
- P1：新增 AI 审计日志，记录用户、功能、引用资源、模型、耗时、错误，不记录完整 secret。
- P2：团队空间/组织维度的知识 agent。

### 3.6 外部资料导入与自动化线

面向未来 OpenClaw-like agent、browser tools、plugins 的业务线。

未来场景：

- 从网页抓取资料，清洗后生成笔记。
- 从 GitHub issue / PR / 文档页整理成技术笔记。
- 从会议记录生成待办、摘要、知识点。
- 定时生成周报/月报。
- 监控某些主题，一旦有新内容自动入库。
- 跨应用导入：飞书、Notion、Slack、浏览器收藏、邮件。

推荐技术路线：

- P2 引入 Agent Runtime，不进入 P0。
- Agent Runtime 只作为外部自动化层，不直接写核心数据。
- 所有写操作先生成 proposal，用户确认后通过业务 API 执行。
- 对 tools 做权限策略：
  - read-only tools：可自动执行。
  - write proposal tools：可生成建议。
  - write commit tools：必须用户确认。

## 4. 技术架构

### 4.1 AI Gateway

职责：

- 统一管理 provider 选择。
- 统一处理超时、重试、fallback、错误归一化。
- 统一脱敏日志和配置检查。
- 对上提供稳定接口，对下适配不同模型供应商。

建议接口：

```ts
interface AiGateway {
  chat(input: ChatInput): Promise<ChatResult>
  stream(input: ChatInput): AsyncIterable<string>
  json<T>(input: JsonInput<T>): Promise<T>
  embed(input: EmbedInput): Promise<number[]>
}
```

Provider：

- `MimoProvider`
- `SenseNovaDeepSeekProvider`
- `SiliconFlowQwenEmbeddingProvider`
- `SiliconFlowQwenRerankerProvider`
- historical only: `CozeProvider`
- historical only: `ZhipuEmbeddingProvider`
- future: `OpenAICompatibleProvider`

当前计划中的 key 来源：

- MiMo：使用用户自己的“小米 tokenplan 计划”key。
- DeepSeek：使用商汤 SenseNova key 和 baseURL。
- Qwen embedding：使用硅基流动 `Qwen/Qwen3-Embedding-8B`。
- Qwen reranker：使用硅基流动 `Qwen/Qwen3-Reranker-8B`，P0.5/P1 接入。
- Coze：已从当前 provider fallback 中移除，仅保留历史迁移记录。
- Zhipu：已从当前 embedding 主链路中移除，仅保留历史迁移记录。

模型路由：

| 用途 | 默认推荐 | fallback |
| --- | --- | --- |
| AI 宠物/快速问答 | SenseNova DeepSeek | MiMo |
| AI 续写/润色 | SenseNova DeepSeek | MiMo |
| 聚合摘要 | MiMo 长上下文/强推理 | SenseNova DeepSeek |
| Mindmap JSON | MiMo | DeepSeek 修复 |
| Mermaid | DeepSeek | MiMo |
| RAG 最终回答 | DeepSeek | MiMo 长上下文 |
| 知识图谱抽取 | MiMo | DeepSeek |
| embedding | 硅基流动 `Qwen/Qwen3-Embedding-8B` | 暂无；需要显式重新评估 |
| rerank | 硅基流动 `Qwen/Qwen3-Reranker-8B` | later: bge-reranker |

### 4.2 LangGraph Workflow Layer

只在“多步骤、有状态、要校验、要审批”的场景使用。

P0 Graph：

- `AggregateSummaryGraph`
  - 是什么：承接已经从历史 Coze Workflow 迁出的多笔记摘要流程。
  - 为什么用：多笔记摘要需要清洗、分块、单篇摘要、合并、结构化输出和失败降级，不适合散落在一个 route handler 中。
  - 场景：选中多篇笔记生成复盘、周报、项目总结、学习摘要。
- `MindmapGenerationGraph`
  - 是什么：从 prompt、单篇笔记、多篇笔记或知识子图生成 Mindmap JSON。
  - 为什么用：Mindmap 输出必须符合 schema，节点 id、topic、children 都要稳定；模型直接输出容易出错。
  - 场景：从技术笔记生成知识导图，从学习主题生成章节结构。
- `MermaidGenerationGraph`
  - 是什么：从 prompt、笔记或画板素材生成 Mermaid，并校验/修复语法。
  - 为什么用：Mermaid 对语法敏感，失败会直接影响画板转换。
  - 场景：生成流程图、架构图、时序图、责任分工图。
- `KnowledgeGraphBuildGraph`（P0 最小版）
  - 是什么：针对单个知识库抽取概念、实体、主题和关系，生成图谱 proposal。
  - 为什么用：知识图谱不是一次 prompt 输出，需要 chunk、抽取、去重、链接已有节点、计算边权重。
  - 场景：为某个知识库构建可视化知识地图，为 RAG 和整理建议提供结构基础。

P1 Graph：

- `NoteRagGraph`
  - 是什么：检索、rerank、权限过滤、引用组织、回答生成的固定工作流。
  - 为什么用：RAG 不能只靠模型自由发挥，必须保证引用来源和权限边界。
  - 场景：用户问“我之前怎么设计协作鉴权的？”并返回带引用答案。
- `KnowledgeOrganizerGraph`
  - 是什么：自动标签、分类、主题整理和知识库健康检查的 proposal 工作流。
  - 为什么用：整理动作可能修改用户数据，必须先生成建议，再由用户确认。
  - 场景：批量整理未分类笔记、合并重复标签、建议知识库结构。
- `DuplicateDetectionGraph`
  - 是什么：基于 embedding、reranker、标题/标签/内容规则发现重复或高度相似笔记。
  - 为什么用：相似并不等于重复，需要多信号判断和人工确认。
  - 场景：提示“这 3 篇 JWT 笔记可能重复”，生成合并建议。
- `KnowledgeGraphInsightGraph`
  - 是什么：基于已构建图谱生成洞察、孤岛节点、强相关主题、薄弱主题。
  - 为什么用：图谱建出来后需要解释层，否则只是可视化点线。
  - 场景：告诉用户某个知识库有哪些知识孤岛、哪些主题值得补充。

P2 Graph：

- `ExternalImportGraph`
  - 是什么：外部网页、文档、仓库、会议记录导入为笔记的工作流。
  - 为什么用：外部导入需要抓取、清洗、去重、生成草稿、用户确认。
  - 场景：把网页文章、GitHub issue、会议纪要转为知识库笔记。
- `WeeklyReviewGraph`
  - 是什么：按时间范围汇总新增/修改笔记、主题变化、待办和知识缺口。
  - 为什么用：周报/月报是多源聚合和结构化输出，不是单次摘要。
  - 场景：生成个人学习周报、项目知识复盘、团队知识变更报告。
- `AutomationAgentGraph`
  - 是什么：面向 OpenClaw-like agent 的长任务编排层。
  - 为什么用：自动化任务需要工具权限、状态恢复、审批和审计。
  - 场景：定时整理知识库、监控外部资料、跨系统导入内容。

LangGraph 的价值：

- 节点状态清晰。
- 可插入校验和修复。
- 可做 human-in-the-loop。
- 可持久化 run 状态。
- 可审计每一步使用了什么模型和工具。

### 4.3 Tool Registry

工具不直接暴露数据库，而是调用业务 service 或 API。

P0 tools：

- `generateText`
- `generateJson`
- `generateEmbedding`
- `validateMindmapJson`
- `validateMermaid`

P1 tools：

- `searchNotes`
- `getNoteById`
- `listTags`
- `listCategories`
- `createDraftNote`
- `proposeTagChanges`
- `proposeCategoryChanges`

P2 tools：

- `fetchWebPage`
- `importExternalDocument`
- `scheduleReview`
- `createWeeklyReport`
- `notifyUser`

工具权限：

| 权限级别 | 行为 | 示例 |
| --- | --- | --- |
| Read | 可自动执行 | 搜索笔记、读取有权限笔记 |
| Propose | 可生成建议，不直接写 | 标签建议、合并建议 |
| Confirmed Write | 用户确认后执行 | 更新标签、保存导图 |
| Restricted | 默认禁用，需要单独授权 | 外部抓取、批量修改、定时任务 |

### 4.4 会话与记忆

当前 AI 宠物已经有浏览器 `localStorage` 会话痕迹，但“会话与长期记忆”本身会成为一个大模块，并且会和 RAG、Knowledge Graph、Agent Runtime 发生深度耦合。现阶段不建议把它作为 P0 主任务展开。

现阶段原则：

- P0 不设计长期记忆。
- P0 只保存 workflow run state，便于调试、重试和审计。
- P1 在 RAG 和知识整理稳定后，再设计用户可见、可删除、可迁移的会话记录。
- P2 在 Agent Runtime 落地时，再设计长期 memory 和自动化偏好。

P0 只需要保存：

```text
runId
graphName
knowledgeBaseId
userId
inputNoteIds
provider
model
status
resultSummary
error
createdAt
updatedAt
```

未来可能的会话类型：

1. `editor_session`：围绕当前 note 的写作会话。
2. `knowledge_session`：围绕某个 knowledgeBase 的问答会话。
3. `visual_session`：围绕 board/mindmap/knowledge graph 子图的生成和修改会话。
4. `automation_session`：围绕外部导入或定时任务的 agent 会话。

会话存储原则：

- P0 可以仍用前端本地状态和后端 workflow run state。
- P1 再进入后端会话存储，便于跨设备和审计。
- 不存储 secret。
- 长期 memory 必须可查看、可删除。

## 5. P0 / P1 / P2 优先级

### P0：稳定可用与架构收口

目标：修复当前 AI 可用性问题，并建立 provider 可切换基础。

需求：

1. AI Gateway 基础接口。
2. MiMoProvider 接入，使用用户的小米 tokenplan key。
3. SenseNova DeepSeekProvider 接入，使用商汤 key。
4. SiliconFlow QwenEmbeddingProvider 接入，使用 `Qwen/Qwen3-Embedding-8B`。
5. 预留 SiliconFlow QwenRerankerProvider 配置位和接口。
6. CozeProvider 不进入当前 P0/P1 fallback，仅作为历史适配器记录。
7. ZhipuEmbeddingProvider 不进入当前 P0/P1 embedding 路由，仅作为历史适配器记录。
8. 替换 `/api/ai/writer`、`/api/ai/mindmap`、`/api/ai/mermaid`、`/api/ai/summary` 的散落调用。
9. 用 LangGraph 承接聚合摘要 workflow，延续已替换的 Coze summary 场景。
10. Mindmap JSON 和 Mermaid 增加校验与修复。
11. `KnowledgeGraphBuildGraph` 最小版：只针对单个知识库，手动触发，生成 proposal，不自动写核心笔记。
12. 扩展 `check:ai-config` 到 MiMo、SenseNova DeepSeek、SiliconFlow Qwen embedding/reranker。
13. 所有 AI key 只允许服务端变量。

验收：

- 历史 Coze Workflow 401 不再影响聚合摘要主功能。
- `check:ai-config` 能检查当前启用 provider。
- 前端 AI 写作、摘要、导图、Mermaid 至少都有一个可用 provider。
- 某个知识库可以生成最小知识图谱 proposal。
- provider 失败时有明确错误，不静默失败。

### P1：知识工作流与工具调用

目标：让 AI 从“生成内容”升级为“辅助管理知识”。

需求：

1. RAG 笔记问答，带引用来源。
2. 自动标签/分类建议，用户确认后写入。
3. 主题发现从单纯 kmeans + AI Gateway 命名升级为可解释 proposal。
4. 重复笔记检测和合并建议。
5. 知识图谱持久化：node、edge、graph run、community。
6. reranker 正式进入 RAG、相似笔记和图谱边权重。
7. AI run 审计日志。
8. 后端会话存储的最小版本。
9. Tool Registry 接入 notes/tags/categories/boards/mindmaps。
10. 所有写工具必须 human-in-the-loop。

验收：

- 用户能问自己的笔记，并看到引用。
- AI 能给出整理建议，但不会自动乱改。
- 每次 AI 工作流有 run id、状态、错误和模型记录。
- 权限过滤在工具层强制执行。
- 图谱可按知识库隔离查看，不同知识库不会混图。

### P2：Agent Runtime 与外部业务线

目标：支持更长期、更自动化、更外部化的 agent 能力。

需求：

1. OpenClaw-like Agent Runtime 评估和接入。
2. 外部网页/文档导入。
3. 周报/月报/复盘自动生成。
4. 定时知识库整理。
5. 多 agent 协作：研究、整理、写作、图表。
6. Agent tool policy。
7. 用户级自动化配置和撤销机制。

验收：

- 外部资料能进入“待确认导入”队列。
- 自动任务不会直接写入核心数据，必须走 proposal/approval。
- 用户能查看 agent 做了什么、用了哪些来源、准备写什么。

## 6. 推荐实施顺序

### Phase 0：当前 AI 配置安全收尾

状态：进行中。

内容：

- 已新增 AI 配置检查脚本。
- 已移除 public Coze fallback。
- 已清理本地 `.env.local` 的 `NEXT_PUBLIC_COZE_*`。
- 仍需提交当前改动。
- 需要用户补充 MiMo、SenseNova DeepSeek、SiliconFlow Qwen embedding/reranker 的 key、baseURL 和 model id。

### Phase 1：Provider 接入与配置检查

优先文件：

- `notes-backend/src/modules/ai/*`
- `notes-frontend/src/app/api/ai/*`
- `scripts/check-ai-config.mjs`

内容：

- 定义 gateway/provider 接口。
- 接入 MiMo provider。
- 接入 SenseNova DeepSeek provider。
- 接入 SiliconFlow Qwen embedding provider。
- 预留 SiliconFlow Qwen reranker provider。
- Coze 不保留 fallback；如未来需要必须重新审批并接入后端 provider。
- 扩展配置检查。
- 跑 dry-run 和 live check，先确认所有 key 可用。

### Phase 2：AI Gateway 迁移现有功能

内容：

- `/api/ai/writer` 切到 AI Gateway。
- `/api/ai/mindmap` 切到 AI Gateway。
- `/api/ai/mermaid` 切到 AI Gateway。
- `/api/ai/summary` 不再依赖 Coze Workflow。
- 后端 `AiService.generateSummary` 逐步切到 AI Gateway。

### Phase 3：聚合摘要 LangGraph

承接 `/api/ai/summary` 已经从历史 Coze Workflow 迁出的摘要能力。

流程：

```text
selected notes
  -> sanitize and truncate
  -> per-note summary
  -> merge summary
  -> structure into sections
  -> return preview
  -> user saves
```

### Phase 4：Mindmap/Mermaid Graph

流程：

```text
prompt / note content
  -> generate
  -> validate
  -> repair
  -> normalize
  -> preview
  -> user saves
```

### Phase 5：知识库图谱最小版

内容：

- 新增 knowledge base 边界。
- 一个知识库内手动触发图谱构建。
- 抽取 node/edge proposal。
- 用户确认后持久化图谱结果。
- 子图可以生成 Mindmap/Mermaid。

### Phase 6：RAG 与知识整理

内容：

- NoteRagGraph。
- KnowledgeOrganizerGraph。
- tools 和权限策略。
- 审计日志。

### Phase 7：Agent Runtime

内容：

- 外部导入。
- 定时任务。
- 多 agent。
- tool policy。

## 7. 风险与边界

### 7.1 模型替换风险

MiMo/DeepSeek 可以替换大部分文本生成能力，但不等于 embedding provider。embedding 必须使用专门 embedding 模型，例如硅基流动 `Qwen/Qwen3-Embedding-8B`。reranker 也应使用专门 reranking 模型，例如 `Qwen/Qwen3-Reranker-8B`，不能让普通 chat 模型临时打分充当长期检索链路。

### 7.2 Agent 写入风险

Agent 不允许直接修改核心笔记、标签、分类、画板、导图。所有写操作必须先生成 proposal。

### 7.3 成本风险

长上下文、多轮、多笔记摘要会增加 token 成本。需要：

- 输入截断和分块。
- provider timeout。
- run 级别成本记录。
- 默认模型和高级模型分层。

### 7.4 权限风险

所有 AI tools 必须携带 `userId`，复用后端权限边界。模型不得直接接触未过滤的全库数据。

### 7.5 知识库隔离风险

知识图谱、embedding、rerank、RAG 默认必须按 `knowledgeBaseId` 隔离。全量笔记混图会带来三个问题：

- 无关主题相互污染，图谱可解释性下降。
- 跨权限、跨项目的内容可能被错误召回。
- 后续整理建议会把不同知识库的标签和分类混在一起。

跨知识库能力只能作为用户显式开启的高级模式。

### 7.6 可观测性风险

没有 run id 和错误归一化时，AI 问题很难排查。P1 前必须建立基本审计。

## 8. 最终建议

推荐路线：

1. P0 先完成 AI Gateway 和 provider 可切换。
2. 用 LangGraph 承接聚合摘要 workflow，这是当前最明确的高价值落点。
3. Mindmap/Mermaid 生成引入校验修复，提升可用性。
4. P1 再做 RAG、工具调用、知识整理和会话。
5. P2 才引入 OpenClaw-like agent runtime，用于外部自动化，不进入核心业务写链路。

一句话总结：

> 当前项目最需要的不是“全量 agent 化”，而是先把 AI 能力从散落调用收敛成稳定网关，再把真正需要状态和工具的业务升级为 LangGraph 工作流，最后再引入 OpenClaw-like agent 承接外部自动化。
