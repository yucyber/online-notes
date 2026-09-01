# P3 浏览器自动化验收报告

| 项目 | 结果 |
|---|---|
| 日期 | 2026-09-01 |
| 地址 | `http://localhost:3000` |
| 浏览器 | Chromium 151 / agent-browser Chrome 152 |
| 桌面视口 | 1440 × 900 |
| 移动视口 | 390 × 844 |
| 自动化方式 | Playwright + agent-browser |

## 结论

P3 核心交互与 RAG 检索链路均已通过。修复笔记派生任务调度和 Note 查询类型问题后，知识库中的唯一关键词能够命中，并返回可跳转的笔记引用。

## 验收结果

| 场景 | 结果 | 证据 |
|---|---|---|
| 注册并进入工作台 | 通过 | `screenshots/dashboard.png` |
| 统一小助手入口与空状态 | 通过 | `screenshots/assistant-empty.png` |
| 普通聊天流式回复 | 通过 | `screenshots/chat-result.png` |
| 关闭、重开及页面刷新后恢复历史 | 通过 | `screenshots/history-restored.png` |
| 强制“搜索笔记”路由与无证据降级 | 通过 | `screenshots/rag-empty-result.png` |
| 创建知识库并加入笔记 | 通过 | `screenshots/kb-note-added.png`、`screenshots/knowledge-base-with-note.png` |
| 已入库笔记的唯一关键词检索与引用跳转 | 通过 | 浏览器回归：返回 `[E1]` 并成功跳转原笔记 |
| 移动端笔记页与小助手布局 | 通过 | `screenshots/mobile-notes.png`、`screenshots/mobile-assistant.png` |
| 独立 Playwright 桌面与移动端加载 | 通过 | `screenshots/playwright-dashboard.png`、`screenshots/playwright-mobile.png` |

## ISSUE-001：已入库并保存的笔记无法被 RAG 检索（已修复）

| 字段 | 内容 |
|---|---|
| 严重程度 | High |
| 分类 | Functional / RAG indexing |
| 页面 | `/dashboard/notes`、`/dashboard/knowledge-bases` |
| 状态 | 已修复并通过浏览器回归 |

### 现象

测试笔记正文包含唯一关键词“蓝色海豚”，编辑器显示“已自动保存”；知识库页面确认目标知识库包含 1 篇笔记。但在小助手开启“搜索笔记”后，多次询问“蓝色海豚对应的项目结论是什么？”，始终返回“笔记中未找到相关记录”，没有引用来源。

### 复现步骤

1. 创建笔记并写入正文：`P3 项目最终结论是：统一小助手入口，但保留普通聊天与 RAG 后端链路。关键词：蓝色海豚。`
2. 保存笔记，确认编辑器显示“已自动保存”。
3. 创建知识库并通过“从笔记选择 → 加入知识库”加入该笔记，确认知识库显示 1 篇笔记。
4. 打开小助手，开启“搜索笔记”。
5. 输入“蓝色海豚对应的项目结论是什么？”并发送。
6. 实际结果为“笔记中未找到相关记录”；预期应命中该笔记并返回引用。

### 根因与修复

1. 派生任务使用固定 `jobId`，但已完成任务仍保留在 BullMQ 中，导致同一笔记后续保存无法重新入队。调度器现在会先移除同 ID 的 completed job，再创建最新快照任务。
2. Note schema 的 `userId` 在当前 Mongoose 定义中是 Mixed，worker 使用字符串查询时不会自动转换为 BSON ObjectId，因而把存在的笔记误判为无权限或不存在。worker 现在显式使用 ObjectId 查询 `_id` 与 `userId`。

### 修复后回归

- 最新派生任务状态为 completed，返回 `{ status: 'completed' }`。
- MongoDB 已生成目标笔记的 chunk 与 embedding。
- 询问“蓝色海豚对应的项目结论是什么？”后，小助手返回正确结论及 `[E1]` 引用。
- 点击引用可跳转到原笔记及对应 chunk，浏览器控制台无相关错误。

## 其他观察

- 控制台没有与小助手/RAG 操作直接相关的未处理异常。
- 开发环境存在 Next.js HMR、React DevTools 提示和部分被取消的重复列表请求，不影响本次核心流程。
- agent-browser 录屏依赖 ffmpeg，本机未安装，因此本次采用逐步截图作为证据。
- Playwright MCP 已加入 Codex 全局配置；当前任务需重载后才能直接显示 MCP 工具，本轮已用 Playwright CLI 验证 Chromium、认证状态加载及桌面/移动端访问能力。
