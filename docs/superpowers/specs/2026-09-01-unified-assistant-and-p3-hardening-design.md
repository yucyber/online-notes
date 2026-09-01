# 统一小助手与 P3 GraphRAG 加固设计

## 目标

将当前“宠物聊天 / 知识助手”两个前端入口合并为一个连续的小助手对话体验，同时保留后端闲聊与 RAG 两条能力链路的权限和证据边界。修复对话历史恢复失败，并补齐 P3 审查确认的引用定位、图谱一跳扩展、共享笔记检索、无效引用处理和 Query rewrite 关键词消费问题。

## 产品与交互

小助手只展示一个对话流和一个输入区，不再要求用户理解“宠物聊天”和“知识助手”的技术区别。

- 每条 assistant 消息显示来源标签：`轻松聊聊` 或 `基于你的笔记`。
- RAG 回复继续展示笔记标题、headingPath、原文摘要和可点击引用。
- 输入区提供“搜索笔记”开关。开启时强制走 RAG；关闭时由确定性前端路由规则判断。
- 包含“我的笔记、之前、当时、踩坑、查找、搜索、哪篇、比较、区别、冲突”等知识检索意图的问题走 RAG；其他问题走宠物聊天。
- 自动路由只决定调用哪个现有后端入口，不允许宠物链路直接读取 Chunk，也不允许 RAG 绕过 NoteAccess、knowledgeBase 和引用校验。
- 请求期间锁定当前请求的路由和输入，用户切换“搜索笔记”不会改变已发出的请求。
- 失败回复保留在同一历史中，并给出可理解的重试提示，不显示 provider、模型或内部异常详情。

## 会话数据与持久化

前端使用一份统一消息数组：

```ts
interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  route: 'pet' | 'rag'
  result?: RagAnswer
  createdAt: string
}
```

历史保存在版本化 key `ai_assistant_history_v1`。首次加载按以下顺序执行：

1. 读取统一历史；
2. 若统一历史不存在，迁移旧的 `ai_pet_history` 与 `ai_rag_history`；
3. 校验数组、role、content、route 和可选 RAG 结果，丢弃非法项；
4. 标记 hydration 完成；
5. 只有 hydration 完成后才允许写入 localStorage。

这样避免初始空 state 在恢复 effect 完成前覆盖已有记录。历史设置上限，保留最近 100 条消息，防止引用和长回答无限占用 localStorage。清空按钮删除统一 key，并同时清理两个旧 key。

## 后端链路边界

本次不新增统一后端“万能聊天”接口。前端路由到现有接口：

- `POST /api/ai/pet`：轻量流式闲聊，不读取用户笔记；
- `POST /api/ai/rag/answer`：非流式、ACL 约束、证据检索、引用映射。

保留两条链路的原因是安全和可验证性，而不是 UI 区隔。未来若路由规则需要模型判断，应在独立 Query Planner 中返回受限 route，不把 Chunk 注入宠物 prompt。

## P3 修复

### 引用定位

`RagCitationList` 统一生成 `chunkId` 查询参数，与 `NoteEditorShell` 的读取契约一致。测试覆盖点击链接后生成正确 URL；定位接口失败时仍按 headingPath 回退。

### 无效引用

回答服务解析本次允许的 evidence ID，删除正文中所有无效 `[E…]` 标记，并在发现任一无效引用时添加 warning。有效引用去重后保留，正文和 citations 必须一致。若模型没有引用任何证据，返回用户可理解的引用不足 warning，不把无引用回答伪装成“基于你的笔记”。

### 共享笔记检索

Chunk 的权限边界统一使用 NoteAccess 计算出的 noteId allowlist。关键词检索和图谱扩展不再用“当前阅读者 userId”等价于“Chunk 所有者”的条件过滤，因为共享或公开笔记的 Chunk 由笔记创建者生成。knowledgeBase 链接仍按当前知识库所有者范围查询，失权笔记每次读取时重新过滤。

### 真正的一跳图谱扩展

从 seed Chunk 找到 seed 节点，再读取与 seed 节点相连的边，计算边另一端的邻居 nodeId，查询邻居节点的 `evidenceChunkIds`。最终候选由 seed 节点、关联边和邻居节点证据组成，并再次经过 knowledgeBase 范围、NoteAccess allowlist 和 Chunk 存在性校验。`graphHops` 仍固定为 1。

### Query rewrite 与候选融合

Query rewrite 返回一个规范问题和最多三个关键词。向量检索使用规范问题；关键词检索使用关键词数组，缺失时回退到原问题的有限切词。关键词、向量和图谱候选按 chunkId 去重时保留最高分和已有 graphPath，不允许低分图谱候选覆盖更高分候选。rerank 失败继续使用基础排序。

## UI 视觉方向

沿用现有产品 token 和侧边面板，不引入新的颜色系统或组件库。

- 顶部使用单一“小助手”标题和简短状态说明。
- 消息采用克制的左右层级，不使用大面积渐变或聊天气泡阴影。
- assistant 回复顶部展示小型来源标签；RAG 引用作为回答后的紧凑证据卡片。
- 输入区固定在底部，“搜索笔记”使用可访问的 pressed button，并提供清晰 focus 状态。
- 空状态给出两组简短建议：自由提问与搜索笔记，但不恢复双 Tab。
- 保持窄屏可用、键盘发送、Shift+Enter 换行、加载状态和 aria-label。

## 错误处理

- localStorage 解析失败时清理损坏值并以空历史启动，不中断面板渲染。
- RAG 改写、rerank 或图谱不可用时继续返回降级提示。
- 向量检索失败时，如果关键词候选可用则降级继续回答并返回 warning；权限或知识库边界错误不得吞掉。
- 无证据时不调用回答模型，返回“笔记中未找到相关记录”。
- 前端请求失败时记录带 route 的失败回复，允许用户复制原问题后重试。

## 测试与验收

### 前端

- 旧历史不会被初始空 state 覆盖，关闭再打开面板仍显示记录。
- 旧 pet/rag 历史可迁移到统一历史，并在之后只写新 key。
- 自动路由与“搜索笔记”强制路由分别调用正确接口。
- RAG 回复展示来源、引用和 warning；宠物回复不显示伪造引用。
- 引用 URL 使用 `chunkId`，点击后保持笔记可打开。
- 清空历史删除统一和旧 key。
- 定向 Jest、type-check、正式 build 通过，并检查窄屏与暗色模式。

### 后端

- 共享 reader 和公开笔记阅读者能通过关键词检索命中可读 Chunk。
- 不可读笔记即使拥有 Chunk 也不会进入候选。
- 图谱扩展包含邻居节点证据，最多一跳且重新校验 ACL 与 knowledgeBase。
- 混合有效/无效引用会清理无效正文标记并返回 warning。
- Query rewrite 关键词进入关键词检索；候选去重保留较高分。
- 后端全量单测和前端相关测试通过。

## 非目标

- 不将宠物和 RAG 合并为同一个后端 prompt 或模型调用。
- 不新增服务端长期会话数据库；本轮继续使用浏览器 localStorage。
- 不实现多会话列表、会话重命名、跨设备同步或流式 RAG。
- 不扩展到 P4 知识整理写操作。
