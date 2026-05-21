# 稳定性重构工作交接（2026-05-21）

> **给下一个 AI 协作者：** 这份文档是 2026-05-19 ~ 2026-05-21 完成的稳定性重构工作的完整摘要，便于你冷启动接手项目。读完这一份就能知道：项目在做什么、上一轮改了什么、还剩什么没做、如何继续。

## 项目速览

- **仓库**：`yucyber/online-notes`（GitHub）
- **栈**：Next.js 14 (App Router) + React 18 前端、NestJS 10 + Mongoose 8 + Redis 后端、Yjs + y-websocket 协作、MongoDB
- **结构**：
  - `notes-frontend/` — Next.js
  - `notes-backend/` — NestJS
  - `y-websocket/` — 自托管 y-websocket 服务（带 JWT 鉴权）
  - `docs/superpowers/specs/` — 设计 spec
  - `docs/superpowers/plans/` — 实施 plan
  - `scripts/` — 跨包脚本
- **当前分支**：master，已 push 到 origin/master
- **上一轮工作产物**：5 个 commits（见下文「本轮交付」）

## 本轮交付（2026-05-19 ~ 2026-05-21）

主旨：实施 [docs/superpowers/specs/2026-05-19-stability-refactor-design.md](specs/2026-05-19-stability-refactor-design.md) 中的第一阶段稳定性修复（4 个高影响问题 + 1 个测试入口）。

### Plan 文件

按时间顺序：

1. **[plans/2026-05-19-stability-refactor-implementation.md](plans/2026-05-19-stability-refactor-implementation.md)** — 详细 step-by-step plan（1326 行）。逐步骤代码片段 + commit 命令。
2. **[plans/2026-05-19-stability-refactor-tasks.md](plans/2026-05-19-stability-refactor-tasks.md)** — 精简改写版（约 350 行）。按"症状 → 目标 → 决策 → 改动 → 验证 → 风险"组织。**优先读这个**——它是理解层；前者是执行层。
3. **本文件** — 工作交接。

两份 plan 是同一份工作的两种视图，不矛盾。tasks.md 头部还纠正了 implementation.md 的几个**阻断性错误**（shell glob、契约脚本正则、双倍计数等）；执行时按 tasks.md 的修订做的。

### 5 个 commit

按合并到 master 的顺序（最新在前）：

| Hash | 标题 | 主要内容 |
|------|------|---------|
| `1e08d0d` | refactor: split note access and counters | 拆出 `NoteAccessService` + `NoteCounterService`；修了三个 bug：tags 计数从来不同步、ACL owner 删笔记会失败、非法 ID → 500 |
| `72b3de7` | docs: add api contract drift register | 44 条契约漂移登记表 + 自动 diff 脚本 + assets/embeds 改抛 `FeatureUnavailableError` |
| `0efad1d` | fix: enforce board and mindmap ownership | board/mindmap getById/update 加 userId 边界；getById 支持「来源 note 可读则可读」；非法 ID → 400；duplicate `_id` → 409 |
| `7567848` | fix: pass auth token to collaboration websocket | 协作 ws 带 access_token；状态扩展 7 种中文 label；token 过期主动 destroy；401 时 disconnect 而非仅 setLocalMode |
| `cfb0bfd` | test: add backend unit test runner | 后端首个 `npm run test:unit`（基于 `node --test` + `ts-node/register`）|

总共 32 条新增 unit test（后端 20 + 前端 6 + 6 个原有），**全部通过**。

## 验证命令（必须能跑通）

```bash
# 后端单测（20 通过）
cd notes-backend
npm run test:unit

# 后端 build
cd notes-backend
npm run build

# 前端 type-check
cd notes-frontend
npx tsc --noEmit

# 前端聚焦测试（编辑器 6 个用例）
cd notes-frontend
npx jest __tests__/editor.tiptap.spec.tsx __tests__/editor.tiptap.auth.spec.tsx --no-coverage --runInBand

# API 契约 diff（必须输出 "44 drift rows"）
cd <repo-root>
npm run check:api-contract
```

## 关键决策记录（接手前必读）

1. **协作鉴权**：401 走 `provider.disconnect()`，不能只 `setLocalMode(true)`——y-websocket 默认会按 `maxBackoffTime` 在后台无限重连。
2. **Board/Mindmap 读权限双轨**：owner 直读；非 owner 必须 source note 给了 ACL/public 才能读。**写仍 owner-only**——避免一次性引入两层 ACL。
3. **NotesService.update 计数合并**：旧代码同时处理 `categoryId`（单值）和 `categoryIds`（数组）但分两条独立分支调 increment——同一 ID 出现在两边会被**双倍计数**。新代码合并成一个 Set 再 diff。三态判断（未传/空/有值）：未传字段保留原值，不被当作清空。
4. **NotesService.remove**：`findOne(ownerScope)` 后用 `deleteOne(ownerScope)`——旧代码 `deleteOne` 只按 `userId`，导致 ACL owner 删笔记总返「笔记不存在」。
5. **API 契约登记表**：仅是**对账**，不是实现。`assets`/`embeds` 仍未实现，前端入口现在抛 `FeatureUnavailableError` 让 UI 给出明确「暂不可用」提示。
6. **Jest config 修正**：原 `testMatch: ['... .tsx?']` 在 jest 29 的 micromatch 下不识别。改为 `'@(spec|test).@(ts|tsx)'` 后才真能跑测试。这意味着**之前 CI 上 jest 实际可能从来没跑过任何测试**——值得验证。
7. **后端测试入口**：用 `node --test` + `find` 展开（`node --require ts-node/register --require tsconfig-paths/register --test $(find test -name '*.test.ts')`）。Node 20.8 的 `--test <dir>` 对 .ts 不递归，所以用 find。

## 已知未做（spec 明确推迟到下一阶段）

按 spec「非目标」段落：

- **完整文件资产系统**（assets controller 缺失，本期只挂"暂不可用"提示）
- **完整 embeds 后端服务**
- **drafts/vector/network 后端**（OpenAPI 写了但未实现，登记表标 `mark-planned-or-remove`）
- **OpenAPI 完整生成链路**（本期只对账）
- **设置页密码假成功修复**
- **i18n 全量改造**
- **编辑页 UI 大拆分**
- **NotesService 完整拆分**（本期只拆出 access + counter，CRUD/缓存/AI/embedding/推荐/搜索/锁定仍在 NotesService 里）

## 仓库未提交状态（重要）

`git status` 一直显示约 80 条 `D .agents/skills/...` 和 `.claude/skills/...` 的删除。**这与本轮工作无关**，是会话开始前就已经存在的预存修改，本轮所有 commit 都用了**显式 add 文件名**避免把它们卷进来。下任何提交前都要明确：你要保留还是清除这些 skill 删除 + untracked 的新 skill 目录。这不是 bug。

`docs/superpowers/plans/2026-05-19-stability-refactor-implementation.md` 和 `specs/2026-05-19-stability-refactor-design.md` 显示为 modified——是之前会话留下的 IDE 自动改动，本轮也没动它们。

## 推荐的下一步（优先级排序）

如果用户要继续推进，按性价比排：

1. **真把 OpenAPI 对齐**——契约登记表已经把每条决策写下来了（44 条）。把 `document-openapi`（约 30 条）逐条补到 `notes-backend/openapi.yaml`，把 `mark-planned-or-remove`（7 条）标 planned 或删除。这一步纯文档，零风险。
2. **跑一次完整 jest 套件**（不只聚焦的两个文件）——之前 CI 大概率根本没跑通；现在 jest config 修了，跑全套会暴露多少 stale 测试。
3. **把 `.agents/skills` 和 `.claude/skills` 那批 staged 删除单独提一个 commit 处理掉**，让 working tree 干净。
4. **拆 NotesService 的下一块**：列表缓存（`findAll` 中的 redis 逻辑）边界很清晰，可以拆出 `NoteCacheService`。
5. **assets 真实现**——OSS/S3 + 一张 `assets` 表 + 简单 controller。
6. **设置页密码假成功**——spec 里提到但本期没做。
7. **WebSocket 服务端 token 刷新**——前端 token 过期后需要用户重新登录才能恢复协作；服务端要支持滚动续 token。

## 进入这个 codebase 的速读路径

如果你（下一个 AI）只有 30 分钟：

1. 读 [tasks.md](plans/2026-05-19-stability-refactor-tasks.md) 全文（约 350 行）。
2. 读 [api-contract-drift.md](../api-contract-drift.md) 表头几行 + 看一眼 44 行表格扫一眼。
3. `git log --oneline -8` 看最近提交节奏。
4. 跑上面「验证命令」的 5 条，确认你的环境能跑。

如果你有 2 小时：再加读 spec 全文 + `notes-backend/src/modules/notes/notes.service.ts`（依然是这个项目最大的 god class，700 行）。

## 联系信息和约定

- Git author：`kongjianghua <kongjianghua@codemao.cn>`
- 默认主分支：`master`（不是 main）
- Commit 风格：英文 conventional commits（`fix:`、`refactor:`、`docs:`、`test:`），但仓库历史也有中文 commit（如 `925485c websocket鉴权`），不强求统一。
- 用户偏好：直接合并 master，不开 PR（单人开发）。要合并前先把无关的 staged 改动 stash 或显式排除。
- 测试：后端用 Node 内置 `node:test`（不引入 Jest 给后端）；前端用 Jest 29 + ts-jest。

---

**最后一次验证时间**：2026-05-21
**当前 master HEAD**：`1e08d0d refactor: split note access and counters`
**远端状态**：与 origin/master 同步
