# 知识检索、模型基础设施、GraphRAG 与整理提案总执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已完成的主题/Chunk 向量、混合检索证据和知识图谱 UI 基础上，先补齐可复用的 AI 模型路由与证据基础设施，再依次交付只读 GraphRAG、知识整理提案和可撤销执行闭环。

**Architecture:** 整体按“运行环境与模型路由基础设施 → 检索和图谱证据层 → 只读 GraphRAG → 只读整理提案 → 可撤销写操作”构建。上层不得绕过下层权限、证据和审计接口；云端索引、额度和产品高风险决策设置为用户验收门，不由代码或代理猜测。

**Tech Stack:** Node.js 22、NestJS 10、Next.js 16、React 18、TypeScript、Mongoose 8、MongoDB Atlas Vector Search、Redis、BullMQ、React Flow、SiliconFlow、B.AI、AgentRouter、Jest、Node Test Runner。

## Global Constraints

- Node.js 统一使用 22.x；仓库只保留 npm 作为包管理器，禁止临时生成 pnpm lockfile 或混装依赖。
- 当前未提交的前端文件和用户资产不属于本计划，执行时不得覆盖、清理或顺带提交。
- 第一阶段已有代码先验收、修缺口，不重写已通过测试的主题向量、Chunk、混合搜索和图谱 UI。
- 每个 AI 调用声明 `AiTask`；业务代码不得直接拼接供应商 reasoning 参数。
- economy、standard、deep 分别使用 Qwen3.5-4B、Qwen3-14B、DeepSeek-V4-Flash；MiMo-V2.5 与 Hy3 不进入生产路由。
- AgentRouter Claude Opus 4.8 不是默认层级，只允许作为拆分合并、复杂返工、证据冲突和复杂 Mermaid 的专家 `qualityFallback`，且预算不低于 4096 token。
- SenseNova 已从活动运行时、配置模板和配置检查中移除；旧 SenseNova 专项文档只保留为历史决策与事故记录，不代表当前路由。
- `qualityFallback` 处理合法响应的质量问题；`providerFallback` 处理 429、超时、网络错误和临时 5xx；单次任务最多执行一个 fallback。
- 自动保存继续使用前端 400ms 防抖和后端按 note 10 秒静默合并；AI 派生任务必须进入可恢复队列，不得在保存请求或进程内 timer 中直接形成无界并发。
- 并发、RPM、TPM 按 provider 隔离；额度未知时采用可配置的保守值，不得把控制台套餐剩余百分比当作 RPM/TPM。
- 所有检索、图谱扩展和提案候选在模型调用前后都按服务端 `userId` 与 Note ACL 过滤。
- GraphRAG 回答必须引用真实 Chunk；没有证据时明确说明，不允许用模型自身知识伪造“你的笔记中记录了”。
- 第三阶段 AI 只生成 proposal；未经确认不得修改知识库、分类、标签或笔记正文。
- 拆分、合并和内容修改必须支持整批撤销，且保留原 NoteVersion 或等价快照。
- reasoning 不作为正文 fallback，不写入 summary、图谱、提案或用户回答。
- 复杂业务原因、权限边界、失败降级和不直观时序使用简洁中文注释；普通 CRUD 不写复述性注释。
- Commit message 使用中文，格式为 `类型(范围): 简述`。

---

## 一、当前代码事实基线（2026-08-27）

### 已完成并有代码/测试证据

| 能力 | 当前实现 | 验证证据 | 状态 |
| --- | --- | --- | --- |
| 主题向量来源 | `title + summary + categoryName + tagNames`，含来源哈希 | `note-vector-source.test.ts`、`note-vector-refresh.test.ts` | 已完成 |
| 自动保存派生调度 | 按 note 合并任务、静默执行、陈旧快照拒绝写回 | `note-derived-scheduler.test.ts`、`notes-async-metadata.test.ts` | 已完成 |
| 派生任务容量保护 | 同一 note 有 10 秒防抖；不同 note 仍可同时执行，timer 在重启后丢失；尚无 provider 级 RPM/TPM 预算 | `note-derived-scheduler.ts`、`ai-gateway.client.ts` | 待补齐持久化队列与全局限速 |
| Summary 时序 | 正文变化先生成 summary，再生成主题向量；SiliconFlow 失败可切换 B.AI | `note-vector-refresh.test.ts`、`ai-gateway.test.ts` | 已完成并迁移到新路由 |
| 结构化 Chunk | Markdown/HTML 标题路径、完整代码块、HTML 标签完整、重叠 | `note-chunker.test.ts` | 已完成 |
| Chunk embedding | 内容哈希复用、失败保留旧版、快照校验 | `note-chunk-index.test.ts` | 已完成 |
| Chunk 检索权限 | 服务端可读笔记范围、knowledgeBaseId 边界 | `chunk-retrieval-access.test.ts` | 已完成 |
| 关键词/向量/混合搜索 | 按 noteId 聚合，返回 bestChunk 和额外命中 | `semantic-search-chunk-evidence.test.ts` | 已完成 |
| 搜索命中 UI | 标题路径、命中 Chunk、额外命中数 | `semantic-search-evidence.spec.tsx` | 已完成 |
| 知识图谱生成/保存 | 已有 nodes、edges、warnings、事务替换 | `knowledge-graph-build-graph.test.ts`、`knowledge-graph-persistence.test.ts` | 已完成基础版 |
| 知识图谱可视化 | React Flow 关系网络、力导向布局、交互 | `knowledge-bases.spec.tsx`、`knowledge-graph-layout.spec.ts` | 已完成基础版 |
| 6 条测试笔记派生数据 | AI summary、4096 维主题向量、60 个 Chunk 向量完整；未改变业务 `updatedAt` | 2026-08-27 数据库只读验收 | 已完成真实回填 |
| 默认文本/推理路由 | text → SiliconFlow Qwen3-14B；reasoning → SiliconFlow DeepSeek-V4-Flash | `ai-gateway.test.ts`、live smoke test | 已完成 |
| 跨供应商容灾 | 策略声明的任务在 SiliconFlow 瞬时 provider 故障时可切换 B.AI DeepSeek-V4-Flash | `ai-gateway.test.ts` | 已完成 |
| AgentRouter 接入 | 固定 User-Agent；Claude Opus 4.8 只作为高风险任务专家质量目标 | live smoke test、固定任务评测 | 已完成受控路由 |

### 本轮实际验证

```text
后端单测：183 passed / 0 failed
后端 TypeScript 编译：通过
AI 配置检查：2 tests passed，dry-run 无警告
真实模型 smoke test：SiliconFlow standard/deep、B.AI fallback、AR expert 均为 HTTP 200 且正文非空
前端定向测试：3 suites、10 tests 断言通过
前端 type-check：通过
```

定向 Jest 因只运行少量测试而未达到仓库全局 8% coverage 阈值；这不代表断言失败。阶段验收仍需运行前端全量测试与正式 build。

### 明确未实现或仅部分实现

- `evidenceChunkIds` 图谱证据持久化；
- Query Planner、Query Rewrite、GraphRAG 编排；
- 笔记引用定位与 RAG 回答 UI；
- 全局知识库组织建议、增量归属建议；
- 标签/分类、重复、拆分、合并、内容修改 proposal；
- proposal 审核、执行日志和整批 undo。
- 可恢复的 Note 派生任务队列、跨实例并发限制和 provider 级 RPM/TPM 主动节流；当前只有同 note 防抖和请求失败后的指数退避。

### 外部状态未知，不得由代理推断

- Atlas `notes.vector_index` 与 `note_chunks.note_chunk_vector_index` 是否已创建且均为 4096 维；
- SiliconFlow、B.AI 与 AgentRouter 当前 key 的账户归属、余额和 RPM/TPM 限制；最小 live smoke 已通过，但不能替代控制台额度确认；
- 高风险 proposal 的撤销保留时间和是否允许部分执行。

---

## 二、优先级与依赖关系

| 优先级 | 层次 | 交付物 | 为什么现在做 | 阻塞下游 |
| --- | --- | --- | --- | --- |
| P0 | 开发与 AI 基础设施 | Node/npm 固化；AiTask；模型 adapter；两类 fallback；审计；评测；持久化派生队列与 provider 容量控制 | 所有新 AI 功能共用，避免每条链路重复踩供应商参数、空正文和 RPM/TPM 问题 | P1 回填、P2、P3、P4 |
| P1 | 已有第一阶段验收 | Atlas 索引确认；真实回填；搜索/图谱 UI 完整验收 | 代码已大体完成，应先形成可靠数据底座 | P2、P3 |
| P2 | 证据基础设施 | 图谱 node/edge 绑定 `evidenceChunkIds`；证据查询 API | GraphRAG 和可信提案都需要知道关系来自哪段原文 | P3、P4 |
| P3 | 只读上层建筑 | Query Planner、混合检索、图谱一跳扩展、rerank、引用回答 | 首个用户可感知的知识助手闭环，且无破坏性写入 | 无，建议先上线观察 |
| P4 | 只读下游提案 | 建库/归属、标签分类、重复、拆分合并 proposal 与返工 | 先验证建议质量，不急于写数据 | P5 |
| P5 | 写操作下游 | 逐条勾选、一键执行、事务日志、整批撤销 | 风险最高，必须建立在 proposal 质量和版本系统上 | 最终闭环 |

执行顺序固定为：

```text
P0 模型与运行环境
  ├── P1 第一阶段真实验收
  │      └── P2 图谱证据绑定
  │             ├── P3 GraphRAG
  │             └── P4 整理提案
  │                    └── P5 执行与撤销
  └── 固定评测与审计贯穿 P2～P5
```

P0 和 P1 在代码上可以交错推进，但 P2 之后不得继续使用旧 `text / reasoning` 路由创建新链路。

---

# P0：开发环境与 AI 模型路由基础设施

## Task 0.1：锁定 Node 22 与 npm

**Files:**
- Create: `.nvmrc`
- Modify: `package.json`
- Modify: `notes-backend/package.json`
- Modify: `notes-frontend/package.json`
- Create: `scripts/check-runtime.mjs`
- Test: `scripts/check-runtime.test.mjs`

**Produces:** Node 22.x 和 npm 的可执行前置检查；不自动修改用户 NVM 状态。

- [x] 编写 `check-runtime` 失败测试，覆盖 Node <22、错误包管理器 lockfile 和合法环境。
- [x] 添加 `.nvmrc`，内容固定为 `22`。
- [x] 在三个 `package.json` 增加 `engines.node: ">=22 <23"`；根 package 增加 `check:runtime`。
- [x] `check-runtime.mjs` 检查 `process.versions.node`、根 `package-lock.json` 和禁止出现的工作区级 pnpm lockfile；只报告修复命令，不自动切换 Node。
- [x] 使用 Node 22 运行 `node --test scripts/check-runtime.test.mjs` 和 `npm run check:runtime`。
- [x] 提交：`chore(项目): 固定 Node 与包管理器基线`。

## Task 0.2～0.7：实现模型分层、adapter、fallback、审计和评测

**Task-level reference:** [`2026-08-27-ai-model-routing-and-reasoning.md`](./2026-08-27-ai-model-routing-and-reasoning.md)。若其旧版单一 fallback 描述与本节冲突，以本总计划和模型路由设计文档为准。

按该计划 Task 1～7 执行，但将其中单一 `fallback` 接口修正为：

```ts
interface AiModelPolicy {
  primary: ModelTarget
  qualityFallback?: ModelTarget | LocalFallback
  providerFallback?: ModelTarget
}
```

执行约束：

- [x] 将 economy、standard、deep 策略表完整映射到所有 `AiTask`；业务调用点已迁移到 `chatTask / streamTask`。
- [x] 增加可选 `expertQualityTarget=AgentRouter claude-opus-4-8`；只映射到高风险 deep 任务且不作为默认 Provider。
- [x] AgentRouter adapter 注入固定 User-Agent，且不发送未经确认的 reasoning 参数。
- [x] SiliconFlow Qwen 的 `off` 映射为 `enable_thinking=false`。
- [x] 主模型出现结构/正文质量错误时只走 `qualityFallback`。
- [x] 将 B.AI `providerFallback` 扩展到策略表声明的任务。
- [x] 单次任务最多一个 fallback；400、401、403、安全拒绝和 ACL 拒绝不 fallback。
- [x] 流式响应只允许首个正文 chunk 之前切换 provider。
- [x] AI run 记录 task、reasoningMode、模型、耗时、重试、fallbackType 和校验结果，不记录完整正文/reasoning/key。
- [x] `AI_TASK_ROUTING_ENABLED=false` 时恢复迁移前的 text/reasoning 两级路由，便于灰度回退。
- [x] `AI_TASK_ROUTING_ENABLED=true` 已启用；默认 text/reasoning 和 `note_summary` live smoke 均通过。

## P0-A 检查点：恢复现有笔记 Summary（已完成）

该检查点在 standard 模型、SiliconFlow reasoning adapter 和 summary fallback 已通过单测后立即执行，不等待 GraphRAG、图谱证据或其他上层功能。

- [x] 按 `notes-backend/.env.example` 配置 SiliconFlow、B.AI 与 AR，并启用 `AI_TASK_ROUTING_ENABLED=true`。
- [x] `note_summary` 使用 SiliconFlow `Qwen/Qwen3-14B` 且 `enable_thinking=false`，持续 429/503 时切换 B.AI。
- [x] 长文本 live smoke 返回非空正文，没有把 reasoning 写入 summary。
- [x] dry-run 只筛选 6 篇 `summarySource=fallback` 的测试笔记，用户确认后执行。
- [x] 按 summary → 主题向量 → Chunk 顺序逐篇重建，并在中断后只读核对实际状态。
- [x] 派生写回未改变 Note 业务 `updatedAt`。
- [x] 6 篇均为 AI summary；主题向量均为 4096 维；60 个 Chunk embedding 全部完整。
- [x] Summary 恢复完成，后续继续 P0 剩余任务路由、审计和固定评测。

## Task 0.8：持久化 Note 派生队列与 provider 容量控制

**现状约束：** 前端已在 400ms 后自动保存；`NoteDerivedScheduler` 已按 `noteId` 合并 10 秒静默期内的更新；`NotesService` 对无实际变化的保存不调度；长摘要的分段请求已串行；`AiGatewayClient` 已对 429/502/503/504 和网络错误执行最多两次指数退避重试。实现时保留这些正确行为，不重复实现第二套前端保存队列，也不把知识图谱提案或 RAG 查询错误地挂到自动保存上。

**Files:**
- Modify: `notes-backend/package.json`
- Modify: `notes-backend/src/modules/notes/note-derived-scheduler.ts`
- Modify: `notes-backend/src/modules/notes/note-derived.service.ts`
- Modify: `notes-backend/src/modules/notes/notes.module.ts`
- Create: `notes-backend/src/modules/notes/note-derived-job.types.ts`
- Create: `notes-backend/src/modules/notes/note-derived-queue.service.ts`
- Create: `notes-backend/src/modules/notes/note-derived.worker.ts`
- Create: `notes-backend/src/modules/ai/ai-provider-capacity.service.ts`
- Modify: `notes-backend/src/modules/ai/ai-gateway.client.ts`
- Modify: `notes-backend/.env.example`
- Test: `notes-backend/test/note-derived-queue.test.ts`
- Test: `notes-backend/test/ai-provider-capacity.test.ts`
- Test: `notes-backend/test/notes-update-access.test.ts`
- Create: `docs/runbooks/ai-derived-job-operations.md`

**Architecture:** 复用现有 Redis，使用 BullMQ 保存 Note 派生任务；job 只保存 noteId、userId、变化类型和 `expectedUpdatedAt`，worker 执行前重新读取 Note 并验证快照，不能把整篇正文复制到 Redis。使用稳定 `jobId=note-derived:<noteId>` 合并静默期内更新，不同进程共享同一去重与并发边界。AI Gateway 每次 provider 请求前通过 Redis 原子预算器预约请求数和估算 token；实际 usage 可得时回写差额，不可得时保留保守估算。

- [x] 先写失败测试，证明同一 note 连续自动保存只留下最后一个 delayed job，不同 note 不互相覆盖，进程重新创建 queue 后未完成 job 仍存在。
- [x] 引入 BullMQ，复用 `REDIS_URL`，为 queue、worker 和测试提供显式生命周期关闭，禁止测试进程悬挂。
- [x] 将 `NoteDerivedScheduler` 从进程内 `Map + setTimeout` 改为持久化 delayed job；保留 10 秒 quiet period，并把 title/content/taxonomy 变化做并集合并。
- [x] worker 处理前按 noteId/userId 重新读取当前 Note；若 `updatedAt` 已变化，丢弃陈旧 job 或用最新快照重新排队，禁止旧 summary、主题向量或 Chunk 覆盖新正文。
- [x] worker 内保持单篇笔记 `summary → topic embedding → Chunk embedding` 时序；长摘要分段继续串行，不新增同笔记分段并发。
- [x] provider 容量服务至少区分 `siliconflow`、`bai`、`ar`，配置 `*_AI_MAX_CONCURRENCY`、`*_AI_RPM`、`*_AI_TPM`；配置缺失时使用文档化的保守默认值，测试不得依赖真实供应商。
- [x] 使用 Redis Lua 或等价原子操作完成滚动分钟 RPM/TPM 预约；多个 Nest 实例不能各自独立计数。等待容量时 job 保持 delayed/waiting，不占用 worker 并发槽忙等。
- [x] token 预算基于消息输入估算加 `maxTokens` 预约；响应含 usage 时校正，供应商未返回 usage 时不伪造精确消耗。fallback 必须按实际目标 provider 重新预约预算。
- [x] 保留 Gateway 已有 `Retry-After` 与指数退避；容量服务负责请求前削峰，Gateway retry 负责请求后的瞬时故障，两者不能互相递归或无限重试。
- [x] 为 job 记录 status、attempts、nextRunAt、lastErrorCode 和耗时，不保存 API key、完整正文、prompt、reasoning 或模型完整响应；失败达到上限后进入 failed 集合并可按 noteId 安全重放。
- [x] 增加运行手册：查看 waiting/active/delayed/failed 数量、按 noteId 重放、暂停/恢复 worker、调整并发/RPM/TPM；不要求用户粘贴 key。
- [x] 故障测试覆盖 Redis 短暂不可用、worker 重启、429 Retry-After、容量等待、陈旧快照、任务重放和多实例竞争。
- [x] 验收：模拟 20 篇笔记同时更新，保存 API 不等待 AI；实际 active 数不超过配置；同 note 只执行最新派生任务；重启后任务继续；无旧派生字段覆盖；后端全量单测和 build 通过。
- [x] 提交：`feat(ai): 增加持久化派生队列与容量控制`。

**P0 Exit Gate:**

- [x] 当前后端 183 个单测和 build 通过。
- [x] 20 个固定 live 样例覆盖摘要、图谱、提案、RAG：有效率 100%、空正文率 0%；Qwen3-14B 四条链路 P95 均小于 1.3 秒。
- [x] SiliconFlow standard/deep 与 AR expert live smoke 均为 HTTP 200；B.AI provider fallback 通过故障注入测试。
- [x] 故障注入验证 quality/provider 两条 fallback 不串联，流式输出开始后不切换 provider。
- [x] Task 0.8 的持久化队列、跨实例并发、RPM/TPM 预约、重启恢复和 20 篇笔记突发验收通过。
- [ ] live smoke 已通过；仍需用户在控制台完成 U1 的账户归属、余额与 RPM/TPM 确认。

---

# P1：收口第一阶段并验证真实数据

## Task 1.1：把原计划进度转换为可重复验收

**Files:**
- Modify: `scripts/check-semantic-search.mjs`
- Modify: `notes-backend/scripts/backfill-note-vectors.ts`
- Modify: `notes-backend/test/backfill-note-vectors.test.ts`
- Create: `docs/runbooks/note-vector-and-graph-verification.md`

**Produces:** 一条不泄密的检查命令和一份用户可操作 runbook。

- [ ] 检查脚本分别报告普通 MongoDB index 与 Atlas Vector Search index，不能把同名 B-tree index 误判为 Vector Search。
- [ ] 报告期望契约：`notes.vector_index / embedding / 4096` 和 `note_chunks.note_chunk_vector_index / embedding / 4096`。
- [ ] 回填报告补充 `summaryAi / summaryPassthrough / summaryFallback / topicSucceeded / chunkSucceeded / failedNoteIds`。
- [ ] 回填后抽样校验 headingPath 不只包含笔记标题、HTML 标签闭合、embedding 长度为 4096。
- [ ] runbook 只要求用户执行控制台权限内的动作，不要求用户粘贴密钥或数据库连接串到聊天。
- [ ] 运行回填单测、语义搜索单测和后端 build。
- [ ] 提交：`chore(search): 固化向量与回填验收流程`。

## Task 1.2：完成搜索与图谱 UI 发布验收

**Files:**
- Test: `notes-frontend/__tests__/semantic-search-evidence.spec.tsx`
- Test: `notes-frontend/__tests__/knowledge-bases.spec.tsx`
- Test: `notes-frontend/__tests__/knowledge-graph-layout.spec.ts`
- Modify only if a verified defect exists: `notes-frontend/src/components/notes/*`、`notes-frontend/src/components/knowledge-bases/*`、对应样式文件。

- [ ] 先处理当前工作区未提交前端变更的归属：用户改动继续保留；本任务不得自动提交它们。
- [ ] 运行前端全量 Jest、`npm run type-check` 和 `npm run build`，不能只依赖定向测试。
- [ ] 使用真实 6 条笔记验证 keyword/vector/hybrid 三种模式；结果按笔记去重，命中 Chunk 可展开且 preview 是纯文本。
- [ ] 知识库图谱验证空态、saved/proposal、warnings、长节点名、缩放、拖拽、节点筛选和窄屏。
- [ ] 只有复现的 UI 缺陷才进入修复；不得因计划文本与现状不同而重写已通过界面。
- [ ] 提交：`test(frontend): 收口搜索与图谱发布验收`，若没有代码变化则不制造空提交。

**P1 Exit Gate:**

- [ ] 用户完成“U2 Atlas 索引确认”。
- [x] U3 真实回填已由用户确认并执行。
- [x] 6 条笔记无空 embedding、错误 headingPath 或正文式假 summary。
- [ ] 前后端全量测试、type-check 和 build 通过。
- [ ] 搜索和图谱 UI 由用户完成一次视觉确认。

---

# P2：图谱与原文 Chunk 证据绑定

## Task 2.1：持久化受权限约束的图谱证据

**Files:**
- Modify: `notes-backend/src/modules/knowledge-bases/schemas/knowledge-graph-node.schema.ts`
- Modify: `notes-backend/src/modules/knowledge-bases/schemas/knowledge-graph-edge.schema.ts`
- Modify: `notes-backend/src/modules/knowledge-bases/dto/index.ts`
- Modify: `notes-backend/src/modules/ai/graphs/knowledge-graph-build.graph.ts`
- Modify: `notes-backend/src/modules/knowledge-bases/knowledge-bases.service.ts`
- Modify: `notes-backend/test/knowledge-graph-build-graph.test.ts`
- Modify: `notes-backend/test/knowledge-graph-persistence.test.ts`

**Produces:** node/edge 的 `evidenceChunkIds: ObjectId[]`；保存时重新验证 user、knowledgeBase、note 三层边界。

- [ ] 先写失败测试：模型返回知识库外、其他用户或不属于 node.noteIds 的 Chunk ID 时必须被剔除。
- [ ] 图谱构建输入改为标题、summary 与有界 Chunk 证据；模型只能返回输入中出现的 Chunk ID。
- [ ] 保存时查询 `NoteChunk` 再校验，不能信任模型或客户端 ID。
- [ ] 保留旧 `noteIds` 兼容导航；旧图谱无 evidence 时仍可读取。
- [ ] 删除/移出知识库的笔记必须清理失效证据引用，不能删除其他笔记共享节点。
- [ ] 运行知识图谱和权限测试并提交：`feat(graph): 绑定图谱与原文证据`。

## Task 2.2：提供只读证据查询接口

**Files:**
- Modify: `notes-backend/src/modules/knowledge-bases/knowledge-bases.controller.ts`
- Modify: `notes-backend/src/modules/knowledge-bases/knowledge-bases.service.ts`
- Modify: `notes-backend/openapi.yaml`
- Create: `notes-backend/test/knowledge-graph-evidence-access.test.ts`
- Modify: `notes-frontend/src/lib/api/knowledge-bases.ts`

**Produces:** 点击 node/edge 时返回 `{ noteId, noteTitle, chunkId, headingPath, excerpt }[]`。

- [ ] 接口始终重新应用 NoteAccess；图谱中残留 ID 不得扩大读权限。
- [ ] excerpt 服务端截断并转纯文本，完整正文仍从现有笔记接口按权限读取。
- [ ] 无证据的旧图谱返回空数组和兼容提示，不返回 500。
- [ ] 更新 OpenAPI、API client、权限测试并提交：`feat(graph): 查询节点原文证据`。

**P2 Exit Gate:**

- [ ] 新生成图谱的节点与主要边具有可点击的真实 Chunk 证据。
- [ ] 伪造 Chunk ID、跨用户和移出知识库场景全部被测试拒绝。
- [ ] 旧图谱仍可展示。

---

# P3：只读 GraphRAG 助手

## Task 3.1：实现确定性 Query Planner

**Files:**
- Create: `notes-backend/src/modules/ai/rag/query-planner.service.ts`
- Create: `notes-backend/src/modules/ai/rag/rag.types.ts`
- Create: `notes-backend/test/query-planner.test.ts`

**Produces:**

```ts
interface RagPlan {
  intent: 'lookup' | 'explain' | 'compare' | 'user_history' | 'organize'
  tools: Array<'keyword' | 'chunk_vector' | 'graph_expand' | 'rerank'>
  reasoningMode: 'off' | 'deep'
  graphHops: 0 | 1
}
```

- [ ] 本地规则先处理空问题、精确标题、普通解释、比较/冲突、用户经历和整理请求。
- [ ] 普通解释默认 `chunk_vector + rerank`；出现“我的笔记/当时踩坑”同时检索关键词；跨概念关系才启用一跳图谱。
- [ ] 禁止默认每次执行图谱扩展；首版 `graphHops` 上限固定为 1。
- [ ] 只有比较、冲突和高风险整理意图使用 deep。
- [ ] 低置信度才调用 economy Query Planner；调用失败使用固定安全工具组。
- [ ] 运行测试并提交：`feat(rag): 实现轻量查询规划`。

## Task 3.2：编排 Chunk 检索、图谱扩展和 rerank

**Files:**
- Create: `notes-backend/src/modules/ai/rag/rag-retrieval.service.ts`
- Modify: `notes-backend/src/modules/semantic/chunk-retrieval.service.ts`
- Modify: `notes-backend/src/modules/knowledge-bases/knowledge-graph.service.ts`
- Create: `notes-backend/test/rag-retrieval-access.test.ts`

**Produces:** 去重后的 `RagEvidence[]`，包含 note、chunk、headingPath、score、graphPath。

- [ ] Query rewrite 仅为检索生成 1 个规范问题和最多 3 个关键词，不改变用户原问题。
- [ ] 首轮获取有界 Chunk；图谱扩展只从命中 Chunk 对应节点出发取一跳邻居证据。
- [ ] 所有扩展证据重新校验 ACL 与 knowledgeBase 边界。
- [ ] 去重后最多向 reranker 提交 30 条，最终上下文最多 8～12 条；不得把整个知识库塞进 prompt。
- [ ] reranker 失败退回 RRF/原始分数；不得让问答整体失败。
- [ ] 同一 Agent 请求内按工具参数去重，不增加跨请求 Chunk 结果缓存。
- [ ] 运行权限与预算测试并提交：`feat(rag): 编排图谱增强检索`。

## Task 3.3：生成带可验证引用的回答

**Files:**
- Create: `notes-backend/src/modules/ai/rag/rag-answer.service.ts`
- Modify: `notes-backend/src/modules/ai/ai.controller.ts`
- Modify: `notes-backend/src/modules/ai/dto/index.ts`
- Modify: `notes-backend/openapi.yaml`
- Create: `notes-backend/test/rag-answer-grounding.test.ts`

**Produces:** `{ answer, citations, planSummary, warnings }` 的非流式首版响应。

- [ ] prompt 明确区分通用知识和“用户笔记经历”；用户经历只能来自证据。
- [ ] 模型引用使用内部 evidence ID，服务端映射成 noteId/chunkId；无效引用剔除并产生 warning。
- [ ] 普通回答使用 standard/off；证据冲突分析使用 deep。
- [ ] 没有足够证据时回答“笔记中未找到”，不得编造标题、坑或解决方式。
- [ ] 首版先使用非流式响应保证引用与正文原子一致；通过后再设计流式事件协议。
- [ ] 运行 grounding、权限和模型 fallback 测试并提交：`feat(rag): 生成带笔记引用的回答`。

## Task 3.4：实现知识助手 UI 与引用定位

**Files:**
- Modify: `notes-frontend/src/components/ai/ChatWindow.tsx`
- Modify: `notes-frontend/src/lib/ai-client.ts`
- Create: `notes-frontend/src/components/ai/RagCitationList.tsx`
- Create: `notes-frontend/__tests__/rag-chat-answer.spec.tsx`

- [ ] 明确显示“基于你的笔记”与“通用补充”，引用展示笔记标题和 headingPath。
- [ ] 点击引用打开现有笔记页面并携带 chunk/heading 定位参数；定位失败仍能打开笔记。
- [ ] 展示检索不足、图谱未启用、rerank 降级等用户可理解提示，不暴露 provider 错误详情。
- [ ] 宠物聊天保持独立；知识型问题可显式转到知识助手，不让宠物组件直接读取 Chunk。
- [ ] 运行组件测试、type-check、build，并完成窄屏/暗色视觉检查。
- [ ] 提交：`feat(frontend): 展示 GraphRAG 回答引用`。

**P3 Exit Gate:**

- [ ] “React Diff 是什么”能命中相关 Chunk 并引用正确笔记。
- [ ] “我当时踩了什么坑”只回答真实记录，没有证据时明确说明。
- [ ] 普通问题不必走图谱；关系/比较问题最多一跳扩展。
- [ ] 任何引用都能追溯到当前用户可读的原文 Chunk。
- [ ] P95、上下文条数和 token 使用进入 AI run 评测报告。

---

# P4：只读知识整理提案

## Task 4.1：定义 Proposal 契约与只读生成

**Files:**
- Create: `notes-backend/src/modules/organizer/schemas/organizer-proposal.schema.ts`
- Create: `notes-backend/src/modules/organizer/organizer-proposal.service.ts`
- Create: `notes-backend/src/modules/organizer/organizer.module.ts`
- Create: `notes-backend/test/organizer-proposal.test.ts`

**Produces:** 版本化 proposal，action 类型固定为 `create_knowledge_base | move_note | add_tag | set_category | merge_notes | split_note | rewrite_note`。

- [ ] proposal 保存输入 noteId、expectedUpdatedAt、证据 Chunk、reason、riskLevel、状态和模型审计 ID。
- [ ] 建库/归属/标签属于低风险；merge/split/rewrite 属于高风险且使用 deep。
- [ ] 生成阶段只写 proposal 集合，不修改任何 Note、Tag、Category 或 KnowledgeBase。
- [ ] 每个 action 的 noteId、category/tag 和证据均重新应用用户权限。
- [ ] 笔记在 proposal 后更新时 action 标记 stale，执行前必须返工。
- [ ] 运行 schema、权限、陈旧检测测试并提交：`feat(organizer): 生成只读整理提案`。

## Task 4.2：支持全局批量建议与增量归属

**Files:**
- Create: `notes-backend/src/modules/organizer/organizer-planning.service.ts`
- Create: `notes-backend/test/organizer-planning.test.ts`

- [ ] 达到配置阈值才生成首次全局组织提案；不要求用户手工选一批笔记。
- [ ] 初次提案基于主题向量聚类、标题/summary 和现有分类标签，建议创建哪些知识库及归属。
- [ ] 新笔记优先比较已有知识库主题；只有低于归属阈值时才建议新建知识库。
- [ ] 保存提案历史和采用结果，后续增量判断使用已确认结构，不把被拒绝建议当事实。
- [ ] 阈值只放配置，不在首版引入自动学习。
- [ ] 运行全局/增量/拒绝历史测试并提交：`feat(organizer): 支持增量知识库规划`。

## Task 4.3：实现审核、改名、勾选和返工 UI

**Files:**
- Create: `notes-frontend/src/components/organizer/OrganizerProposalPanel.tsx`
- Create: `notes-frontend/src/components/organizer/OrganizerActionDiff.tsx`
- Create: `notes-frontend/__tests__/organizer-proposal.spec.tsx`

- [ ] 用户可逐条勾选、修改知识库名称、查看证据和风险等级。
- [ ] 内容修改展示 diff；split 显示每段去向；merge 显示来源、去重和目标结构。
- [ ] 用户修改意见生成新 revision，旧 revision 保留只读，不能覆盖历史。
- [ ] P4 页面没有“一键自动执行”入口，只提供确认清单，为 P5 准备。
- [ ] 运行测试、type-check、build 和视觉验收并提交。

**P4 Exit Gate:**

- [ ] 用户能审阅并返工 proposal，但数据库业务实体没有被 AI 自动修改。
- [ ] 所有高风险 action 有 diff、证据和 stale 检查。
- [ ] 用户完成“U4 高风险执行策略确认”后才能进入 P5。

---

# P5：逐条执行与整批撤销

## Task 5.1：实现执行计划、事务边界和 Undo Journal

**Files:**
- Create: `notes-backend/src/modules/organizer/schemas/organizer-execution.schema.ts`
- Create: `notes-backend/src/modules/organizer/organizer-execution.service.ts`
- Create: `notes-backend/test/organizer-execution.test.ts`

- [ ] 执行请求只接受已确认 action ID，不接受客户端重传任意修改内容。
- [ ] 执行前再次检查 ACL、expectedUpdatedAt、引用实体和 proposal revision。
- [ ] 建库、归属、标签分类按 MongoDB transaction 执行，并保存反向操作。
- [ ] rewrite/split/merge 先创建 NoteVersion 或完整快照，再创建/更新目标笔记；任何一步失败整批回滚。
- [ ] journal 记录执行者、时间、proposal revision、前后 ID 映射和可撤销截止时间，不保存 reasoning。
- [ ] 重复提交使用 idempotency key 返回同一 execution，不重复写数据。
- [ ] 运行事务、并发、幂等和权限测试并提交：`feat(organizer): 执行已确认整理动作`。

## Task 5.2：实现整批撤销与冲突处理

**Files:**
- Modify: `notes-backend/src/modules/organizer/organizer-execution.service.ts`
- Create: `notes-backend/test/organizer-undo.test.ts`

- [ ] undo 只针对同一 execution 整批执行，不首版支持任意部分撤销。
- [ ] 若执行后目标笔记又被用户编辑，undo 返回冲突清单，不覆盖新内容。
- [ ] 新建知识库只有在无 execution 外部新增内容时才能删除，否则仅恢复归属并保留知识库。
- [ ] undo 本身幂等并记录新的审计事件。
- [ ] 运行冲突、幂等、版本恢复和事务测试并提交：`feat(organizer): 支持整批撤销`。

## Task 5.3：开放一键执行与撤销 UI

- [ ] 只有被勾选且未 stale 的 action 可执行。
- [ ] 高风险动作要求二次确认，显示会创建/修改/归档哪些笔记。
- [ ] 执行完成展示 execution 摘要和撤销截止时间。
- [ ] 冲突时展示需要人工处理的笔记，不用模型自动覆盖。
- [ ] 完成 E2E、窄屏、暗色和异常恢复验收。

---

## 三、只由用户完成的事项

以下事项需要账户所有权、云控制台权限或产品责任判断。执行代理只提供检查命令和准确步骤，不循环猜测或替用户做决定。

### U1：API 配置与额度确认（P0 Exit Gate）

你需要：

1. 确认 `SILICONFLOW_API_KEY`、`BAI_API_KEY` 与 `AR_API_KEY` 属于预期账户或 Workspace；
2. 确认硅基流动允许 Qwen3.5-4B、Qwen3-14B、DeepSeek-V4-Flash；
3. 确认 B.AI DeepSeek-V4-Flash 的 RPM/TPM 和当前活动额度；
4. 确认 AgentRouter 可调用 `claude-opus-4-8`，并接受其专家链路较高延迟和 4096～8000 token 预算；
5. 如果 live smoke test 返回 401/403/配额错误，只提供错误码和 request ID，不发送 key。

代理负责：实现配置检查、发送最小 smoke test、解析结果和调整代码。不会反复请求模型来猜额度。

### U2：Atlas Vector Search 索引确认（P1 Exit Gate）

你需要在 Atlas 控制台确认或创建：

```text
notes.vector_index
  path: embedding
  dimensions: 4096
  similarity: cosine

note_chunks.note_chunk_vector_index
  path: embedding
  dimensions: 4096
  similarity: cosine
```

代理负责提供并运行只读诊断脚本。若当前数据库账号没有 Search Index 管理权限，代理不会伪装已经创建成功。

### U3：真实回填确认（已完成）

2026-08-27 已在用户确认后完成 6 篇测试笔记重建：全部写入 AI summary，主题向量均为 4096 维，60 个 Chunk embedding 完整，业务 `updatedAt` 未变化。以后若数据数量或性质变化，再次覆盖重建仍需重新确认范围。

### U4：高风险执行策略确认（P4 → P5 Gate）

在实现写操作前，你需要确认：

- undo journal 保留天数；建议首版 30 天；
- merge 后来源笔记是归档还是删除；建议归档；
- split 后原笔记是保留、归档还是替换；建议归档并链接新笔记；
- 是否允许只执行 proposal 的一部分；建议允许逐条勾选，但一次提交形成一个整批 execution；
- 执行后用户又编辑笔记时，是否禁止强制 undo；建议禁止自动覆盖并提示冲突。

在这些选择确认前，代理只实现 P4 的只读 proposal，不开始 P5。

---

## 四、发布检查点

### Release A：第一阶段可靠基线

- P0、P1 完成；
- 新模型路由可通过 feature flag 灰度；
- 真实搜索、Chunk 证据和知识图谱 UI 可用；
- 尚无 GraphRAG 和自动整理写入。

### Release B：只读 GraphRAG

- P2、P3 完成；
- 回答带真实笔记引用；
- planner 不会每次启用图谱；
- 无业务写操作。

### Release C：只读整理提案

- P4 完成；
- 支持全局与增量组织建议、勾选、改名、diff 和返工；
- 未确认动作不执行。

### Release D：可撤销整理闭环

- P5 完成；
- 逐条确认、一键执行、整批撤销、并发冲突保护全部通过。

---

## 五、下一步执行顺序

立即开始且不需要额外产品决策的工作：

1. 执行 Task 0.8：持久化 Note 派生队列、跨实例并发和 provider RPM/TPM 容量控制；
2. 用户在供应商控制台完成 U1 账户归属、余额与 RPM/TPM 确认，按真实限制调整环境变量后关闭 P0 Exit Gate；
3. Task 1.1 完善 Atlas 索引/回填诊断与 runbook；
4. Task 1.2 运行前端全量测试、正式 build 和搜索/图谱视觉验收；
5. 用户完成 U2 Atlas Search Index 确认；U3 已完成；
6. P1 Exit Gate 关闭后进入 P2 图谱证据绑定。

禁止提前并行实现 P4/P5。它们依赖 P0 的模型审计、P2 的证据和 P3 暴露出的真实检索质量；提前开发只会把不稳定推理结果直接变成高风险写操作。
