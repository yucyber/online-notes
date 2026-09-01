# 全屏助手、多会话与认知轨迹设计

## 目标

在保留现有小助手浮层的基础上，新增独立全屏助手工作台，并将当前浏览器单会话升级为可跨设备同步的服务端多会话。RAG 回答改为结构化流式输出，引用可以在助手内阅读命中 Chunk 并定位到笔记原文。长期记忆不采用不可见的自动用户画像，而采用必须由用户确认、具有原始证据和时间演进关系的“认知轨迹”。

## 产品原则

- 现有助手浮层已满足快速提问需求，不扩大、不推挤 Dashboard 主界面。
- 全屏助手承载会话管理、深度对话、Chunk 阅读和认知轨迹。
- 普通聊天与 RAG 共用会话和 UI，但继续使用独立后端能力链路。
- 笔记证据、历史对话和已确认认知是三类不同来源，必须分别标识。
- 模型只能生成长期记忆候选，未经用户确认不得参与后续回答。
- 所有笔记引用和认知节点都必须可追溯到仍有权限访问的原始证据。
- MongoDB 是会话事实源，Redis 只管理运行态，localStorage/sessionStorage 只保存 UI 状态，JSONL 只用于导入、导出和审计。

## 范围拆分

该能力按四个可独立验收的阶段实施：

1. 结构化流式 RAG 与统一消息生命周期。
2. 全屏助手工作台、Chunk 阅读器与无损返回。
3. 服务端多会话、上下文压缩、搜索和分支。
4. 待确认认知候选、时间演进与受控召回。

每个阶段完成后都应保持现有普通聊天、RAG ACL、知识库和助手浮层可用。

## 一、结构化流式 RAG

### 传输协议

`POST /api/ai/rag/answer` 改为结构化 SSE。普通聊天随后迁移到相同事件协议，前端只维护一个流式客户端。

事件类型如下：

```text
event: status
data: {"stage":"retrieving","message":"正在检索笔记"}

event: status
data: {"stage":"answering","message":"已找到 3 个相关片段"}

event: delta
data: {"text":"根据你的笔记，当前结论是……[E1]"}

event: complete
data: {"messageId":"...","citations":[],"warnings":[],"planSummary":{},"runId":"..."}

event: error
data: {"code":"PROVIDER_UNAVAILABLE","message":"回答生成中断","retryable":true}
```

检索阶段已经知道候选 Chunk，但正式引用必须等回答完成并校验 `[E1]` 后确定。因此正文先流式呈现，经过校验的引用卡片在 `complete` 事件后出现。候选证据不得提前冒充正式引用。

### 请求幂等与恢复

每次发送包含：

```ts
interface AssistantRequest {
  conversationId: string
  requestId: string
  question: string
  knowledgeBaseId?: string
}
```

服务端对 `(userId, requestId)` 建立唯一约束。同一个请求在关闭浮层、切换全屏页面、刷新或多标签页订阅时只生成一次。Redis 保存运行中的 generation 状态、取消标记和发布事件；MongoDB 保存用户消息、assistant 占位消息和最终生命周期。

正文增量按时间或字符数批量写入 MongoDB，例如每 500ms 或新增 200 字符落库一次，完成、失败或取消时强制保存最终状态。不得为每个 token 单独写数据库。

### 消息状态

assistant 消息状态为：

```text
pending -> streaming -> completed
                     -> failed
                     -> cancelled
```

失败和取消保留已经生成的文本。重新回答创建新消息并通过 `retryOfMessageId` 关联旧回答，不覆盖历史。用户主动停止时，后端记录 `cancelled` 并终止后续 provider 输出。

### 安全边界

- RAG 继续执行 NoteAccess、knowledgeBase、Chunk 可见性、引用清洗和 warning 规则。
- 普通聊天不得读取 Chunk 或伪造笔记引用。
- 断线恢复不得绕过 JWT 或订阅其他用户的 generation。
- 客户端只展示稳定错误文案，不暴露 provider、模型密钥或内部堆栈。

## 二、全屏助手工作台

### 路由与入口

新增：

```text
/dashboard/assistant
/dashboard/assistant?conversation=<conversationId>
```

现有浮层只增加“展开”入口，并与全屏页面共享当前 `conversationId`、服务端消息和 generation。浮层尺寸、定位和现有快速提问交互保持不变。

### 桌面布局

全屏页面采用三栏：

```text
会话列表 260px | 对话 minmax(520px, 1fr) | 上下文 360-440px
```

- 左栏：新建、搜索、按时间分组、重命名、归档和删除。
- 中栏：消息流、状态、流式回答、引用标记和共享输入区。
- 右栏：引用 Chunk、认知轨迹和会话信息。
- 小于 1180px 时右栏变为覆盖式抽屉。
- 移动端单栏显示，通过“会话 / 对话 / 上下文”切换。

页面沿用现有 product token、排版和克制的纸张式视觉，不引入独立颜色系统或通用大气泡界面。

### 会话列表行为

- 首次发送消息时才持久化新会话，避免空会话堆积。
- 自动生成标题，用户可重命名。
- 按今天、最近七天和更早分组。
- 搜索标题与消息正文，并定位到命中消息。
- 展示生成中、失败和未读完成状态。
- 删除采用软删除，并停止该会话运行中的 generation。

### 共享输入区

浮层与全屏页面复用同一个 compose 组件，支持 Enter 发送、Shift+Enter 换行、强制搜索笔记、选择知识库范围、停止生成、失败重试和分会话草稿。附件和图片聊天不属于本阶段。

## 三、Chunk 证据阅读与导航恢复

### 公共证据组件

将知识图谱证据和助手引用阅读统一到 `ChunkEvidenceViewer`：

- 展示笔记标题、headingPath、完整 Chunk 和更新时间。
- 高亮与问题或回答对应的命中语句。
- “展开上下文”只加载前后相邻 Chunk，不默认加载整篇笔记。
- 同一回答的多个引用可以在右栏切换。
- “定位到原文”才导航到笔记编辑器。

引用阅读每次都通过后端重新校验 NoteAccess。citation 中的 excerpt 只是历史快照，用户失权后不得继续作为可读正文返回。Chunk 因重新索引失效时，后端按 headingPath 尝试定位最新 Chunk，并明确标记已重新定位；无法定位时仍可打开笔记顶部，但不得伪造命中位置。

### 导航快照

进入笔记前在当前标签页的 `sessionStorage` 保存：

```ts
interface AssistantNavigationSnapshot {
  conversationId: string
  messageId: string
  citationId: string
  scrollAnchorMessageId: string
  contextPanelTab: string
  expandedChunkIds: string[]
}
```

返回时恢复原会话、消息锚点、引用面板、Chunk 展开状态和输入草稿。运行中的回答重新订阅，不重复请求。

需要覆盖两条路径：

- 浮层 → 引用 → 笔记 → 返回后恢复浮层。
- 全屏助手 → 定位原文 → 返回后恢复全屏页面和右侧证据。

Dashboard layout 只维护浮层开关、当前会话和草稿等轻量 UI 状态。真实消息必须从服务端会话仓库恢复，不能依赖组件未卸载。

## 四、服务端多会话

### Conversation

```ts
interface AssistantConversation {
  id: string
  userId: string
  title: string
  status: 'active' | 'archived' | 'deleted'
  defaultRoute: 'auto' | 'pet' | 'rag'
  knowledgeBaseId?: string
  lastMessageAt: string
  messageCount: number
  activeGenerationId?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}
```

### Message

```ts
interface AssistantStoredMessage {
  id: string
  conversationId: string
  userId: string
  seq: number
  role: 'user' | 'assistant'
  route: 'pet' | 'rag'
  content: string
  status: 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled'
  requestId?: string
  replyToMessageId?: string
  retryOfMessageId?: string
  citations: RagCitation[]
  warnings: string[]
  tokenUsage?: { input: number; output: number }
  createdAt: string
  completedAt?: string
}
```

`(conversationId, seq)` 唯一并在会话内单调递增。所有会话、消息、搜索和 generation 查询必须同时约束 `userId`。

### 原子写入

创建用户消息、assistant 占位消息和更新会话时间使用 MongoDB transaction。标题生成、checkpoint 和记忆候选提取通过异步任务完成，不阻塞正文流式输出。异步任务携带目标消息版本，旧任务不得覆盖更新后的结果。

### 上下文 Checkpoint

Checkpoint 是可重建的上下文压缩，不是长期认知：

```ts
interface AssistantContextCheckpoint {
  conversationId: string
  throughSeq: number
  summary: string
  decisions: string[]
  openQuestions: string[]
  referencedEntities: string[]
  sourceMessageIds: string[]
  createdAt: string
}
```

满足消息数量、Token 阈值、会话空闲或用户手动整理条件时异步生成。它只总结目标、已明确结论、未解决问题、术语关系和必须延续的限制，不把推测写成事实，也不自动进入认知轨迹。

### 模型上下文组装

按 Token 预算依次组装：

1. 系统与安全规则。
2. 当前问题。
3. RAG 场景的笔记证据。
4. 最近有效 checkpoint。
5. checkpoint 后的近期对话。
6. 与当前问题相关的历史消息片段。
7. 相关且已确认的认知节点。

实际 prompt 中使用 `[会话摘要]`、`[近期对话]`、`[历史对话召回]`、`[已确认认知]` 和 `[笔记证据]` 分区。RAG 场景在预算冲突时优先保留笔记证据，不为聊天历史牺牲关键引用。

### 编辑、删除、重试与分支

- 第一阶段不允许就地改写历史 assistant 消息。
- 编辑历史用户问题的语义是“从这里创建分支”。
- 重试创建关联新回答，保留失败或旧回答。
- 删除用户消息时隐藏其直接回答，并使覆盖它的 checkpoint 失效后异步重建。
- 分支第一版复制可见前缀消息，通过 `parentConversationId` 和 `forkedFromSeq` 保留来源；不提前实现共享前缀 DAG。

### 搜索与分页

消息按 `seq` 使用游标分页。第一阶段使用 MongoDB 文本索引搜索标题与正文，结果包含命中消息的前后文和定位锚点。后续可增加 message embedding 以支持语义历史召回，但不属于第一阶段必需项。

## 五、存储职责

### MongoDB

保存用户可见和需要跨设备同步的事实：

- `assistant_conversations`
- `assistant_messages`
- `assistant_context_checkpoints`
- `assistant_memory_candidates`
- `assistant_memories`

### Redis

保存短生命周期运行态：

- generation 状态与事件发布。
- 回答取消标记。
- 多标签页订阅。
- 最近上下文缓存。
- 分布式锁和请求幂等辅助状态。

Redis 不是最终消息存储。Redis 重启后，已落库的消息和最终状态仍可恢复。

### 浏览器

- localStorage：最近会话 ID、分会话草稿、布局偏好。
- sessionStorage：当前标签页的消息锚点、引用和导航快照。
- 不再把完整会话历史作为唯一事实源保存在浏览器。

### JSONL

JSONL 只作为会话导入、导出、问题诊断和审计回放格式。导入记录进入独立会话，不能直接生成已确认认知。

## 六、待确认认知与认知轨迹

### 候选类型

异步分析一轮新增对话，只允许生成：

- `decision`：明确决定。
- `preference`：稳定偏好或工作习惯。
- `fact`：用户明确陈述的稳定事实。
- `hypothesis`：仍在验证的判断。
- `open_question`：尚未解决的问题。
- `constraint`：项目边界或不可违反的条件。
- `lesson`：从实践中形成的经验。

寒暄、临时情绪、助手未获用户认可的建议和无证据推测不生成正式候选。

### 候选模型

```ts
interface AssistantMemoryCandidate {
  id: string
  userId: string
  conversationId: string
  kind: 'decision' | 'preference' | 'fact' | 'hypothesis' | 'open_question' | 'constraint' | 'lesson'
  subject: string
  statement: string
  scope: { type: 'global' | 'knowledge_base' | 'note' | 'conversation'; id?: string }
  status: 'pending' | 'confirmed' | 'rejected' | 'superseded'
  confidence: number
  evidence: Array<
    | { type: 'message'; messageId: string; excerpt: string }
    | { type: 'note_chunk'; noteId: string; chunkId: string; excerpt: string }
  >
  relation?: { type: 'supports' | 'contradicts' | 'supersedes' | 'refines'; targetMemoryId: string }
  validFrom?: string
  validTo?: string
}
```

### 确认流程

候选集中出现在全屏助手右栏。浮层只显示待确认数量和进入工作台的入口。

用户可以：

- 确认。
- 修改类型、措辞、范围和有效时间后确认。
- 暂不处理；pending 候选不参与回答。
- 拒绝；同一证据不得反复生成等价候选。
- 查看并定位原始消息或 Note Chunk。

批量确认只允许同类型、同范围候选，且必须明确展示将写入的内容。

### 时间演进与冲突

新候选与同用户、同范围、相似主题的已确认节点比较。发现冲突时不自动覆盖，由用户选择：

- 用新结论替代旧结论。
- 两者适用于不同范围。
- 修改新候选。
- 拒绝新候选。

选择替代后，旧节点变为 `superseded` 并写入 `validTo`，新节点通过 `supersedes` 指向旧节点。默认界面展示当前有效认知，“演进过程”展示完整时间线。

### 证据权重

证据可信顺序为：

```text
用户明确确认
> 用户原始陈述
> 用户笔记原文
> 助手依据笔记作出的归纳
> 助手无笔记依据的建议
```

最后一类只能成为 hypothesis。笔记重新索引或正文变化时，不自动修改已确认认知，而是标记“证据可能已变化”并生成复核候选。

### 受控召回与引用

回答前只召回：

- `status = confirmed`
- 与问题语义相关。
- scope 与当前会话兼容。
- 未过期、未被替代。
- 当前会话没有关闭记忆。

认知引用使用 `[M1]`，笔记证据继续使用 `[E1]`。UI 明确区分两类来源，并都允许查看依据。pending、rejected、superseded 和来源缺失的节点不得注入回答。

### 范围

- `global`：跨项目稳定偏好。
- `knowledge_base`：知识库内事实、决定或约束。
- `note`：单篇笔记相关内容。
- `conversation`：只在当前会话延续。

系统只建议范围，用户确认时可以修改。第一版使用现有 knowledge base 表达项目上下文，不新增 workspace 实体。

### 隐私与遗忘

用户可以暂停会话的候选提取、开启不产生长期认知的临时会话、关闭回答时的认知召回、查看各状态节点、删除单条节点或整条演进链，并导出认知及来源。

删除源会话时，用户选择是否同时删除由其产生的认知。若节点仍有其他有效证据则移除该来源后保留；若已无证据则进入“来源缺失”状态并停止召回。

## 七、错误与降级

- SSE 中断：保留已生成文本，消息标记 failed，并提供继续生成或重新回答。
- Redis 状态丢失：以 MongoDB 状态为准；无法恢复的 streaming 消息转为 failed。
- checkpoint 失败：使用近期消息继续回答，不阻塞会话。
- 候选抽取失败：不影响回答，也不创建半成品候选。
- 引用失权：右栏不展示历史 excerpt，返回权限错误或来源不可用状态。
- Chunk 失效：允许 headingPath 兼容定位，但必须标记重新定位结果。
- 认知冲突：进入待确认，不自动覆盖。
- 认知证据删除：停止召回无证据节点。

## 八、验收标准

### 流式回答

- RAG 正文逐步输出，完成后出现经过校验的引用。
- 关闭浮层、进入全屏、刷新或多标签页不会重复生成。
- 停止、断线、失败和重试均保留一致消息状态。

### 全屏工作台

- 现有浮层没有明显视觉和行为回归。
- 可在全屏页面新建、搜索、重命名、归档和删除会话。
- 浮层与全屏页面打开同一会话并同步生成状态。
- 桌面、窄屏和移动端布局可用且键盘导航完整。

### 引用与导航

- 引用可以在助手右栏阅读完整 Chunk 和相邻上下文。
- 点击定位原文进入正确笔记与 Chunk。
- 返回后恢复原会话、消息锚点、引用、草稿和 generation。
- 知识图谱与助手共用一致的 Chunk 证据组件。

### 多会话

- 会话和消息跨浏览器、跨设备同步。
- 分页顺序稳定，请求重放不会产生重复消息。
- 长会话通过 checkpoint 和 Token 预算保持连续性。
- 删除、重试、分支和软删除语义可测试、可追溯。

### 认知轨迹

- 未确认候选绝不参与回答。
- 每个确认节点都能打开有效证据。
- 新旧观点通过 supersedes 形成时间演进，不静默覆盖。
- `[M1]` 与 `[E1]` 在模型上下文和 UI 中始终分离。
- 用户可暂停、修改、拒绝、删除和导出认知。

## 九、第一版非目标

- 不修改现有助手浮层尺寸和页面挤压方式。
- 不合并普通聊天和 RAG 的后端安全链路。
- 不实现复杂多跳认知知识图谱。
- 不做情绪画像、人格分析或隐式行为偏好推断。
- 不允许未经确认的自动长期记忆。
- 不实现多人共享认知节点。
- 不自动把对话或认知写入笔记正文。
- 不将 JSONL 作为生产多用户会话的主要数据库。
- 不在第一版实现共享前缀 DAG 或独立 workspace 实体。

## 十、调研依据与设计判断

主流产品和框架主要采用历史聊天检索、原子事实记忆、项目隔离摘要、agent 自管理上下文和时间知识图谱。JSONL 适合本地 CLI 的追加日志和恢复；生产 Web 应用通常使用可替换的数据库或状态存储。结合本项目已有 MongoDB、Redis、Note Chunk、RAG 引用和知识图谱能力，本设计选择“服务端会话 + 可重建 checkpoint + 用户确认的证据化认知轨迹”，避免复制不可解释的自动用户画像。

认知轨迹是产品层能力；checkpoint 只是模型上下文优化。两者必须独立存储、独立失效和独立授权。
