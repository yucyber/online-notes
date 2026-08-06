# 功能收紧扫描报告（2026-08-06）

分支：`chore/harden-current-features-validation`  
范围：全仓已实现功能（账号、笔记、协作、知识库/图谱、AI、语义、看板导图、观测）  
协作服务 `y-websocket`：**本轮不改**  
本阶段状态：扫描结论已按审核修订；改码按下方「最终勾选顺序」执行  
落地顺序约定：**死代码 → 安全/边界 → AI/KB 边界 → 拆组件**

## 字段说明

| 字段 | 含义 |
| --- | --- |
| ID | `D*` Dead / `B*` Boundary / `S*` Split |
| 类别 | Dead / Boundary / Split |
| 位置 | 主要文件路径 |
| 现象 | 多做了什么 / 重复了什么 |
| 建议动作 | 删 / 合并 / 下沉 / 拆分 / 隐藏假能力 |
| 单一真相源 | Boundary 项合并后应以哪一层为准 |
| 风险 | 低 / 中 / 高 |
| 建议波次 | PR1 / PR2 / PR3 / PR4 / 结构债 / 暂缓 |
| 依赖 | 是否挡后续项 |
| 验收 | 改完应跑的命令或行为断言 |
| 引用核查 | 扫描时对调用方的结论 |

---

## 0. 功能域对照（在用 / 占位 / 重复 / 过厚）

| 功能域 | 状态 | 主要收紧关注点 |
| --- | --- | --- |
| 认证 Auth | 在用 | 无明显死代码 |
| 用户 / 设置 | 占位混入 | 改密码假成功（D08） |
| 笔记 CRUD / 缓存 | 在用 | NoteCache **保留**（B09 暂缓）；`notes.service` 过厚（S10 整洁债） |
| 分类 / 标签 | 在用 | 页面过大（S04，整洁债） |
| 版本 / 评论 / 通知 / 邀请 / ACL / 锁 | 在用 | `api.ts` 未用别名（D06） |
| 协作编辑 Tiptap / Yjs | 在用 + 过厚 | 双编辑面（D09→S02）；编辑器巨石（S01） |
| AI Gateway / 写作 / 摘要 / Pet | 在用 + 重复层 | BFF（B01）；Pet 图片死路径（D05）；legacy messages（B03 暂缓） |
| Mindmap / Mermaid AI | 在用 + 二次解析 | 前端 `ai-gateway.ts` 再 normalize（B02） |
| 知识库 / 图谱 | 在用 + 重复 ACL/normalize | B04、B08 |
| 语义检索 / 主题 | 在用 + 权限缺口 | keyword 无 userId（B05）；三层 fallback（B06） |
| 看板 / 思维导图资源 | 在用 | API 双表面（D07，非默认） |
| assets / embeds | 占位 | D03、D04、D10；契约决策从 hide → remove |
| RUM / health / 契约脚本 | 在用 | 每波结束后跑 `check:api-contract` |
| Coze 历史 | 残留脚本 | D01 |
| y-websocket | 在用 | **本轮不改** |

---

## 1. Dead（死代码 / 占位 / 假能力）

### D01 — 废弃 Coze 探测脚本

| 字段 | 内容 |
| --- | --- |
| 类别 | Dead |
| 位置 | `notes-frontend/scripts/test-coze.js` |
| 现象 | 直连 `api.coze.cn` / `COZE_*`；`package.json` 未挂脚本 |
| 建议动作 | 删除文件 |
| 风险 | 低 |
| 建议波次 | PR1 |
| 依赖 | 无 |
| 验收 | 文件不存在；`check-ai-config` 对 `COZE_` 禁令检查仍保留 |
| 引用核查 | 源码无其他 `coze` 运行时引用 |

### D02 — Lighthouse 报告产物

| 字段 | 内容 |
| --- | --- |
| 类别 | Dead |
| 位置 | `notes-frontend/localhost_2025-12-22_03-44-11.report.html`、`notes-frontend/localhost_2025-12-22_03-46-16.report.html` |
| 现象 | 性能报告 HTML，非运行时依赖 |
| 建议动作 | 从仓库删除；可选将 `*.report.html` 加入 `.gitignore` |
| 风险 | 低 |
| 建议波次 | PR1 |
| 依赖 | 无 |
| 验收 | 仓库内无上述文件 |
| 引用核查 | 无 import |

### D03 — `embedsAPI` 纯 stub（契约决策变更）

| 字段 | 内容 |
| --- | --- |
| 类别 | Dead |
| 位置 | `notes-frontend/src/lib/api.ts`（`embedsAPI`）；`docs/api-contract-drift.md` |
| 现象 | 一律 `FeatureUnavailableError`；无调用方；契约现为 `hide-client-entry`（stub 故意留着给脚本记账，含 `// path:` marker） |
| 建议动作 | **决策变更**：从 `hide-client-entry` 升级为 **remove-client-entry**。固定三件套：① 删除 stub / `// path:` marker；② 漂移表改为 `mark-planned-or-remove` 或移出消费者列；③ 跑通 `npm run check:api-contract` |
| 风险 | 低（须同步契约，否则脚本会踩） |
| 建议波次 | PR1 |
| 依赖 | 与 D04、D10 同 PR |
| 验收 | `npm run check:api-contract` 通过；无 `embedsAPI` |
| 引用核查 | **无任何** `embedsAPI` import/调用 |

### D04 — `assetsAPI` 假入口 + 空吞调用（契约决策变更）

| 字段 | 内容 |
| --- | --- |
| 类别 | Dead |
| 位置 | `notes-frontend/src/lib/api.ts`（`assetsAPI`）；`notes/[id]/edit/page.tsx`、`NoteClientWrapper.tsx` 附件按钮 |
| 现象 | `getById` 无调用；`uploadBase64` 恒 reject；UI 在 `FileReader.onload` 异步里调用且外层 `catch` 接不住（稳定性文档已记录），用户无反馈 |
| 建议动作 | **只删不提示**：删除两边附件菜单/按钮 + 删除 `assetsAPI` / `// path:` marker；漂移表同步为 `mark-planned-or-remove`；跑 `check:api-contract`。不采用「加提示保留按钮」 |
| 风险 | 低 |
| 建议波次 | PR1 |
| 依赖 | 与 D03、D10 同 PR；**取代原 D09「Wave 1 局部」** |
| 验收 | 两编辑页无附件入口；`check:api-contract` 通过 |
| 引用核查 | `uploadBase64` 仅上述两处；`getById` 无调用 |

### D05 — AI Pet 图片上传死路径

| 字段 | 内容 |
| --- | --- |
| 类别 | Dead |
| 位置 | `notes-frontend/src/components/ai/ChatWindow.tsx`；后端 `ai.controller` / BFF `pet/route.ts` 已 400 |
| 现象 | 前端仍可选图 / `FormData`；服务端已拒绝。**`pet/route.ts` 不是纯 `proxyJson`，还解析 FormData** |
| 建议动作 | 删除选图 UI、`FormData` 分支与 message.image 展示；只留文本聊天。**硬前置于 B01** |
| 风险 | 低 |
| 建议波次 | PR1 |
| 依赖 | 必须先于 B01（否则 catch-all 难接 multipart） |
| 验收 | ChatWindow 无 file input；仅 JSON 文本请求 |
| 引用核查 | 图片拒绝在 BFF 与 Nest 双写 |

### D06 — 未使用的 `api.ts` 别名

| 字段 | 内容 |
| --- | --- |
| 类别 | Dead |
| 位置 | `notes-frontend/src/lib/api.ts` |
| 现象 | 仅定义、无业务 import：`fetchAcl`、`createInvitation`、`listInvitations`、`revokeInvitation`、`replyComment` |
| 建议动作 | 删除上述未用别名；保留仍被使用的（如 `previewInvitation`、`listNotifications`、`listVersions` 等） |
| 风险 | 低 |
| 建议波次 | PR1 |
| 依赖 | 无 |
| 验收 | `rg` 无对已删别名的 import |
| 引用核查 | CollaboratorsPanel / CommentsPanel 走 `aclAPI` / `invitationsAPI` / `commentsAPI.reply` |

### D07 — boards/mindmaps 双套 API 表面（非默认）

| 字段 | 内容 |
| --- | --- |
| 类别 | Dead（重复表面，**有真实调用**） |
| 位置 | `api.ts`：`boardsAPI` / `mindmapsAPI` vs `createBoard` / `getBoard` / `createMindMap` / `getMindMap` / `save*` |
| 现象 | 独立页走独立函数；笔记插入菜单走 `boardsAPI.create` / `mindmapsAPI.create`；`.get` 无调用。**不是死代码，是双表面** |
| 建议动作 | 收敛为一套（保留独立函数 + save；插入菜单改用同一 create；删未用 `.get`） |
| 风险 | 低–中 |
| 建议波次 | **暂缓 / Wave 1.5**（不进默认 PR1；可放 S05 前独立小 PR） |
| 依赖 | 与 S02 同改编辑页更省事 |
| 验收 | 仅一套 create/get/save 表面；插入菜单仍可用 |
| 引用核查 | `.get` 无调用；`.create` 有调用 |

### D08 — 设置页改密码假成功

| 字段 | 内容 |
| --- | --- |
| 类别 | Dead（假能力） |
| 位置 | `notes-frontend/src/app/dashboard/settings/page.tsx` |
| 现象 | TODO 后直接 `setSuccess('密码更新成功')`；后端无接口 |
| 建议动作 | **隐藏改密码表单整块**（优于「点了提示未接入」）；不实现真改密 |
| 风险 | 低 |
| 建议波次 | PR1 |
| 依赖 | 无 |
| 验收 | 设置页无改密交互；无假成功文案 |
| 引用核查 | 后端无 change-password |

### D09 — 双笔记编辑面合并（仅结构债）

| 字段 | 内容 |
| --- | --- |
| 类别 | Split 前置（原 Wave 1 局部已并入 D04） |
| 位置 | `NoteClientWrapper.tsx` + `edit/page.tsx` + `[id]/page.tsx` |
| 现象 | 详情编辑壳与 `/edit` 页逻辑重叠 |
| 建议动作 | **路由钉死**：`/dashboard/notes/[id]` = 主编辑入口；`/edit` → redirect 到主入口；抽 `NoteEditorShell`（详见 S02） |
| 风险 | 中 |
| 建议波次 | 结构债（S02） |
| 依赖 | PR1 的 D04 已清假附件后再做 |
| 验收 | 只保留一个可编辑主路径；旧 `/edit` 书签可跳转 |
| 引用核查 | 列表「编辑」现指向 `/edit`，redirect 成本最低 |

### D10 — `FeatureUnavailableError` 空壳

| 字段 | 内容 |
| --- | --- |
| 类别 | Dead |
| 位置 | `notes-frontend/src/lib/api.ts`（`FeatureUnavailableError`） |
| 现象 | 仅被 assets/embeds stub 使用 |
| 建议动作 | D03+D04 删 stub 后删除该类 |
| 风险 | 低 |
| 建议波次 | PR1（随 D03/D04） |
| 依赖 | D03、D04 |
| 验收 | 类定义不存在 |
| 引用核查 | 仅 stub 使用 |

---

## 2. Boundary（多余边界 / 重复逻辑）

### B01 — AI BFF 收敛（硬前置 D05）

| 字段 | 内容 |
| --- | --- |
| 类别 | Boundary |
| 位置 | `notes-frontend/src/app/api/ai/*`、`_proxy.ts`；Nest `ai.controller.ts` |
| 现象 | 多数 route 为透传样板；pet 曾解析 FormData（D05 后应收成 JSON-only） |
| 建议动作 | **两步**：① 确认 BFF 是否必须（同源/藏后端地址/cookie→Bearer）；② 必须则收成 `/api/ai/[...path]`，否则评估客户端经 `api.ts` 直打 Nest。业务校验只留 Nest |
| 单一真相源 | Nest `AiController` / `AiService` |
| 风险 | 低–中 |
| 建议波次 | PR3 |
| 依赖 | **硬前置 D05** |
| 验收 | AI 写作/导图/Mermaid/摘要/Pet 文本仍可用；无 FormData 分支 |
| 引用核查 | `_proxy.ts` 为转发核心 |

### B02 — 前端 AI 客户端去掉二次 normalize

| 字段 | 内容 |
| --- | --- |
| 类别 | Boundary |
| 位置 | `notes-frontend/src/lib/ai-gateway.ts`；后端 `AiService` normalize/repair |
| 现象 | 客户端再剥 fence、切 JSON、markdown 图片 fallback |
| 建议动作 | 改名为 `ai-client.ts`；信任后端规范化；**保留**薄适配 `extractAnswerMessage`（legacy `messages`）；最多再 `JSON.parse`。**不同 B03 同 PR** |
| 单一真相源 | `notes-backend/.../ai.service.ts` |
| 风险 | 中 |
| 建议波次 | PR3 |
| 依赖 | B01 后或并行（不依赖 B03） |
| 验收 | mindmap/mermaid 生成仍成功；`ai-output-validation` 后端测通过 |
| 引用核查 | mindmap/mermaid 页经此客户端 |

### B03 — Coze 形 `messages` 契约变更（暂缓）

| 字段 | 内容 |
| --- | --- |
| 类别 | Boundary |
| 位置 | `AiService.toLegacyMessages`；前端 `extractAnswerMessage` |
| 现象 | 全链路仍吃 `{ messages: [{ type: 'answer', content }] }` |
| 建议动作 | 改为现代 `{ content }` / 结构化 JSON；调用方：writer / pet / summary / mindmap / mermaid + OpenAPI。**单独勾选、单独 PR** |
| 单一真相源 | Nest AI 响应 DTO |
| 风险 | 中–高（契约面大） |
| 建议波次 | **暂缓** |
| 依赖 | B02 可先做且不依赖本项 |
| 验收 | 全 AI 入口 + OpenAPI 一致 |
| 引用核查 | 改前需全量点名调用方 |

### B04 — 知识库 list 去重 + 扩展 NoteAccess

| 字段 | 内容 |
| --- | --- |
| 类别 | Boundary |
| 位置 | `knowledge-bases.service.ts`（`listNotes` / `listGraphNotes`）；`note-access.service.ts` |
| 现象 | 两方法复制 link 查询 + 手写 `$or`；`NoteAccessService` **目前只有** `readScope(noteId, userId)`（单条），**没有** list-level filter |
| 建议动作 | **先扩展** `readableFilter(userId)` 或 `idsInReadableSet(ids, userId)` + 测试；再抽 `listLinkedNotes(id, userId, { includeContent })` 让 KB 使用。不是「改两行 `$or`」 |
| 单一真相源 | 扩展后的 `NoteAccessService` |
| 风险 | 中–高 |
| 建议波次 | PR4 |
| 依赖 | 最小 note-access / KB 测试；B10 全量不做，只吃 KB 试点 |
| 验收 | listNotes/listGraphNotes 行为一致；无权笔记不出现；单测覆盖 filter |
| 引用核查 | graph 构建 / KB 页分别调用两方法 |

### B05 — Semantic keyword 未按 userId 过滤（安全，优先）

| 字段 | 内容 |
| --- | --- |
| 类别 | Boundary（安全） |
| 位置 | `semantic.service.ts` `search()`；`semantic.controller.ts` keyword/fallback |
| 现象 | vector 有 `userId`；keyword/`$text`/regex **无 userId/ACL** |
| 建议动作 | keyword 强制 access scope（至少 owner `userId`，理想与笔记列表 ACL/public 一致）；**先补最小测试再改** |
| 单一真相源 | Notes 查询 + `NoteAccessService` list scope |
| 风险 | **高**（结果集会变小：从「可能看见他人笔记」→「仅可见授权笔记」——这是正确性修复，不是回归） |
| 建议波次 | **PR2（Wave 2 最前）** |
| 依赖 | 与 B06 同 PR；执行前补 semantic 回归测 |
| 验收 | 跨用户笔记不被 keyword 命中；现有 vector 路径仍带 userId |
| 引用核查 | controller fallback 调用 `semantic.search` 未传 userId |

### B06 — 三层搜索 fallback 重叠（含前端降级）

| 字段 | 内容 |
| --- | --- |
| 类别 | Boundary |
| 位置 | semantic controller/service；前端 `semanticAPI.search` 404/503→`notesAPI.getAll`；notes keyword |
| 现象 | 三处 keyword 实现；前端降级与后端权限模型可能不一致（原建议 B11，并入本项） |
| 建议动作 | 后端统一 keyword + access scope；前端 fallback 仅韧性且结果须已是用户可见集 |
| 单一真相源 | 后端共享 query + access scope |
| 风险 | 高（随 B05） |
| 建议波次 | PR2（随 B05） |
| 依赖 | B05 |
| 验收 | semantic 挂了走 notes 列表时不放大权限 |
| 引用核查 | `api.ts` `semanticAPI` 有降级路径 |

### B07 — AI JSON fence / parse 共享

| 字段 | 内容 |
| --- | --- |
| 类别 | Boundary |
| 位置 | `ai.service.ts`；`knowledge-graph-build.graph.ts` |
| 现象 | fence/JSON 切片重复 |
| 建议动作 | 抽 `modules/ai/ai-output.ts` |
| 单一真相源 | `ai-output.ts` |
| 风险 | 低–中 |
| 建议波次 | PR3（可与 B01/B02 并行）或紧挨 PR4 前 |
| 依赖 | 为 B08 铺路 |
| 验收 | 相关 AI/graph 单测通过 |
| 引用核查 | aggregate-summary 仅 trim，可不强行合并 |

### B08 — KG proposal / persist normalize 共享

| 字段 | 内容 |
| --- | --- |
| 类别 | Boundary |
| 位置 | `knowledge-graph-build.graph.ts`；`knowledge-bases.service.ts` |
| 现象 | noteIds / type / edge fallback 规则相似、阶段不同 |
| 建议动作 | 共享纯函数；graph 宽松提案，persist 再加 ObjectId/scope |
| 单一真相源 | `knowledge-graph-normalize` util |
| 风险 | 中 |
| 建议波次 | PR4（或 PR3 末与 B07 同批） |
| 依赖 | B07 可先做 |
| 验收 | proposal + save graph 单测通过 |
| 引用核查 | `PUT .../graph` 与 `/ai/knowledge-graph/proposal` |

### B09 — NoteCache / Redis（暂缓）

| 字段 | 内容 |
| --- | --- |
| 类别 | Boundary |
| 位置 | `note-cache.service.ts`；semantic `new Redis(...)` |
| 现象 | NoteCache 薄但有意抽离且有单测；内联不减少 Redis 连接分裂 |
| 建议动作 | **默认保留 NoteCacheService**。可选专项：共享 `RedisCache`（notes + semantic）。**不做默认内联** |
| 单一真相源 | 若做共享：新建 Redis 基础设施模块；否则维持现状 |
| 风险 | 低（不动）/ 中（共享 Redis） |
| 建议波次 | **暂缓** |
| 依赖 | 无 |
| 验收 | — |
| 引用核查 | 仅 list 用 NoteCache；semantic 自建连接 |

### B10 — 跨模块 ACL 全量统一（暂缓）

| 字段 | 内容 |
| --- | --- |
| 类别 | Boundary |
| 位置 | notes / comments / versions / boards / mindmaps / KB |
| 现象 | 多处手写 `$or` |
| 建议动作 | **本轮不做全量**；只通过 B04 在 KB 试点扩展 NoteAccess |
| 单一真相源 | `NoteAccessService` |
| 风险 | 高 |
| 建议波次 | **暂缓** |
| 依赖 | B04 试点后再议 |
| 验收 | — |
| 引用核查 | KB 内联 `$or` 已确认 |

---

## 3. Split（本轮收紧相关 vs 整洁债）

### 本轮收紧默认只留

### S02 — 合并双笔记编辑面（= D09 落地）

| 字段 | 内容 |
| --- | --- |
| 类别 | Split |
| 位置 | `NoteClientWrapper` + `edit/page` + `[id]/page` |
| 建议动作 | 主入口 `/dashboard/notes/[id]`；`/edit` redirect；抽 `NoteEditorShell` |
| 风险 | 中 |
| 建议波次 | 结构债第一刀 |
| 依赖 | PR1 D04 |
| 验收 | 单编辑路径可用；锁/插入 board/mindmap 仍可用 |

### S01 — 拆 `TiptapEditor.tsx`（~1119）

| 字段 | 内容 |
| --- | --- |
| 类别 | Split |
| 位置 | `components/editor/TiptapEditor.tsx` |
| 建议动作 | 壳 + `useTiptapCollab` + `useTiptapPersistence` + extensions；顺手删无 dispatch 的 `embedPlaceholder` |
| 风险 | 中 |
| 建议波次 | 结构债（S02 后） |
| 依赖 | S02 |
| 验收 | 协作编辑 / 本地持久化仍可用 |

### S08 — 拆知识库页（~452）

| 字段 | 内容 |
| --- | --- |
| 类别 | Split |
| 位置 | `knowledge-bases/page.tsx` |
| 建议动作 | `KnowledgeBaseList` / `NotesPanel` / `GraphPanel` / `useKnowledgeBasePage` |
| 风险 | 低–中 |
| 建议波次 | 结构债（B04/B08 后） |
| 依赖 | PR4 |
| 验收 | 创建库 / 加笔记 / 生成保存图谱仍可用 |

### S05 — 拆 `api.ts`（~695）

| 字段 | 内容 |
| --- | --- |
| 类别 | Split |
| 位置 | `notes-frontend/src/lib/api.ts` |
| 建议动作 | 按域拆文件 + 过渡 re-export；**宜在 D07 之后**（若做了 D07） |
| 风险 | 中 |
| 建议波次 | 结构债 |
| 依赖 | PR1 Dead 已清 |
| 验收 | 类型检查 / 既有前端测通过 |

### 整洁债（不进本轮收紧默认队列）

| ID | 位置 | 说明 |
| --- | --- | --- |
| S03 | `notes/page.tsx` | 列表页拆分 |
| S04 | `categories/page.tsx` | 分类页拆分 |
| S06 | `dashboard/layout.tsx` | 布局拆分 |
| S07 | `DrawnixBoard.tsx` | 画板拆分 |
| S09 | new 页 / MarkdownEditor / SearchFilterBar | 一般整洁 |
| S10 | `notes.service` / `ai.service` | 后端瘦身（B07 后自然变薄即可） |

---

## 4. 最终勾选顺序（已定稿）

> 目标：先收紧、少翻车。未列入「执行」的 ID 视为暂缓，不进改码轮。

### PR1 — 假能力与死代码（立刻做）

勾选并执行：

- [x] **D01** 删 `test-coze.js`
- [x] **D02** 删 Lighthouse `*.report.html`
- [x] **D03** 删 `embedsAPI` + 契约 hide→remove
- [x] **D04** 删附件 UI + `assetsAPI` + 契约同步
- [x] **D10** 删 `FeatureUnavailableError`（随 D03/D04）
- [x] **D05** 删 Pet 图片 / FormData
- [x] **D06** 删未用 api 别名
- [x] **D08** 隐藏设置页改密表单

验收：`npm run check:api-contract`；前端相关页面无假入口。  
**不要**塞入：D07、D09、任何 B*、README、真改密。

### PR2 — 安全收紧（优先于结构重构）

- [x] **B05** Semantic keyword + access scope（先测试再改）
- [x] **B06** 统一搜索 fallback / 前端降级权限对齐

验收：跨用户 keyword 不泄漏；semantic 单测；说明「结果集变小是正确性修复」。

### PR3 — AI 表层

- [x] **B01**（D05 已完成后）评估保留 BFF 或 `[...path]` / 直打 Nest
- [x] **B02** 去掉前端二次 normalize（保留 `extractAnswerMessage`）
- [x] **B07** 共享 `ai-output` util（可本 PR 或紧随）

暂缓：

- [ ] **B03** 改 messages 契约（单独 PR，需再勾选）

### PR4 — 知识库边界

- [x] **B08** KG normalize 共享（若未进 PR3）
- [x] **B04** 扩展 NoteAccess list API + KB list 去重

暂缓：

- [ ] **B10** 全量 ACL 统一

### 结构债（PR1–4 完成后）

1. [x] **S02**（D09）双编辑面合并 + `/edit` redirect  
2. [x] **S01** 拆 Tiptap  
3. [x] **S08** 拆知识库页  
4. [x] **S05** 拆 `api.ts`（若先做了 D07 更好）

### 明确暂缓（默认不勾）

| ID | 原因 |
| --- | --- |
| D07 | ~~双表面有真实调用~~ → 已按绿场收敛为一套 API |
| B03 | 契约大爆炸（仍待做） |
| B09 | 内联收益低；共享 Redis 另开专项（仍待做） |
| B10 | ~~只通过 B04 试点~~ → 已扩到 comments/versions/boards/mindmaps/notes |
| S03/S04/S06/S07/S09/S10 | 整洁债，不抢收紧注意力 |

### 一览（执行流水线）

```text
PR1:  D01 D02 D03 D04 D10 D05 D06 D08
PR2:  B05 → B06
PR3:  B01 → B02 → B07
PR4:  B08 → B04
结构: S02 → S01 → S08 → S05
暂缓: D07 B03 B09 B10 S03 S04 S06 S07 S09 S10
```

---

## 5. 本轮明确不做

- 不实现 P1（RAG / Agent / rerank 业务化）
- 不实现设置页真实改密码
- 不在 PR1 顺手改 README / 依赖升级 / 大范围格式化
- 不删除 `check-ai-config` 对 `COZE_` 的禁令检查
- 不改 `y-websocket`（除非另开协作专项）
- 不默认内联 `NoteCacheService`

---

## 6. 扫描元数据

| 项 | 值 |
| --- | --- |
| 扫描日期 | 2026-08-06 |
| 修订 | 按两轮审核合并：契约决策变更、队列去重、B05 前置、B09/B03/D07 暂缓、Wave 3 砍到收紧相关、最终勾选定稿 |
| 基线提交 | `c3f0056` |
| 引用核查 | ripgrep + 关键文件精读 |
| 下一步 | 收紧队列（PR1–4 + S02/S01/S08/S05）已落地；暂缓项默认不动 |
