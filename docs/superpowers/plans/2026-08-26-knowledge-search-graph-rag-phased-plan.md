# 知识检索、知识图谱与 GraphRAG 分阶段实施计划

> **执行状态说明（2026-08-27）：** 本文保留第一阶段原始设计和实现细节。当前代码进度、AI 模型路由、后续 GraphRAG 与整理提案的统一优先级，改由 [`2026-08-27-knowledge-ai-platform-master-execution-plan.md`](./2026-08-27-knowledge-ai-platform-master-execution-plan.md) 管理。执行时以新总计划为准，本文不再作为进度真相来源。

> **面向执行代理：** 必须使用 `subagent-driven-development`（推荐）或 `executing-plans` 按任务逐项实施。本计划使用复选框跟踪进度。

**目标：** 建立主题向量与 Chunk 向量两条稳定链路，在保留现有“关键词 / 向量 / 混合”搜索选项的前提下展示命中 Chunk，并在知识库中用 React Flow 可视化现有节点和关系；后续再扩展为带原文证据引用的 GraphRAG 与知识整理提案。

**架构：** 第一阶段保留 `Note.embedding` 并将其语义改为“笔记主题向量”，新增 `note_chunks` 集合和独立 Atlas Vector Search index；现有搜索接口按模式组合关键词结果与 Chunk 向量结果，按 `noteId` 聚合后把命中片段返回给笔记列表。知识库页面使用现有图谱接口的 `nodes / edges` 渲染 React Flow，不要求首版先改图谱存储协议。第二阶段再让图谱节点和边通过 `evidenceChunkIds` 绑定原文，并由 Query Planner 选择 Chunk 检索、图谱扩展和重排工具。

**技术栈：** NestJS 10、Next.js 16、React 18、TypeScript、Mongoose 8、MongoDB Atlas Vector Search、`@xyflow/react`、`dagre`、Jest、Testing Library、Node Test Runner、`ts-node/register`、SiliconFlow `Qwen/Qwen3-Embedding-8B`。

## 全局约束

- 迁移期间保留 `Note.embedding` 和现有 `vector_index`；字段的新语义是“笔记主题向量”，不再表示正文截断向量。
- 主题向量输入顺序固定为：标题、最终摘要、分类名称、排序并去重后的标签名称；不得把分类或标签 ID 当作语义文本。
- Chunk 向量输入固定为：笔记标题、`headingPath`、Chunk 正文。
- 分块优先保留标题、段落、列表、引用、表格和 fenced code block；目标 400～700 tokens，最大 900 tokens，重叠 50～100 tokens。
- 第一版允许使用可注入的 token 估算器和稳定的字符数兜底，但分块边界及 `chunkStrategyVersion` 必须可重复并有测试覆盖。
- 派生数据失败不得阻塞笔记创建或编辑；summary、主题 embedding 或 Chunk embedding 失败时保留可用旧数据或兜底数据，并记录诊断日志。
- 异步任务写回前必须核对笔记快照，旧任务不得覆盖新标题、正文、摘要、分类或标签对应的派生数据。
- 向量查询必须由服务端注入 `userId`、可读笔记范围及 `knowledgeBaseId`，不得信任模型或客户端提交的权限边界。
- 当前只有 6 条测试笔记，使用一次性、幂等的回填脚本并输出最终报告；暂不建设持久化迁移任务系统。
- 现有搜索框已经提供 `keyword`、`vector`、`hybrid` 三种模式；第一阶段只升级检索实现和结果证据展示，不新增重复的模式入口。
- 搜索接口仍以“笔记”为分页和去重单位；同一笔记命中多个 chunks 时只占一个列表项，并返回最高分命中及额外命中数量。
- Chunk 搜索结果不进入 Redis 或跨请求结果缓存；Atlas Vector Search index 是持久化索引，不是结果缓存。主题向量变化时只清理现有 `topics:{userId}` 聚类缓存。
- 第一阶段知识图谱直接消费现有 `nodes / edges`；图谱证据绑定和 GraphRAG 查询不得反向阻塞首版可视化。
- 知识库页面必须复用项目现有 CSS token、字体、圆角和按钮体系，并覆盖窄屏、暗色、超长文本、空态、加载态和错误态。
- 复杂业务原因、权限边界、失败降级和不直观时序使用简洁中文注释；普通 CRUD 不添加复述性注释。
- Commit message 使用中文，格式为 `类型(范围): 简述`。

---

## 分阶段边界

| 阶段 | 用户可见结果 | 本阶段明确不做 |
| --- | --- | --- |
| 第一阶段：双层向量、搜索证据与可视图谱 | 自动保存后稳定刷新主题/Chunk 向量；现有三种搜索模式返回笔记列表并展示命中 Chunk；知识库内可缩放、拖拽和查看关系的 React Flow 图谱 | AI 问答、图谱扩展、自动改笔记、自动建知识库 |
| 第二阶段：GraphRAG 助手 | Query Planner 按问题选择工具；Chunk 检索结合图谱一跳扩展；回答引用笔记、标题路径和原文片段 | 自动执行内容拆分、合并或改写 |
| 第三阶段：知识整理提案 | 建库与归属建议、标签分类、重复检测、拆分合并提案；逐条确认、一键执行、整批撤销和返工 | 未经用户确认的破坏性写入 |

第一阶段必须独立形成完整可验收产品路径：用户保存笔记后能搜到具体片段，也能在知识库中看到真实关系网络。第二、三阶段不得成为第一阶段上线前置条件。

---

## 文件职责

### 新建文件

- `notes-backend/src/modules/notes/schemas/note-chunk.schema.ts`：Chunk 持久化结构和普通 MongoDB 索引。
- `notes-backend/src/modules/notes/note-chunker.service.ts`：确定性的结构化分块。
- `notes-backend/src/modules/notes/note-vector-source.service.ts`：构造主题向量文本及来源哈希。
- `notes-backend/src/modules/notes/note-chunk-index.service.ts`：增量比较、embedding 生成及 chunks 持久化。
- `notes-backend/src/modules/semantic/chunk-retrieval.service.ts`：带权限复核的 Atlas Chunk Vector Search。
- `notes-backend/scripts/backfill-note-vectors.ts`：回填 6 条测试笔记并输出报告。
- `notes-backend/test/note-vector-source.test.ts`：主题向量输入契约测试。
- `notes-backend/test/note-vector-refresh.test.ts`：summary 优先时序及 taxonomy 触发测试。
- `notes-backend/test/note-chunker.test.ts`：结构化分块测试。
- `notes-backend/test/note-chunk-index.test.ts`：增量复用、替换、陈旧任务和失败降级测试。
- `notes-backend/test/chunk-retrieval-access.test.ts`：用户及知识库权限边界测试。
- `notes-backend/test/backfill-note-vectors.test.ts`：回填幂等性及失败计数测试。
- `notes-frontend/src/components/notes/SearchHitEvidence.tsx`：展示最高分 Chunk、标题路径和额外命中数量。
- `notes-frontend/src/components/knowledge-bases/KnowledgeGraphCanvas.tsx`：将领域图谱转换并渲染为 React Flow。
- `notes-frontend/src/components/knowledge-bases/knowledge-graph-layout.ts`：纯函数形式的节点/边转换、关系中文化和 dagre 初始布局。
- `notes-frontend/__tests__/semantic-search-evidence.spec.tsx`：搜索证据展示与模式兼容测试。
- `notes-frontend/__tests__/knowledge-graph-canvas.spec.tsx`：图谱转换、状态与基本交互测试。

### 修改文件

- `notes-backend/src/modules/notes/schemas/note.schema.ts`：增加主题向量来源字段，保留 `embedding`。
- `notes-backend/src/modules/notes/note-derived.service.ts`：编排 summary、主题向量和 Chunk 索引时序。
- `notes-backend/src/modules/notes/notes.service.ts`：在标题、正文、分类和标签变化时触发派生任务。
- `notes-backend/src/modules/notes/notes.module.ts`：注册 Chunk model 和相关服务。
- `notes-backend/src/modules/categories/categories.service.ts`：按用户边界解析分类名称。
- `notes-backend/src/modules/tags/tags.service.ts`：按用户边界解析标签名称。
- `notes-backend/src/modules/semantic/semantic.module.ts`：注册并导出 Chunk 检索服务。
- `notes-backend/src/modules/semantic/semantic.service.ts`：保留笔记级推荐/聚类，并组合关键词与 Chunk 搜索结果。
- `notes-backend/src/modules/knowledge-bases/schemas/knowledge-graph-node.schema.ts`：增加 Chunk 证据引用。
- `notes-backend/src/modules/knowledge-bases/schemas/knowledge-graph-edge.schema.ts`：增加 Chunk 证据引用。
- `notes-backend/src/modules/knowledge-bases/dto/index.ts`：允许图谱 proposal 提交证据 Chunk ID。
- `notes-backend/src/modules/ai/graphs/knowledge-graph-build.graph.ts`：输入和输出 Chunk 证据。
- `notes-backend/src/modules/knowledge-bases/knowledge-bases.service.ts`：验证、保存和序列化证据 Chunk ID。
- `notes-backend/package.json`：增加回填命令。
- `notes-backend/openapi.yaml`：记录图谱证据字段和 Chunk 检索结果。
- `scripts/check-semantic-search.mjs`：同时检查两套 Atlas Vector Search 索引。
- `notes-frontend/src/lib/api/semantic.ts`：扩展搜索响应的 Chunk 命中类型，保留现有三种模式。
- `notes-frontend/src/components/notes/useNotesPage.ts`：保存并传递每篇笔记的 Chunk 命中证据。
- `notes-frontend/src/components/notes/NotesListCard.tsx`：在笔记元信息下展示搜索命中证据。
- `notes-frontend/src/components/knowledge-bases/KnowledgeGraphPanel.tsx`：用图谱画布替换 NODES / EDGES 两列预览，并保留 warnings。
- `notes-frontend/src/app/dashboard/knowledge-bases/page.tsx`：调整知识库主从布局、图谱区域和响应式结构。
- `notes-frontend/src/app/globals.css`：增加遵循现有 token 的搜索证据和图谱样式。
- `notes-frontend/package.json`、仓库锁文件：增加 `@xyflow/react`、`dagre` 和类型依赖。

---

# 第一阶段：双层向量、搜索证据与可视图谱

## 任务 1（第一阶段）：定义稳定的笔记主题向量输入

**文件：**

- 新建：`notes-backend/src/modules/notes/note-vector-source.service.ts`
- 新建：`notes-backend/test/note-vector-source.test.ts`

**接口：**

- 输入：`{ title, summary, categoryName?, tagNames? }`
- 输出：`buildTopicVectorSource(input): string` 和 `hashTopicVectorSource(source): string`

- [ ] **步骤 1：先编写失败测试**

```ts
test('主题向量文本按固定顺序使用名称', () => {
  const service = new NoteVectorSourceService()
  assert.equal(service.buildTopicVectorSource({
    title: 'React Diff',
    summary: '比较新旧虚拟 DOM。',
    categoryName: '前端',
    tagNames: ['性能', 'React', 'React'],
  }), '标题：React Diff\n摘要：比较新旧虚拟 DOM。\n分类：前端\n标签：React、性能')
})

test('来源哈希稳定且能识别元数据变化', () => {
  const service = new NoteVectorSourceService()
  assert.equal(service.hashTopicVectorSource('same'), service.hashTopicVectorSource('same'))
  assert.notEqual(service.hashTopicVectorSource('same'), service.hashTopicVectorSource('changed'))
})
```

- [ ] **步骤 2：运行测试并确认失败**

执行：`node --test -r ts-node/register test/note-vector-source.test.ts`

预期：因 `NoteVectorSourceService` 不存在而失败。

- [ ] **步骤 3：实现最小服务**

```ts
export interface NoteTopicVectorSourceInput {
  title: string
  summary: string
  categoryName?: string
  tagNames?: string[]
}

export class NoteVectorSourceService {
  buildTopicVectorSource(input: NoteTopicVectorSourceInput): string {
    const tags = [...new Set((input.tagNames || []).map(value => value.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    return [
      `标题：${String(input.title || '').trim()}`,
      `摘要：${String(input.summary || '').trim()}`,
      input.categoryName?.trim() ? `分类：${input.categoryName.trim()}` : '',
      tags.length > 0 ? `标签：${tags.join('、')}` : '',
    ].filter(Boolean).join('\n')
  }

  hashTopicVectorSource(source: string): string {
    return createHash('sha256').update(source).digest('hex')
  }
}
```

- [ ] **步骤 4：运行测试并确认通过**

- [ ] **步骤 5：提交**

```powershell
git add notes-backend/src/modules/notes/note-vector-source.service.ts notes-backend/test/note-vector-source.test.ts
git commit -m "feat(backend): 定义笔记主题向量输入"
```

---

## 任务 2（第一阶段）：记录主题向量来源且不破坏现有消费者

**文件：**

- 修改：`notes-backend/src/modules/notes/schemas/note.schema.ts`
- 修改：`notes-backend/src/modules/notes/notes.module.ts`
- 新建：`notes-backend/test/note-vector-refresh.test.ts`

**输出字段：** `embedding`、`embeddingSourceHash`、`embeddingModel`、`embeddingUpdatedAt`。

- [ ] **步骤 1：编写来源字段失败测试**

```ts
test('主题向量写回来源信息且不改变笔记更新时间', async () => {
  await derived.updateTopicEmbedding(note, source)
  assert.deepEqual(calls[0].update.$set.embedding, [0.1, 0.2])
  assert.equal(typeof calls[0].update.$set.embeddingSourceHash, 'string')
  assert.equal(calls[0].options.timestamps, false)
})
```

- [ ] **步骤 2：运行测试，确认因字段和方法不存在而失败**
- [ ] **步骤 3：扩展 Note schema**

```ts
@Prop()
embeddingSourceHash?: string

@Prop()
embeddingModel?: string

@Prop({ type: Date })
embeddingUpdatedAt?: Date
```

保留 `embedding?: number[]`，避免破坏 `NoteRecommendationService` 和聚类功能。

- [ ] **步骤 4：在 NotesModule 注册 `NoteVectorSourceService`**
- [ ] **步骤 5：运行测试**

```powershell
node --test -r ts-node/register test/note-vector-refresh.test.ts test/notes-async-metadata.test.ts test/semantic-search-access.test.ts
```

- [ ] **步骤 6：提交**

```powershell
git add notes-backend/src/modules/notes/schemas/note.schema.ts notes-backend/src/modules/notes/notes.module.ts notes-backend/test/note-vector-refresh.test.ts
git commit -m "feat(backend): 记录主题向量来源"
```

---

## 任务 3（第一阶段）：将自动保存与派生任务调度解耦

**文件：**

- 修改：`notes-backend/src/modules/notes/notes.service.ts`
- 修改：`notes-backend/src/modules/notes/note-derived.service.ts`
- 修改：`notes-backend/test/notes-async-metadata.test.ts`
- 修改：`notes-backend/test/note-vector-refresh.test.ts`

**接口：**

- 自动保存仍按前端现有约 400ms debounce 写入业务字段。
- 后端只在标题、正文、分类或标签的实际值变化时安排派生任务。
- 同一笔记的派生任务按 `noteId` 合并，在最后一次实际变化后静默 10 秒执行。
- `expectedUpdatedAt` 仅存在于任务快照；写回前与当前 `Note.updatedAt` 比较，不持久化到 `NoteChunk`。

- [ ] **步骤 1：编写实际变化和任务合并失败测试**

```ts
test('重复保存相同快照不会重复安排派生任务', async () => {
  await service.update(noteId, unchangedDto, userId)
  assert.equal(scheduleCalls, 0)
})

test('十秒内连续保存只执行最后一个快照', async () => {
  await scheduler.schedule(noteId, firstSnapshot)
  await scheduler.schedule(noteId, latestSnapshot)
  clock.tick(10_000)
  assert.deepEqual(executedSnapshots, [latestSnapshot])
})

test('陈旧任务写回前发现 updatedAt 已变化则放弃写入', async () => {
  await derived.refreshTopicArtifacts(noteId, staleSnapshot)
  assert.equal(updateCalls, 0)
})
```

- [ ] **步骤 2：运行测试并确认当前逻辑会按 DTO 字段存在性重复触发**
- [ ] **步骤 3：在更新前后比较规范化的标题、正文、分类 ID 和标签 ID 集合，只为真实变化构造任务快照**
- [ ] **步骤 4：实现进程内按 `noteId` 合并的 10 秒调度器；新快照替换旧快照并重置 timer**
- [ ] **步骤 5：写回 summary、主题 embedding 等派生字段时使用 `{ timestamps: false }`，避免派生写回再次改变业务版本时间**
- [ ] **步骤 6：运行回归测试**

```powershell
node --test -r ts-node/register test/notes-async-metadata.test.ts test/note-vector-refresh.test.ts test/notes-update-access.test.ts
```

- [ ] **步骤 7：提交**

```powershell
git add notes-backend/src/modules/notes/notes.service.ts notes-backend/src/modules/notes/note-derived.service.ts notes-backend/test/notes-async-metadata.test.ts notes-backend/test/note-vector-refresh.test.ts
git commit -m "refactor(backend): 合并自动保存派生任务"
```

---

## 任务 4（第一阶段）：确保先生成最终摘要，再生成主题向量

**文件：**

- 修改：`notes-backend/src/modules/notes/note-derived.service.ts`
- 修改：`notes-backend/src/modules/notes/notes.service.ts`
- 修改：`notes-backend/src/modules/categories/categories.service.ts`
- 修改：`notes-backend/src/modules/tags/tags.service.ts`
- 修改：`notes-backend/test/note-vector-refresh.test.ts`
- 修改：`notes-backend/test/notes-async-metadata.test.ts`

**输出接口：** `refreshTopicArtifacts(noteId: string, expected: NoteDerivedSnapshot): Promise<void>`。

- [ ] **步骤 1：增加时序及 taxonomy 失败测试**

```ts
test('使用 AI 最终摘要而非正文生成主题向量', async () => {
  await derived.refreshTopicArtifacts('note-1', snapshot)
  assert.match(embeddedTexts[0], /摘要：AI 最终摘要/)
  assert.doesNotMatch(embeddedTexts[0], /正文前 8000/)
})

test('只修改标签时不重新生成摘要但会刷新主题向量', async () => {
  await service.update(noteId, { tags: [tagId] }, userId)
  assert.equal(aiSummaryCalls, 0)
  assert.equal(topicEmbeddingCalls, 1)
})
```

- [ ] **步骤 2：运行测试，确认旧并行流程失败**
- [ ] **步骤 3：定义不可变快照**

```ts
interface NoteDerivedSnapshot {
  title: string
  content: string
  categoryId?: string
  tagIds: string[]
  expectedUpdatedAt: Date
}
```

- [ ] **步骤 4：增加按用户边界解析名称的方法**

```ts
CategoriesService.findOwnedName(id: string | undefined, userId: string): Promise<string | undefined>
TagsService.findOwnedNames(ids: string[], userId: string): Promise<string[]>
```

分类查询固定使用 `{ _id, userId }`；标签查询固定使用 `{ _id: { $in: ids }, userId }`，结果去重并按中文名称排序。

- [ ] **步骤 5：替换并行调用为有序编排**

正文变化：

```text
同步写入兜底摘要
→ 异步生成最终 AI summary
→ 条件写回 summary
→ 根据最终 summary 构造主题文本
→ 条件写回 Note.embedding
→ 独立触发 Chunk 刷新
```

只修改标题、分类或标签：

```text
复用已保存 summary
→ 刷新主题向量
→ 只有标题变化时刷新 Chunk 向量输入
```

- [ ] **步骤 6：保持 API 非阻塞，并在统一编排边界捕获异常**
- [ ] **步骤 7：主题向量成功写回后删除 `topics:{userId}`；Redis 不可用时只记录 warning，不让笔记保存或向量写回失败**
- [ ] **步骤 8：运行测试**

```powershell
node --test -r ts-node/register test/note-vector-refresh.test.ts test/notes-async-metadata.test.ts test/notes-update-access.test.ts test/notes-taxonomy-access.test.ts
```

- [ ] **步骤 9：提交**

```powershell
git add notes-backend/src/modules/notes/note-derived.service.ts notes-backend/src/modules/notes/notes.service.ts notes-backend/src/modules/categories/categories.service.ts notes-backend/src/modules/tags/tags.service.ts notes-backend/test/note-vector-refresh.test.ts notes-backend/test/notes-async-metadata.test.ts
git commit -m "refactor(backend): 按摘要顺序刷新主题向量"
```

---

## 任务 5（第一阶段）：实现稳定的结构化笔记分块

**文件：**

- 新建：`notes-backend/src/modules/notes/note-chunker.service.ts`
- 新建：`notes-backend/test/note-chunker.test.ts`

**输出结构：** `BuiltNoteChunk` 包含 `chunkIndex`、`headingPath`、`content`、`tokenCount`、`contentHash`。

- [ ] **步骤 1：编写结构分块失败测试**

```ts
test('保留标题路径和完整 fenced code block', () => {
  const chunks = service.buildChunks({ title: 'React', content: markdownFixture })
  assert.deepEqual(chunks[0].headingPath, ['React', 'Diff'])
  assert.match(chunks.find(chunk => chunk.content.includes('```ts'))!.content, /```ts[\s\S]*```/)
})

test('相同输入始终生成相同 chunks 和哈希', () => {
  assert.deepEqual(service.buildChunks(input), service.buildChunks(input))
})

test('超长段落拆分后不超过硬上限', () => {
  const chunks = service.buildChunks(longInput)
  assert.ok(chunks.every(chunk => chunk.tokenCount <= 900))
})
```

- [ ] **步骤 2：运行测试并确认服务不存在**
- [ ] **步骤 3：实现 `heading`、`paragraph`、`list`、`quote`、`table`、`code` 六类 block 解析**
- [ ] **步骤 4：实现 50～100 tokens 的普通文本重叠；不重复标题和完整代码块**

哈希输入固定为：

```ts
`${headingPath.join(' > ')}\n${content}`
```

- [ ] **步骤 5：运行测试并确认通过**
- [ ] **步骤 6：提交**

```powershell
git add notes-backend/src/modules/notes/note-chunker.service.ts notes-backend/test/note-chunker.test.ts
git commit -m "feat(backend): 增加结构化笔记分块"
```

---

## 任务 6（第一阶段）：持久化并增量刷新 Chunk 向量

**文件：**

- 新建：`notes-backend/src/modules/notes/schemas/note-chunk.schema.ts`
- 新建：`notes-backend/src/modules/notes/note-chunk-index.service.ts`
- 新建：`notes-backend/test/note-chunk-index.test.ts`
- 修改：`notes-backend/src/modules/notes/notes.module.ts`
- 修改：`notes-backend/src/modules/notes/note-derived.service.ts`
- 修改：`notes-backend/test/notes-delete-cascade.test.ts`

**输出接口：** `refreshNoteChunks(note: NoteChunkSourceSnapshot): Promise<NoteChunkRefreshResult>`。

- [ ] **步骤 1：编写增量刷新失败测试**

```ts
test('哈希未变化的 chunks 复用已有 embedding', async () => {
  const result = await service.refreshNoteChunks(snapshot)
  assert.equal(result.reused, 2)
  assert.equal(embeddingCalls, 0)
})

test('只替换变化的 chunks 并删除失效 chunks', async () => {
  const result = await service.refreshNoteChunks(snapshot)
  assert.deepEqual(result, { total: 2, reused: 1, embedded: 1, removed: 1, failed: 0 })
})

test('某个 embedding 失败时不删除上一版有效 chunks', async () => {
  await service.refreshNoteChunks(snapshot)
  assert.equal(deleteCalls, 0)
})
```

- [ ] **步骤 2：运行测试并确认失败**
- [ ] **步骤 3：定义 NoteChunk schema**

```ts
class NoteChunk {
  userId: Types.ObjectId
  noteId: Types.ObjectId
  chunkIndex: number
  headingPath: string[]
  content: string
  contentHash: string
  embedding: number[]
}
```

普通索引：

- 唯一：`{ noteId: 1, chunkIndex: 1 }`
- 查询：`{ userId: 1, noteId: 1 }`
- 哈希：`{ noteId: 1, contentHash: 1 }`

`tokenCount` 只用于分块过程和测试，不持久化；`embeddingModel` 与分块策略版本使用服务端配置常量。`expectedUpdatedAt` 只作为异步任务快照，写回前与当前 `Note.updatedAt` 比较，不作为 `NoteChunk` 字段。这些普通索引不能替代 Atlas Vector Search index。

- [ ] **步骤 4：先生成所有缺失 embeddings；全部成功且源笔记版本仍匹配时才替换旧 chunks**
- [ ] **步骤 5：接入派生编排；正文/标题变化刷新 chunks，分类/标签变化不刷新**
- [ ] **步骤 6：删除笔记时在现有事务内删除关联 chunks**
- [ ] **步骤 7：运行测试**

```powershell
node --test -r ts-node/register test/note-chunk-index.test.ts test/note-chunker.test.ts test/note-vector-refresh.test.ts test/notes-delete-cascade.test.ts
```

- [ ] **步骤 8：提交**

```powershell
git add notes-backend/src/modules/notes/schemas/note-chunk.schema.ts notes-backend/src/modules/notes/note-chunk-index.service.ts notes-backend/src/modules/notes/notes.module.ts notes-backend/src/modules/notes/note-derived.service.ts notes-backend/test/note-chunk-index.test.ts notes-backend/test/notes-delete-cascade.test.ts
git commit -m "feat(backend): 持久化笔记分块向量"
```

---

## 任务 7（第一阶段）：增加权限安全的 Chunk 检索

**文件：**

- 新建：`notes-backend/src/modules/semantic/chunk-retrieval.service.ts`
- 新建：`notes-backend/test/chunk-retrieval-access.test.ts`
- 修改：`notes-backend/src/modules/semantic/semantic.module.ts`
- 修改：`notes-backend/src/modules/semantic/semantic.service.ts`

**输出接口：**

```ts
interface ChunkSearchInput {
  query: string
  knowledgeBaseId?: string
  noteIds?: string[]
  limit?: number
}

interface ChunkSearchResult {
  chunkId: string
  noteId: string
  title: string
  headingPath: string[]
  content: string
  score: number
}
```

- [ ] **步骤 1：编写权限失败测试**

```ts
test('向量搜索即使命中无权笔记也不得返回', async () => {
  const results = await service.searchChunks({ query: 'React', limit: 8 }, userId)
  assert.deepEqual(results.map(result => result.noteId), [readableNoteId])
})

test('knowledgeBaseId 只允许检索该知识库已关联笔记', async () => {
  await service.searchChunks({ query: 'React', knowledgeBaseId, limit: 8 }, userId)
  assert.deepEqual(capturedAllowedNoteIds, [linkedReadableNoteId])
})
```

- [ ] **步骤 2：运行测试并确认服务不存在**
- [ ] **步骤 3：实现受约束检索**

- 将 `limit` 限制在 1～20。
- 向量搜索前解析可读 `noteIds`。
- Atlas index 固定为 `note_chunk_vector_index`，path 固定为 `embedding`。
- 使用 `userId + allowedNoteIds` 预过滤。
- 检索后再次通过 `NoteAccessService` 复核源笔记权限。
- `userId` 只能来自认证上下文。

- [ ] **步骤 4：保留现有笔记级推荐和聚类，只新增可供搜索框和后续 Agent 复用的 Chunk 检索入口；不增加 Chunk 结果缓存**
- [ ] **步骤 5：运行权限回归测试**

```powershell
node --test -r ts-node/register test/chunk-retrieval-access.test.ts test/semantic-search-access.test.ts
```

- [ ] **步骤 6：提交**

```powershell
git add notes-backend/src/modules/semantic/chunk-retrieval.service.ts notes-backend/src/modules/semantic/semantic.module.ts notes-backend/src/modules/semantic/semantic.service.ts notes-backend/test/chunk-retrieval-access.test.ts
git commit -m "feat(backend): 增加分块语义检索"
```

---

# 第二阶段接口预留（不属于本轮执行范围）

## 任务 8（第二阶段预留，本轮跳过）：让知识图谱关联 Chunk 原文证据

**文件：**

- 修改：`notes-backend/src/modules/knowledge-bases/schemas/knowledge-graph-node.schema.ts`
- 修改：`notes-backend/src/modules/knowledge-bases/schemas/knowledge-graph-edge.schema.ts`
- 修改：`notes-backend/src/modules/knowledge-bases/dto/index.ts`
- 修改：`notes-backend/src/modules/ai/graphs/knowledge-graph-build.graph.ts`
- 修改：`notes-backend/src/modules/knowledge-bases/knowledge-bases.service.ts`
- 修改：`notes-backend/test/knowledge-graph-build-graph.test.ts`
- 修改：`notes-backend/test/knowledge-bases.test.ts`
- 修改：`notes-backend/openapi.yaml`

**输出字段：** proposal、持久化节点、持久化边、GET graph 和 PUT graph 都返回 `evidenceChunkIds: string[]`。

- [ ] **步骤 1：编写图谱证据失败测试**

```ts
test('proposal 只保留输入笔记范围内的证据 chunks', async () => {
  const proposal = await graph.run(inputWithChunks)
  assert.deepEqual(proposal.nodes[0].evidenceChunkIds, ['chunk-allowed'])
  assert.doesNotMatch(JSON.stringify(proposal), /chunk-outside-scope/)
})
```

- [ ] **步骤 2：运行测试并确认失败**
- [ ] **步骤 3：在节点和边增加证据字段**

```ts
@Prop({ type: [Types.ObjectId], ref: 'NoteChunk', default: [] })
evidenceChunkIds: Types.ObjectId[]
```

保留 `noteIds` 用于导航和兼容旧接口。

- [ ] **步骤 4：Prompt 同时提供 Chunk ID 和正文，并限制模型只能返回输入中的 ID**
- [ ] **步骤 5：保存时再次验证证据**

每个证据 Chunk 的 `noteId` 必须：

1. 属于当前用户；
2. 已关联当前知识库；
3. 出现在对应节点或边的规范化 `noteIds` 中。

- [ ] **步骤 6：更新 OpenAPI 并运行测试**

```powershell
node --test -r ts-node/register test/knowledge-graph-build-graph.test.ts test/knowledge-bases.test.ts
```

- [ ] **步骤 7：提交**

```powershell
git add notes-backend/src/modules/knowledge-bases notes-backend/src/modules/ai/graphs/knowledge-graph-build.graph.ts notes-backend/test/knowledge-graph-build-graph.test.ts notes-backend/test/knowledge-bases.test.ts notes-backend/openapi.yaml
git commit -m "feat(backend): 关联图谱与分块证据"
```

---

# 第一阶段（续）：回填、搜索结果与知识库图谱 UI

## 任务 9（第一阶段）：回填 6 条测试笔记并校验 Atlas 索引

**文件：**

- 新建：`notes-backend/scripts/backfill-note-vectors.ts`
- 新建：`notes-backend/test/backfill-note-vectors.test.ts`
- 修改：`notes-backend/package.json`
- 修改：`scripts/check-semantic-search.mjs`

**输出报告：** `{ total, topicSucceeded, chunkSucceeded, chunksCreated, skipped, failed }`。

- [ ] **步骤 1：编写回填幂等性失败测试**

```ts
test('回填处理 6 条笔记且第二次运行不会重复创建', async () => {
  const first = await runner.run()
  const second = await runner.run()
  assert.equal(first.total, 6)
  assert.equal(first.failed, 0)
  assert.equal(second.chunksCreated, 0)
  assert.equal(second.skipped, 6)
})
```

- [ ] **步骤 2：运行测试并确认回填器不存在**
- [ ] **步骤 3：实现顺序、幂等回填；单条失败不阻断后续处理，但最终退出码非 0**
- [ ] **步骤 4：增加命令**

```json
"backfill:note-vectors": "node -r ts-node/register scripts/backfill-note-vectors.ts"
```

- [ ] **步骤 5：扩展索引诊断**

分别验证：

```text
notes.vector_index
  path: embedding
  dimensions: 4096

note_chunks.note_chunk_vector_index
  path: embedding
  dimensions: 4096
```

普通 MongoDB B-tree 索引不能被误判为 Atlas Vector Search index。

- [ ] **步骤 6：运行全部单测和构建**

在 `notes-backend` 执行：

```powershell
npm run test:unit
npm run build
```

- [ ] **步骤 7：运行真实配置和索引检查**

在仓库根目录执行：

```powershell
npm run check:ai-config:live
node scripts/check-semantic-search.mjs
```

预期：SenseNova 返回非空 content；SiliconFlow embedding 为 4096 维；两套 Atlas Vector Search index 名称和 path 正确。

- [ ] **步骤 8：执行两次回填**

首次预期：

```text
处理笔记：6
主题向量成功：6
Chunk 索引成功：6
生成 Chunks：正整数
跳过：0
失败：0
```

第二次预期：不创建重复 chunks，未变化的数据全部复用或跳过。

- [ ] **步骤 9：人工验证全局检索和知识库内检索的权限边界**
- [ ] **步骤 10：提交**

```powershell
git add notes-backend/scripts/backfill-note-vectors.ts notes-backend/test/backfill-note-vectors.test.ts notes-backend/package.json scripts/check-semantic-search.mjs
git commit -m "chore(backend): 回填并校验双层向量"
```

---

## 任务 10（第一阶段）：升级现有混合搜索并展示命中 Chunk

**文件：**

- 修改：`notes-backend/src/modules/semantic/semantic.controller.ts`
- 修改：`notes-backend/src/modules/semantic/semantic.service.ts`
- 修改：`notes-backend/test/semantic-search-access.test.ts`
- 新建：`notes-backend/test/semantic-search-chunk-evidence.test.ts`
- 修改：`notes-frontend/src/lib/api/semantic.ts`
- 修改：`notes-frontend/src/components/notes/useNotesPage.ts`
- 修改：`notes-frontend/src/components/notes/NotesListCard.tsx`
- 新建：`notes-frontend/src/components/notes/SearchHitEvidence.tsx`
- 新建：`notes-frontend/__tests__/semantic-search-evidence.spec.tsx`
- 修改：`notes-frontend/src/app/globals.css`

**兼容接口：**

```ts
type SemanticSearchMode = 'keyword' | 'vector' | 'hybrid'

interface SemanticChunkHit {
  chunkId: string
  headingPath: string[]
  content: string
  score: number
  matchType: 'keyword' | 'semantic'
}

interface SemanticItem {
  id: string
  title: string
  preview: string
  score: number
  updatedAt: string
  bestChunk?: SemanticChunkHit
  additionalChunkHits: number
}
```

搜索 API 继续返回笔记分页结构，`bestChunk` 和 `additionalChunkHits` 是向后兼容的新增字段。`keyword` 使用现有全文/正则检索，`vector` 使用 Chunk Vector Search，`hybrid` 合并两路候选并按 `noteId` 去重；不得把每个 Chunk 当成独立列表项。

- [ ] **步骤 1：编写后端聚合和权限失败测试**

```ts
test('hybrid 按 noteId 合并关键词和 Chunk 候选', async () => {
  const page = await service.searchHybrid('react diff', userId, { page: 1, limit: 10 })
  assert.equal(page.data.filter(item => item.id === noteId).length, 1)
  assert.equal(page.data[0].bestChunk?.headingPath.join(' / '), 'React / Diff')
  assert.equal(page.data[0].additionalChunkHits, 2)
})

test('Chunk 候选命中无权笔记时不会进入聚合结果', async () => {
  const page = await service.searchHybrid('private', userId, { mode: 'hybrid' })
  assert.equal(page.data.some(item => item.id === forbiddenNoteId), false)
})
```

- [ ] **步骤 2：运行后端测试，确认当前结果只有正文 `preview`**
- [ ] **步骤 3：实现关键词、Chunk 向量两路候选归一化；hybrid 使用确定性分数融合并以最高分 Chunk 作为 `bestChunk`**
- [ ] **步骤 4：在聚合前后都应用 `NoteAccessService.readableFilter(userId)`、分类和标签边界；只对去重后的笔记分页**
- [ ] **步骤 5：保持 controller 的 `mode` 查询参数和当前空向量降级语义不变**
- [ ] **步骤 6：编写前端失败测试**

```tsx
it('展示标题路径、命中片段和额外命中数量', () => {
  render(<SearchHitEvidence hit={hit} additionalCount={2} query="react diff" />)
  expect(screen.getByText('React / Diff')).toBeInTheDocument()
  expect(screen.getByText('另外命中 2 处')).toBeInTheDocument()
})

it('无 bestChunk 时保持旧笔记卡片布局', () => {
  render(<NotesListCard {...baseProps} note={plainNote} />)
  expect(screen.queryByTestId('search-hit-evidence')).not.toBeInTheDocument()
})
```

- [ ] **步骤 7：扩展 `semantic.ts` 类型和 `useNotesPage` 映射，不能把 `bestChunk` 丢失在 Note 转换过程中**
- [ ] **步骤 8：实现 `SearchHitEvidence`**

展示规则：

- `headingPath` 用“ / ”连接，缺失时显示“正文命中”。
- 片段最多展示两行，保留完整内容在 `title` 或可访问描述中。
- 关键词命中可以高亮查询词；纯语义命中只显示“语义相关”，不伪造关键词高亮。
- `additionalChunkHits > 0` 时显示“另外命中 N 处”，首版不展开完整 Chunk 列表。
- 只有 `nlq=1` 且有查询词时展示证据，普通笔记列表不改变密度。

- [ ] **步骤 9：运行前后端测试和类型检查**

```powershell
Set-Location notes-backend
node --test -r ts-node/register test/semantic-search-access.test.ts test/semantic-search-chunk-evidence.test.ts test/chunk-retrieval-access.test.ts
Set-Location ..\notes-frontend
npm exec jest -- --runInBand __tests__/semantic-search-evidence.spec.tsx
npm run type-check
```

- [ ] **步骤 10：提交**

```powershell
git add notes-backend/src/modules/semantic notes-backend/test/semantic-search-access.test.ts notes-backend/test/semantic-search-chunk-evidence.test.ts notes-frontend/src/lib/api/semantic.ts notes-frontend/src/components/notes notes-frontend/__tests__/semantic-search-evidence.spec.tsx notes-frontend/src/app/globals.css
git commit -m "feat(search): 展示混合检索命中片段"
```

---

## 任务 11（第一阶段）：重构知识库页面并落地 React Flow 图谱

**文件：**

- 修改：`notes-frontend/package.json`
- 修改：仓库实际使用的 lockfile
- 新建：`notes-frontend/src/components/knowledge-bases/KnowledgeGraphCanvas.tsx`
- 新建：`notes-frontend/src/components/knowledge-bases/knowledge-graph-layout.ts`
- 修改：`notes-frontend/src/components/knowledge-bases/KnowledgeGraphPanel.tsx`
- 修改：`notes-frontend/src/app/dashboard/knowledge-bases/page.tsx`
- 修改：`notes-frontend/src/app/globals.css`
- 新建：`notes-frontend/__tests__/knowledge-graph-canvas.spec.tsx`
- 修改：`notes-frontend/__tests__/knowledge-bases.spec.tsx`

**组件接口：**

```ts
interface KnowledgeGraphCanvasProps {
  graph: KnowledgeGraphProposal
  loading: boolean
  onNodeSelect?: (nodeId: string) => void
}

export function buildKnowledgeGraphFlow(
  graph: KnowledgeGraphProposal,
): { nodes: Node[]; edges: Edge[] }
```

- [ ] **步骤 1：安装并锁定图谱依赖**

```powershell
Set-Location notes-frontend
npm install @xyflow/react dagre
npm install --save-dev @types/dagre
```

- [ ] **步骤 2：编写纯转换函数失败测试**

```ts
it('把领域节点和关系转换为有稳定位置的 React Flow 数据', () => {
  const flow = buildKnowledgeGraphFlow(proposal)
  expect(flow.nodes).toHaveLength(proposal.nodes.length)
  expect(flow.edges[0]).toMatchObject({ source: 'node-a', target: 'node-b', label: '包含' })
  expect(flow.nodes.every(node => Number.isFinite(node.position.x))).toBe(true)
})

it('未知关系保留原值而不是渲染空标签', () => {
  expect(toRelationLabel('supports')).toBe('supports')
})
```

- [ ] **步骤 3：实现 `knowledge-graph-layout.ts`**

要求：

- 用 dagre 计算一次从左到右的初始布局，节点 ID 和边 ID 保持后端值。
- `concept / entity / topic / claim` 映射为“概念 / 实体 / 主题 / 论断”。
- `describes / includes / contains / uses / covers / depends_on / relies_on / relates_to / related_to / defines / refers_to / causes / examples / exemplifies` 映射为中文；未知关系原样返回。
- 节点超过 60 个时仍渲染，但默认关闭 MiniMap 和持续动画，避免低配设备卡顿。

- [ ] **步骤 4：编写画布状态失败测试**

```tsx
it('有节点和边时渲染画布而不是 Nodes/Edges 列表', () => {
  render(<KnowledgeGraphCanvas graph={proposal} loading={false} />)
  expect(screen.getByTestId('knowledge-graph-canvas')).toBeInTheDocument()
  expect(screen.queryByText('NODES')).not.toBeInTheDocument()
})

it('零节点、构建中和异常分别显示明确状态', () => {
  render(<KnowledgeGraphCanvas graph={emptyProposal} loading={false} />)
  expect(screen.getByText('暂无图谱节点')).toBeInTheDocument()
})
```

- [ ] **步骤 5：实现 `KnowledgeGraphCanvas`**

画布要求：

- 导入 `@xyflow/react/dist/style.css`，使用 `ReactFlowProvider`、`Background`、`Controls` 和 `fitView`。
- 高度桌面端 420px，窄屏 360px；宽度始终 `min-width: 0`，不得造成页面横向滚动。
- 支持滚轮/双指缩放、拖拽平移、节点拖拽、Fit View 和重新自动布局。
- 节点显示 label、中文类型和置信度；超长 label 两行截断并可通过 `title` 查看全文。
- 边显示中文关系，缩放低于 0.6 时隐藏关系标签。
- 图例只展示当前出现的节点类型；MiniMap 仅在节点数大于 20 时提供折叠开关。

- [ ] **步骤 6：替换 `KnowledgeGraphPanel` 中的 NODES / EDGES 两列，保留提案/已保存状态、生成、保存和 `warnings` 区域**
- [ ] **步骤 7：重构知识库页面信息层级**

桌面端使用“知识库列表 280px + 详情 minmax(0,1fr)”布局；详情头部放名称、描述和“从笔记选择”，下方先展示紧凑笔记列表，再展示全宽图谱。小于 `lg` 时改为单列，知识库列表横向或折叠显示；不得改变 `useKnowledgeBasePage` 的已有生成、保存、删除和选择行为。

- [ ] **步骤 8：使用项目现有 `--product-*` / `--surface-*` token 完成明暗主题样式，验证 focus-visible、44px 触控目标和文本对比度**
- [ ] **步骤 9：运行组件测试、全量前端测试、类型检查和构建**

```powershell
Set-Location notes-frontend
npm exec jest -- --runInBand __tests__/knowledge-graph-canvas.spec.tsx __tests__/knowledge-bases.spec.tsx
npm run type-check
npm run build
```

- [ ] **步骤 10：在 1440px、1024px、768px 和 390px 宽度分别人工验证**

验证场景包括：空知识库、加载已保存图谱、待保存提案、warnings 非空、长中文/英文节点名、60 个节点、暗色模式、缩放拖拽以及浏览器刷新后重新加载。

- [ ] **步骤 11：提交**

```powershell
git add notes-frontend/package.json notes-frontend/package-lock.json notes-frontend/src/components/knowledge-bases notes-frontend/src/app/dashboard/knowledge-bases/page.tsx notes-frontend/src/app/globals.css notes-frontend/__tests__/knowledge-graph-canvas.spec.tsx notes-frontend/__tests__/knowledge-bases.spec.tsx
git commit -m "feat(frontend): 可视化知识库知识图谱"
```

---

# 第二阶段：GraphRAG 助手

任务 8 的 `evidenceChunkIds` 是第二阶段的基础。在其完成后另行编写独立执行计划，范围固定为：轻量 Query Planner、Query Rewrite、Chunk 检索、图谱一跳扩展、证据重排、引用生成，以及点击引用定位原笔记。是否启用图谱由 planner 按问题决定，不允许每次请求都执行最昂贵链路。

# 第三阶段：知识整理提案

第三阶段另行编写独立执行计划，范围固定为：全局知识库创建与归属建议、增量新笔记归属、标签/分类建议、重复检测、拆分合并和内容修改 proposal；所有写操作逐条确认，整批执行具有 undo 记录，并支持用户修改意见后重新生成。未经确认不得直接修改笔记正文或知识库结构。

---

## 第一阶段最终验收清单

- [ ] `Note.embedding` 只由最终的“标题 + 摘要 + 分类名称 + 标签名称”生成，不再使用正文前 8000 字符。
- [ ] 正文变化时先生成 summary，再生成主题向量；只修改分类或标签时复用现有 summary。
- [ ] 陈旧异步任务无法覆盖新版本派生数据。
- [ ] 相似笔记推荐和聚类继续使用 `Note.embedding` 并通过回归测试。
- [ ] `note_chunks` 包含稳定的结构化 chunks，只有变化的 chunks 才调用 embedding。
- [ ] 自动保存继续快速落库，但派生任务只在实际变化后触发，并按笔记合并为静默 10 秒后的最新任务。
- [ ] Chunk 检索在向量搜索前后都执行权限和知识库边界校验。
- [ ] 搜索框保留关键词、向量和混合三种模式；结果按笔记聚合并展示最高分 Chunk、标题路径和额外命中数。
- [ ] 普通笔记列表不展示搜索证据，也不会因新增字段破坏旧响应兼容性。
- [ ] 知识库页面使用 React Flow 展示现有节点和关系边，不再显示 NODES / EDGES 原始列表。
- [ ] 图谱支持缩放、平移、节点拖拽、Fit View、自动布局、中文关系标签和类型图例。
- [ ] 知识库页面在明暗主题及 1440px、1024px、768px、390px 宽度下无横向溢出或遮挡。
- [ ] 删除笔记时同步删除关联 chunks。
- [ ] 两套 Atlas Vector Search index 均为 4096 维，名称和 path 正确。
- [ ] 6 条测试笔记回填零失败，第二次执行具有幂等性。
- [ ] `npm run test:unit` 和 `npm run build` 全部通过。
