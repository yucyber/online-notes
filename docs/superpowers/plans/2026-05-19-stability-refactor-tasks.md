# 稳定性与重构任务简报

> **与现有 plan 的关系：** 本文件是 [`2026-05-19-stability-refactor-implementation.md`](2026-05-19-stability-refactor-implementation.md) 的**精简改写版**，按「症状 → 目标 → 决策 → 改动 → 验证 → 风险」组织。详细 step-by-step、代码片段、commit 命令仍以 implementation 文件为准；本文件用来理解每个任务在治什么病、为什么这样治、如何独立交付。
>
> 配套 spec：[`docs/superpowers/specs/2026-05-19-stability-refactor-design.md`](../specs/2026-05-19-stability-refactor-design.md)。
>
> **执行顺序：** 任务 1 → 2 → 3 → 4。每个任务结束都应可上线、可独立 revert。

## 前置：补一个能跑的后端测试入口

后端目前没有任何 `test:*` 脚本。任务 2 和任务 4 都要写后端单测，所以这一步要先做，不算独立任务。

- 在 `notes-backend/package.json` 增加 `test:unit` 脚本，使用 Node 内置 test runner + `ts-node/register`。
- glob 必须用**单引号包裹**，否则 zsh 在没匹配到时直接报错；命令形如：`node --require ts-node/register --require tsconfig-paths/register --test 'test/**/*.test.ts'`。
- 顺手加一个 `test/sanity.test.ts`（断言 `1 === 1`），让首次运行可以成功退出，验证脚本本身没问题。

---

## 任务 1：让协作真的能连上

### 症状
- 任何用户打开笔记，右上角「连接状态」会在「连接中」和「已断开」之间反复跳，多人实时编辑实际上不工作。
- 浏览器 devtools 看 ws 握手 URL 里没有 `access_token`，服务端 401 拒绝。
- 未登录用户、或 token 过期后，前端不知道是鉴权问题，仍在后台无限指数退避重连。

### 目标
- **有 token**：连得上，状态显示「已连接」。
- **没 token**：不发起连接，UI 显示「协作需要登录」，本地编辑+IndexedDB 仍可用。
- **token 中途过期**：主动 `destroy` provider，状态切到「登录已过期，协作已暂停」。
- **服务端拒（401/4401/1008）**：停止重连，状态切到「协作鉴权失败」。
- **同标签页换号/退出**：协作连接随之重建。

### 关键决策
- token 从 `localStorage` 经 `getToken()` 读取，**不另造存储**。
- 同标签页通知靠新自定义事件 `notes:auth-changed`（在 `setToken`/`removeToken` 末尾派发）；跨标签页靠 `storage` 事件；窗口聚焦时也刷一次。
- 状态枚举从 `connecting/connected/disconnected` 扩展为 7 个：`config-missing / auth-missing / auth-expired / auth-failed / connecting / connected / disconnected`；**UI 用中文 label 渲染**，不要直接把枚举值贴到屏幕上。
- 401 信号**主路径是 `connection-error`**；`connection-close` 的 `1008/4401` 只作兜底。原因：y-websocket 在 upgrade 阶段失败时优先派 `connection-error`。
- 鉴权失败时**必须 `provider.disconnect()`**，光 `setLocalMode(true)` 不够——y-websocket 仍会按 `maxBackoffTime` 在后台重连。

### 改动文件
- `notes-frontend/src/lib/auth.ts`：定义事件常量，`setToken/removeToken` 末尾派发。`persistAuthSession` 已经走 `setToken`，不要重复 emit。
- `notes-frontend/src/components/editor/TiptapEditor.tsx`：
  - 新增 `authToken` state，并把它作为 WS effect 依赖；监听 `notes:auth-changed`、`storage`、`focus` 三个事件刷新。
  - WS effect 入口处先判 token：缺则进入 `auth-missing` 早返回；过期则进入 `auth-expired` 早返回。
  - `WebsocketProvider` options 增加 `params: { access_token: token }`。
  - 创建后挂一个 `setTimeout` 到 `exp`，到期主动 `destroy` provider 并 setState `auth-expired`。
  - `connection-close` 和 `connection-error` 内识别 401，进入 `auth-failed` 并调 `disconnect()`。
  - 状态渲染改成查表：`COLLAB_STATUS_META[connStatus].label`。
- `notes-frontend/__tests__/editor.tiptap.spec.tsx`：从 vitest 切到 jest 全局；mock `y-websocket` 和 `y-indexeddb`。

### 验证
- **自动**：
  - 有 token 时 provider 被构造，options.params.access_token 等于 token。
  - 无 token 时 provider 不构造，UI 出现「协作需要登录」。
  - 无 `NEXT_PUBLIC_YWS_URL` 时 UI 出现「协作配置缺失」。
  - 模拟 token 过期（用 `jest.useFakeTimers`，**token `exp` 至少给 5 秒**避免与编码漂移竞争），定时器触发后 `destroy` 被调，UI 出现「登录已过期」。
- **手动**：
  - 登录后两个标签页打开同一笔记，输入文字应实时互通。
  - devtools 删 `notes_token`，状态切到「协作需要登录」，编辑器仍可输入。
  - 在一个标签页登出，另一个标签页的协作应在 token 失效后停止重连。

### 风险与陷阱
- **`setTimeout` 32-bit 上限**：`exp - now` 可能超过 `2_147_483_647 ms`（约 24.8 天），需 `Math.min`。当前 token 通常几小时到几天，但要兜住。
- **浏览器 sleep 后定时器被 throttle**：定时器可能比 `exp` 晚触发，必须有 `connection-close` 1008/4401 兜底，且兜底里也要 `disconnect()`。
- **测试中 `jest.mock` 与 `await import` 的 hoist 顺序**：把 `jest.mock` 写在文件顶层而不是 `describe` 内；每个 `beforeEach` 清空 `providerInstances` 数组，避免上个 case 污染。
- **early-return 分支的 cleanup**：在 `auth-missing` / `auth-expired` / `config-missing` 三个早返回分支里直接 `return`，不要让外层 cleanup 闭包引用未初始化的 `degradeTimer`/`appHeartbeat`。

### 独立性
此任务**不依赖**其它任务，可以单独 ship。

---

## 任务 2：给画板和思维导图加用户边界

### 症状
- 用户 A 创建画板，URL 是 `/dashboard/boards/<board-id>`。
- 用户 B 拿到这个 URL，**直接能打开**，能读内容，PUT 也能改。
- 用户 B 用同一个 ID `POST /v1/boards { _id }`，后端不会冲突——因为前端 404 自动创建逻辑认为「不存在就建」，把已有资源当成新的。
- 思维导图 (`mindmaps`) 行为完全一样。

### 目标
- 资源只能被 owner 读写。
- 例外：如果资源是嵌入在某条共享笔记里的，**笔记的 ACL 协作者和 public 读者也能读**（不能改），避免共享笔记里嵌入的画板/思维导图回归为「无权限」。
- 非法 ObjectId 返 400，不再 500。
- `POST` 带客户端 `_id` 时若已存在但属于他人，返 **409 Conflict**；前端把它显示成「资源已存在或无权限」，**不是「创建失败」**。
- 前端只在确认 404 时才自动创建；401/403 直接显示「无权限」。

### 关键决策
- **读路径双轨**：owner 直接可读；非 owner 走「来源 note 是否可读」判定。判定复用现有 `notes` ACL 语义（`userId === me || acl.userId === me || visibility === 'public'`）。
- **写路径仍 owner-only**：不允许 note 协作者直接改嵌入资源——避免一次 ACL 引入两层语义。
- **来源 note 可读 ACL 角色**：本阶段**全部角色（owner/editor/viewer/commenter）都视为可读**，这与现有 `getAcl` 行为一致。如果后续要收紧到 viewer 以上再单独改。
- 非法 ID 在 service 层入口抛 `BadRequestException`，集中在一处而不是散落各处。

### 改动文件
- `notes-backend/src/modules/boards/`：
  - `boards.module.ts`：`MongooseModule.forFeature` 多注入一个 `Note` schema。
  - `boards.service.ts`：constructor 注入 `noteModel`；`getById(id, userId)` 走 owner-or-source-note；`update(id, userId, …)` owner-only；`create` 在 mongo `code === 11000` 时抛 `ConflictException`。
  - `boards.controller.ts`：`GET/:id` 和 `PUT/:id` 注入 `@Req()` 把 `req.user.id` 传 service。
- `notes-backend/src/modules/mindmaps/`：完全对称改动。
- `notes-frontend/src/app/dashboard/boards/[id]/page.tsx` 和 `mindmaps/[id]/page.tsx`：catch 分支按 status 分流（404 → 创建；401/403 → 显示无权限；其他 → 加载失败）。
- `notes-backend/test/boards-mindmaps-access.test.ts`：service 级单测（owner 可读、跨用户拒、ACL 协作者可读、跨用户改拒、duplicate `_id` 抛 409）。

### 验证
- **自动**：上面列的 5 个 service 级 case。
- **手动**：
  - 用户 A 创建画板，复制 URL。
  - 用户 B 登录后打开同一 URL —— 应显示「无权限访问该画板」，**不再自动创建一个新的同 ID 画板**。
  - 用户 A 把那条笔记分享给 B（加 ACL viewer），B 打开嵌入了画板的笔记 —— 画板应**只读可见**。
  - 用户 B 拿同样 `_id` POST —— 应返回 409，前端显示「画板已存在或无权限访问」。

### 风险与陷阱
- **前端错误对象形状**：plan 假设 `e.response?.status`（axios 形状）。改之前先确认页面用的是 axios 还是裸 fetch；如果是 fetch，要改成读 `e.status` 或先把 fetch 包成抛带 status 的错误。
- **测试 mock 与真实 mongoose `$or` 紧耦合**：用手写的 `findOne` mock 复刻 `$or` 形状容易在未来重构时碎裂；接受这个代价，但在测试文件顶部注释提醒后人「这是形状契约测试」。
- **`getById` 必须先按 `_id` 单条查，再判归属**——不能直接 `_id + userId` 查，否则无法把「资源不存在」和「资源存在但无权限」分开（前者返 404 即可，后者要在 ACL 判断后再决定 404/403）。本阶段全部用 404，避免泄露存在性。

### 独立性
依赖**前置（后端测试入口）**；不依赖任务 1。

---

## 任务 3：把 API 契约漂移登记成可审计清单

### 症状
- 前端 `assetsAPI.uploadBase64` 调 `/api/v1/assets/base64`，按钮按下去没反应——后端根本没这个 controller。
- 前端 `embedsAPI.create` 调 `/api/v1/embeds`，**静默失败**。
- OpenAPI 写了 `/api/v1/drafts/*`、`/api/v1/vector/*`、`/api/v1/network/*`——后端没实现。
- 后端有 `/api/v1/boards`、`/api/v1/mindmaps`、`/api/v1/semantic/*`——OpenAPI 没写。

### 目标
- 一份 **Markdown 登记表**，列出所有「前端有但后端没/后端有但 OpenAPI 没/OpenAPI 有但后端没」的路径，每条给出**一个决策**：
  - `implement-now`：本阶段必须补最小实现。
  - `hide-client-entry`：前端入口隐藏或加「暂不可用」提示。
  - `mark-planned-or-remove`：OpenAPI 标注 planned 或删掉。
  - `document-openapi`：后端已经有，补 OpenAPI。
- 一个 **可重复运行的脚本**，从 `notes-frontend/src/lib/api.ts` 和 `notes-backend/openapi.yaml` 抽路径做 diff，确认每条都在登记表里、登记表里也没有「已经对齐了还挂着」的过期项。
- 前端**所有 `hide-client-entry` 入口必须显示提示**——spec 明文要求，不能静默失败。

### 关键决策
- **本阶段不实现任何缺失后端**。这一任务做的是「对账」，不是「补功能」。补功能是后续 spec 的事。
- **脚本不固化行数**，输出实际 drift 数。原 plan 写「预期 44 rows」是脆性断言。
- 决策枚举只有上面四种；脚本校验每行的 decision 必须落在白名单内。

### 改动文件
- 新建 `docs/api-contract-drift.md`：登记表。表头：`路径 | 消费者 | 后端状态 | OpenAPI 状态 | 决策 | 验证方式`。
- 新建 `scripts/check-api-contract.mjs`：抽路径、做对称差、对照登记表。
- 修改根 `package.json`：**只加** `"check:api-contract": "node scripts/check-api-contract.mjs"`，**不增加新依赖**（根目录 `y-websocket/yjs/ws/ts-node` 已经在，原状保留）。
- 修改 `notes-frontend/src/lib/api.ts` 中 `assetsAPI.uploadBase64`、`assetsAPI.getById`、`embedsAPI.create` 三处：调用前先抛/返回明确的「该功能暂不可用」错误，让 UI 能显示提示——这是 `hide-client-entry` 的落地，不能只在登记表里写。

### 验证
- **自动**：
  - `npm run check:api-contract` 输出 `API contract drift register OK: <N> drift rows`，无未登记/过期项。
  - 故意在 `api.ts` 里加一行假调用 `/api/fake`，脚本应报「未登记 drift」并退出 1。
  - 故意把登记表里某行删掉，脚本应报「未登记 drift: <path>」。
- **手动**：
  - 打开附件上传 UI 点上传按钮——应弹出/显示「附件上传暂不可用」之类的提示，而不是按下去没反应。
  - 打开 Embed 创建入口——同上。

### 风险与陷阱
- **客户端路径抽取的正则**：原 plan 的正则 `[^\`'"]+` 在模板字符串 `` api.get(`/notes/${id}`) `` 上**会停在第一个反引号**，整条路径被跳过。**修法**：用更宽松的 capture（允许 `${...}`），抽出后再 `replace(/\$\{[^}]+\}/g, ':id')`。
- **OpenAPI 路径占位符不统一**：OpenAPI 用 `{id}`，客户端用 `:id`/`${id}`。两边都 normalize 到 `:id` 再比较，否则**所有 OpenAPI 路径都会进 drift**。
- **OpenAPI yaml 缩进/引号**：原正则 `^  (\/api[^:]+):\s*$` 假设 2 空格缩进、无引号、路径不含冒号。先 grep `^\s*['"]?/api` 取样本看真实样子，再写正则。
- **`extractClientPaths` 假设全部走 `api.METHOD`**：如果有 `axios.get`/`fetch`/二次封装（`notesAPI.list = () => api.get(…)`），正则会漏。先 grep 一遍 `api.ts` 的真实用法，**用 grep 结果决定正则**，不要先写正则再期待真实代码配合。
- **登记表的 `:id/:id` 重复占位符**：例如 `/api/notes/:id/acl/:id` 实际是 `:noteId/:userId`，归并时会冲突。登记表里应写真实参数名（`:noteId`、`:targetUserId`），脚本比对时再统一压成 `:id`。

### 独立性
**完全独立**于任务 1、2、4，可以最早做也可以最晚做。但因为它会迫使你看清「项目到底有多少没对齐」，建议放在任务 1、2 之后，那时你已经实际接触了 boards/mindmaps，对契约有体感。

---

## 任务 4：拆出 NoteAccessService 和 NoteCounterService

### 症状
- `notes-backend/src/modules/notes/notes.service.ts` 接近 700 行，CRUD/ACL/计数/缓存/AI/embedding/推荐/锁定全在一个 class。
- **真实 bug 1**：更新笔记时 `tags` 数组变化，标签计数**完全不同步**——只同步了 `categoryId/categoryIds`。
- **真实 bug 2**：`remove()` 前置校验允许 ACL owner 删笔记，但 `deleteOne` 只按 `userId` 过滤，ACL owner 实际**删不掉**——`findOne` 通过但 `deletedCount === 0`，抛「笔记不存在」误导用户。
- **真实 bug 3**：到处散布 `new Types.ObjectId(id)`，非法 ID 抛原始错误，落地是 500。

### 目标
- 抽出 `NoteAccessService`：负责 ObjectId 校验 + 构建三种查询范围（read/write/owner）。
- 抽出 `NoteCounterService`：负责分类/标签计数差量 + create/update/delete 三个时点的同步。
- 顺手修上面 3 个真实 bug。
- **不改** Controller 路径、DTO、前端调用方式、列表缓存 key 语义。

### 关键决策
- **只拆这两块**。CRUD/缓存/AI/embedding/推荐/搜索/锁定全部留在 `NotesService`。原因：这两块边界最清晰（纯函数 + 单一职责），其余职责拆出来需要重新设计接口，本阶段不做。
- **计数顺序执行不并行**。`categoriesService.incrementNoteCount` 内部是 mongo `$inc`，并发理论安全；但**顺序写法贴近原行为**，万一未来改成读-改-写，顺序版不会丢更新。`Promise.all` 留给真无副作用的并行。
- **单值 `categoryId` 和数组 `categoryIds` 合并差量**。原代码两条分支独立调 `incrementNoteCount`，如果调用者同时传两个字段且指向同一分类，会**双倍 +1/-1**。`NoteCounterService.updateCategories` 接收的是 `prev: string[]` 和 `next: string[]`，调用方先把单值和数组合并成 Set 再传入。
- **`remove` 的 `deleteOne` 用 `ownerScope`**。和前置 `findOne` 用同一个 scope，删除条件与校验条件一致。
- **`ownerScope` 的语义**：`userId === me || acl.role === 'owner'`。spec 已经认可 ACL owner 能删，本任务把行为对齐到 spec，**不再回退到只按 userId**。

### 改动文件
- 新建 `notes-backend/src/modules/notes/note-access.service.ts`：`objectId`、`readScope`、`writeScope`、`ownerScope` 四个方法。
- 新建 `notes-backend/src/modules/notes/note-counter.service.ts`：`diffIds`、`incrementForCreate`、`updateCategories`、`updateTags`、`decrementForDelete`。
- 修改 `notes.module.ts`：provider/exports 加上两个新 service。
- 修改 `notes.service.ts`：constructor 注入两个新 service；`create/findOne/update/remove` 内部委托。
- 新建 `notes-backend/test/note-access-counter.test.ts`：
  - `objectId` 接受合法、拒非法。
  - `readScope`/`writeScope`/`ownerScope` 返回的 `$or` 结构正确。
  - `diffIds` 返回 add/remove 集合。
  - **至少一条** `remove` 集成 case：ACL owner 调 remove，资源真被删，计数正确回滚（用 mock model）。

### 验证
- **自动**：
  - 上面列的单测。
  - `npm run build`（NestJS 编译能过——provider 注入容易写错）。
- **手动**：
  - 创建笔记加几个 tag → 查 tag 列表，count 应 +1。
  - 修改笔记把 tag 改成不同集合 → count 应正确 -1/+1。**这是修 bug 2，重点验。**
  - 笔记设 ACL owner 给用户 B → B 删笔记应成功，且分类/标签计数正确 -1。**这是修 bug 3，重点验。**
  - 用非法 ID 调 `/api/notes/xxx` → 应返 400 而不是 500。

### 风险与陷阱
- **`update` 中 `categoryId` 与 `categoryIds` 的三态合并**：「未传」「传 `''`/空数组」「传有效值」三种状态不一样。未传的字段不能被当成「清空」，否则 PATCH 一个 title 就会把分类全清掉。在 service 里先判 `=== undefined`，再决定要不要进合并。
- **`originalNote.categoryIds.map(id => id.toString())` 中 `id` 与外层形参 `id` 同名**：合法但读着别扭，改成 `cid`。
- **测试 mock 不替代真 mongo**：mock 测的是查询形状契约，不是真实查询行为。如果未来想验真 mongo 行为，引入 `mongodb-memory-server`，本阶段不做。
- **`Note` 文档的 `categoryId` vs `categoryIds`** 当前在 schema 里**同时存在**——历史遗留。本任务**不动**这两字段的共存关系，只在计数合并时把它们看作同一个概念。彻底统一是后续 spec 的事。

### 独立性
依赖**前置（后端测试入口）**；不依赖任务 1、2、3。

---

## 任务完成后的整体验证

不要把这一步当成第 5 个任务——它是每个任务自己 ship 之前应该跑的最小集合：

```bash
# 前端
cd notes-frontend
npm run type-check
npm run lint
npm run ci:test          # 完整套件，含 90% 覆盖率门槛

# 后端
cd notes-backend
npm run test:unit
npm run build

# 根
npm run check:api-contract
```

**注意：仓库当前已有大量未暂存改动**（`.agents/skills/...` 的删除）。在开始任务 1 之前先决定：
- 把这些改动单独 commit/stash，让 working tree 干净；或
- 在每个任务的 `git add` 中**显式列出本任务相关的文件**，不要 `git add -A`，避免把无关删除卷进来。

---

## 决策回顾

为什么是这四个任务、为什么是这个顺序：

1. **任务 1（WS 鉴权）放第一**：用户感知最强（协作根本不工作），技术上又独立（只动前端 + 一个 auth helper），适合作为「第一个 ship 的修复」证明 plan 可执行。
2. **任务 2（Board/Mindmap 权限）放第二**：是**安全问题**，越早修越好；但需要先有后端测试入口，所以排在任务 1 之后。
3. **任务 3（契约对账）放第三**：发现性工作，不修代码，主要产出是清单+脚本。放第三是因为任务 1、2 已经让你对前后端契约有了第一手体感。
4. **任务 4（NotesService 拆分）放第四**：纯重构 + 顺手 bug 修。风险最低、收益最远期，放最后。

每个任务可以独立 revert，不需要回滚后续。
