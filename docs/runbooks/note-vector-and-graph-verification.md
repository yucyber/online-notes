# 笔记向量、Chunk 与图谱验收运行手册

本手册用于只读验收语义搜索派生数据和两套 Atlas Vector Search index。不要在聊天、工单或截图中粘贴 API key、MongoDB URI、密码或 token。

## 默认只读检查

在仓库根目录运行：

```powershell
node scripts/check-semantic-search.mjs --with-db
```

脚本会对配置值脱敏，并分别报告普通 MongoDB B-tree index 与 Atlas Vector Search index。它还会抽样检查 summarySource、4096 维主题/Chunk embedding、正文 headingPath、HTML 标签闭合以及 `contentHash`、`embeddingModel`、`chunkStrategyVersion`。输出只列标题和失败对象 ID，不输出完整正文、连接串或 API key。

只预览回填范围，不写数据库：

```powershell
Set-Location notes-backend
npm run backfill:note-vectors
```

dry-run 会列出笔记数量、预计重建数量、预计更新字段、是否改变业务 `updatedAt` 和预计模型请求数。没有用户明确确认时，不要添加 `--execute`。

如果 embedding 已完整、仅缺少 Chunk provenance 元数据，可先运行：

```powershell
Set-Location notes-backend
npm run backfill:note-vectors -- --metadata-only
```

获得用户对报告范围的明确确认后，才可追加 `--execute`。该模式只补空缺的 `embeddingModel` 和 `chunkStrategyVersion`，保留已有非空值，复用现有 embedding，模型请求数为 0，且不写 Note 或改变业务 `updatedAt`。

## U2：在 Atlas 控制台确认 Vector Search index

如果脚本报告“权限不足/无法确认”，只需在你已有权限的 Atlas 控制台完成以下操作；无需向代理提供任何秘密：

1. 登录 MongoDB Atlas，选择本项目及承载当前数据库的 cluster。
2. 打开 **Atlas Search**（部分界面显示为 **Search & Vector Search**），不要进入普通 **Indexes** 页。
3. 选择实际业务数据库和 `notes` collection。
4. 确认存在名为 `vector_index` 的 Search index，状态为 `READY`，JSON 定义中的 vector field 为：

   ```json
   {
     "type": "vector",
     "path": "embedding",
     "numDimensions": 4096,
     "similarity": "cosine"
   }
   ```

5. 选择同一数据库的 `note_chunks` collection。
6. 确认存在名为 `note_chunk_vector_index` 的 Search index，状态为 `READY`，JSON 定义中的 vector field 为：

   ```json
   {
     "type": "vector",
     "path": "embedding",
     "numDimensions": 4096,
     "similarity": "cosine"
   }
   ```

7. 如果只在普通 **Indexes** 页看到同名 B-tree index，它不能用于 `$vectorSearch`；仍需在 **Atlas Search** 页面创建或确认上述 Search index。
8. 将两套 index 的名称、collection、状态、path、dimensions 和 similarity 的确认结果告知代理即可，不要发送连接信息。

在 U2 未由脚本自动确认或用户完成控制台确认前，P1 的 U2 不得标记完成。

## 覆盖重建的授权边界

只有用户明确确认 dry-run 报告中的范围后，才可运行写入模式：

```powershell
Set-Location notes-backend
npm run backfill:note-vectors -- --execute
```

写入会更新 AI summary 相关字段、主题 embedding 字段和 `note_chunks`，派生写回不应改变 Note 的业务 `updatedAt`。执行后再次运行默认只读检查，并保留报告中的计数和失败 Note ID；不要记录正文或秘密。

## 图谱与 UI 验收

自动化门禁通过后，打开：

- `http://localhost:3000/dashboard/notes`：分别检查 keyword、vector、hybrid 的 Chunk 证据。
- `http://localhost:3000/dashboard/knowledge-bases`：检查 saved/proposal graph、warnings、筛选、布局和交互。

最终颜色、密度、长文本可读性、窄屏与明暗主题观感由用户进行主观视觉确认；自动化或代理不能代替该确认。
