# 第一阶段稳定性与重构设计 Spec

日期：2026-05-19

## 目标

本阶段只解决四项高影响问题：

1. 协作 WebSocket 鉴权前后端不一致。
2. Board/Mindmap 资源读取与更新缺少用户边界。
3. 前端 API、后端 Controller、OpenAPI 契约漂移。
4. `NotesService` 职责过大，优先拆出权限与计数边界。

本阶段不处理设置页密码假成功、i18n 全量改造、编辑页 UI 大拆分、完整 OpenAPI 生成链路、资产上传完整存储方案。它们应进入后续独立 spec。

## 当前代码审查结论

### 协作鉴权

- `y-websocket/server.js` 在 upgrade 阶段读取 `access_token` 或 `token`，并用 `YWS_JWT_SECRET || JWT_SECRET` 校验。
- `notes-frontend/src/components/editor/TiptapEditor.tsx` 创建 `WebsocketProvider` 时没有传 `params.access_token`。
- `TiptapEditor` 在缺少 `NEXT_PUBLIC_YWS_URL` 时会进入本地模式，但缺 token、token 过期、401 关闭等状态没有明确区分。
- Provider cleanup 已有 `destroy()`、事件解绑和 interval 清理，但应在测试中固定，防止后续重构引入重复连接或泄漏。

### Board/Mindmap 权限

- `BoardsService.getById/update` 和 `MindmapsService.getById/update` 当前只按 `_id` 查询，没有 `userId` 约束。
- `BoardsController` 和 `MindmapsController` 的 `GET/PUT` 没有把 `req.user.id` 传给 service。
- 前端 `dashboard/boards/[id]/page.tsx` 和 `dashboard/mindmaps/[id]/page.tsx` 遇到 404 会用同一个 `_id` 自动创建资源。权限修复后必须避免把无权限误判成可创建。
- Embed 页面复用 `getBoard/getMindMap`，只读展示也不能绕过后端权限策略。

### API 契约漂移

- 前端 `assetsAPI` 调用 `/v1/assets/base64` 和 `/v1/assets/:id`，后端没有 assets controller。
- 前端 `embedsAPI` 调用 `/v1/embeds`，后端没有 embeds controller。
- `openapi.yaml` 描述了 `/api/v1/drafts/*`、`/api/v1/vector/*`、`/api/v1/network/*`，后端没有对应 controller。
- 后端实际存在 `v1/boards`、`v1/mindmaps`、`v1/semantic`，OpenAPI 没有完整覆盖这些实际接口。

### NotesService 拆分

- `notes.service.ts` 当前同时承担 CRUD、ACL、列表缓存、搜索过滤、AI 摘要、向量更新、推荐、锁定、分类/标签计数等职责。
- 直接大拆会影响面过大。本阶段只拆低耦合且高复用的权限判断与计数同步。
- 当前更新笔记时会同步 `categoryId/categoryIds` 计数，但没有同步 `tags` 变化；删除时允许 ACL owner 通过前置校验，但实际 `deleteOne` 又要求 `userId` 等于当前用户，行为不一致。
- 多处直接 `new Types.ObjectId(id)`，非法 ID 可能转成 500。拆分时应把 ID 校验纳入公共边界，但不顺手重写所有搜索/推荐逻辑。

## 设计原则

1. 先修会影响线上可用性和权限安全的问题，再做结构拆分。
2. 只改必要边界，不改变现有 Controller 路径、统一响应 envelope、前端 API 函数名和主要返回结构。
3. 所有权限失败要有一致语义：缺登录为 401；普通资源读取优先返回 404 避免泄露存在性；已进入已知资源上下文的写操作可返回 403。
4. 稳定性优先于表面连通：协作失败要降级到本地/IndexedDB，不允许无限重连或假成功。
5. 每个改动必须有测试入口；现有项目缺少后端测试脚本时，本阶段应补最小可运行测试入口或明确采用可运行的 service 级测试方式。

## 纳入的项目内 Skills

本 spec 在代码审查后补充读取并纳入以下项目内 skills：

- `.agents/skills/component-refactoring/SKILL.md`
- `.agents/skills/component-refactoring/references/hook-extraction.md`
- `.agents/skills/component-refactoring/references/component-splitting.md`
- `.agents/skills/react-state-management/SKILL.md`
- `.agents/skills/vercel-react-best-practices/SKILL.md`
- `.agents/skills/vercel-react-best-practices/rules/rerender-dependencies.md`
- `.agents/skills/vercel-react-best-practices/rules/client-event-listeners.md`
- `.agents/skills/vercel-react-best-practices/rules/advanced-event-handler-refs.md`
- `.agents/skills/vercel-react-best-practices/rules/client-localstorage-schema.md`
- `.agents/skills/vercel-react-best-practices/rules/async-parallel.md`
- `.agents/skills/vercel-react-best-practices/rules/js-set-map-lookups.md`

已读取 `.agents/skills/frontend-design/SKILL.md`，但本阶段不做 UI 视觉重设计，因此不把它作为实施约束。

这些 skills 对本阶段的约束如下：

1. 复杂逻辑优先抽 hook 或 service，而不是继续堆在大组件或大 service 中。
2. 超过 300 行或有多个独立状态组的 React 文件，优先抽 `use-*` hook 或按区域拆组件。本阶段直接适用于 `TiptapEditor` 的协作连接状态，但不要求重写整个编辑器。
3. React effect 依赖必须收窄到 primitive 值，避免把整个 `user`、配置对象或 provider 对象放入依赖导致重复订阅。
4. 事件订阅和 WebSocket/Yjs handler 应通过 ref 或稳定 cleanup 管理，避免每次 render 重绑。
5. localStorage/IndexedDB 相关读取必须 try/catch，并尽量使用带版本或命名空间的 key；不得把不必要的用户对象或敏感字段写入本地存储。
6. 独立异步操作应使用 `Promise.all` 并行；计数同步、契约检查和测试准备中不能无意义串行化。
7. 重复成员判断使用 `Set/Map`，尤其适用于 `NoteCounterService` 计算 category/tag 增减集合。
8. 不引入新的全局状态库。根据 `react-state-management` 的分类，本阶段只需要本地状态、URL 状态和服务器状态调用；不需要 Redux/Zustand/Jotai。

## 方案选择

采用“风险优先，逐步重构”的方案。

执行顺序：

1. 协作鉴权修复。
2. Board/Mindmap 权限修复。
3. API 契约缺口清单与收敛。
4. `NotesService` 拆出 `NoteAccessService` 与 `NoteCounterService`。

不采用“先做完整契约治理”，因为协作鉴权和资源越权是已知高风险问题。不采用“先大拆 NotesService”，因为它会在修复前引入过多变量。

## 详细执行清单

### 1. 协作鉴权修复

#### 实现清单

- 在前端新增一个轻量 token 读取函数，优先复用 `src/lib/auth.ts` 已有 token 存储约定。
- `TiptapEditor` 创建 `WebsocketProvider` 时传入 `params: { access_token: token }`。
- 当 `NEXT_PUBLIC_YWS_URL` 缺失时保持当前本地模式。
- 当 token 缺失时不创建 provider，进入 `auth-missing` 或等价的不可连接状态，并保留本地编辑/IndexedDB。
- 当连接关闭码或连接错误暗示 401/鉴权失败时，停止高频重连提示，保留本地编辑能力。
- 连接状态从单一 `connecting/connected/disconnected` 扩展为可表达：配置缺失、缺 token、鉴权失败、连接中、已连接、已断开。UI 文案可简短，不做大 UI 重设计。
- 保留 provider cleanup：解绑 `status/sync/destroy/awareness/update`，清理 heartbeat 和 degrade interval，销毁 provider。

#### 边界

- 未登录用户不应发起协作连接。
- token 过期不能导致无限重连。
- 同一编辑器实例不能重复创建多个 provider。
- 切换 `noteId/versionKey` 时旧 provider 必须释放。
- 只读页面如仍展示协作状态，也不得产生可写副作用。

#### 测试

- mock `WebsocketProvider`：有 token 时构造参数包含 `params.access_token`。
- 无 token 时不构造 provider，状态进入本地/不可连接。
- 无 `NEXT_PUBLIC_YWS_URL` 时不构造 provider。
- 组件卸载时 `destroy` 和事件解绑被调用。
- 模拟连接失败事件时不会抛出渲染错误，仍可保存本地内容。

#### 验收

- 配置了 YWS URL 和有效 token 时，WebSocket upgrade 不再因为缺 token 返回 401。
- 无 token 或 token 失效时，编辑器可继续本地编辑，不出现无限重连日志风暴。
- 前端 type-check 通过，相关 editor 测试通过。

### 2. Board/Mindmap 权限修复

#### 实现清单

- `BoardsController.get/update` 和 `MindmapsController.get/update` 注入 `@Req()`，向 service 传 `req.user.id`。
- `BoardsService.getById/update` 和 `MindmapsService.getById/update` 改为按 `_id + userId` 查询。
- 对非法 ObjectId 返回 400，避免直接落入 500。
- create 接口接受 client-supplied `_id` 时，先校验 ID 合法性；若该 `_id` 已存在但不属于当前用户，不能覆盖或伪装创建成功。
- 前端自动创建逻辑只在明确“资源不存在且允许创建”的场景触发，不对 403 或鉴权错误自动创建。
- Embed 页面保持只读展示，但仍通过后端权限；本阶段不新增公开分享能力。

#### 边界

- 用户 A 创建的 Board/Mindmap，用户 B 不能读取、更新或用同 ID 自动创建。
- 非法 ID 返回 400。
- 不存在的资源返回 404。
- 普通读取无权限建议返回 404，减少资源枚举风险。
- 更新接口在资源存在但无权限时可返回 404 或 403，但必须在 Board/Mindmap 内保持一致。

#### 测试

- 后端 service/controller 测试：A 创建，A 可读可改。
- 后端 service/controller 测试：B 读 A 的资源失败。
- 后端 service/controller 测试：B 改 A 的资源失败。
- 后端测试：非法 ID 返回 400。
- 前端测试或 API mock 测试：403/401 不触发自动创建；404 才进入创建分支。

#### 验收

- 资源访问不再只依赖 `_id`。
- 前端不会在无权限时创建同 ID 新资源。
- Board/Mindmap 原有创建和正常打开路径可用。

### 3. API 契约缺口清单与收敛

#### 实现清单

- 新增契约差异清单文档，记录路径、消费者、当前后端状态、OpenAPI 状态、决策和验收方式。
- 第一阶段至少纳入：
  - `/api/v1/assets/base64`
  - `/api/v1/assets/:id`
  - `/api/v1/embeds`
  - `/api/v1/drafts/auto-save`
  - `/api/v1/drafts/sync`
  - `/api/v1/vector/upsert`
  - `/api/v1/vector/batch-upsert`
  - `/api/v1/network/status`
  - `/api/v1/network/diagnostics`
  - `/api/v1/boards/:id`
  - `/api/v1/mindmaps/:id`
  - `/api/v1/semantic/*`
- 对每个缺口做三类决策之一：
  - `implement-now`：本阶段必须补最小实现。
  - `hide-client-entry`：前端入口隐藏或降级提示。
  - `mark-planned-or-remove`：OpenAPI 标注未实现或从当前契约移除。
- 对前端已经暴露但后端缺失的入口，必须给用户明确错误提示，不能静默失败。
- 本阶段不强制引入 OpenAPI 生成器；只建立可审计清单和轻量检查入口。

#### 边界

- 不用文档承诺当前不可用能力。
- 不因为补清单而实现大体量文件存储或向量任务队列。
- 保留现有 `api.ts` 外部函数名，避免前端大范围改动。

#### 测试

- 增加轻量契约检查脚本或文档校验脚本：清单中的每个路径必须有决策。
- 对 `hide-client-entry` 的入口增加前端单元测试或 mock 测试，确认错误提示可见。
- 对 `implement-now` 的路径增加后端测试或 smoke test。

#### 验收

- 每个已知漂移路径都有明确决策。
- 新增或更新后的契约清单能被评审者直接映射到代码文件。
- 不再出现“前端调用失败但没有文档记录”的已知路径。

### 4. NotesService 拆分

#### 实现清单

- 新增 `NoteAccessService`：
  - 负责 ObjectId 校验。
  - 负责构建 own/ACL/public 读取条件。
  - 负责构建 owner/editor 写入条件。
  - 负责 owner 判定和 ACL owner 判定。
- 迁移 `findOne/update/remove/getAcl/addCollaborator/updateCollaboratorRole/removeCollaborator/lockNote/unlockNote` 中重复权限判断，Controller 不变。
- 新增 `NoteCounterService`：
  - 负责 `categoryId/categoryIds/tags` 的增量计算。
  - 负责 create/update/delete 后的分类与标签计数同步。
  - 更新笔记 tags 时补齐 tag count 增减。
- `NotesService` 保留搜索、推荐、AI 摘要、embedding、缓存逻辑，避免一次性大拆。
- 修复 `remove` 中 ACL owner 前置允许但 `deleteOne` 只按 `userId` 删除的不一致：删除权限与实际删除条件必须一致。
- 对非法 ID 返回 400。

#### 边界

- 不改变 `/api/notes` 路由、DTO 字段、前端调用方式。
- 不改变列表缓存 key 的字段含义。
- 不在本阶段重写推荐算法、语义搜索、embedding 生成。
- 计数同步失败不能让主数据处于不可恢复状态；至少提供可重算入口或明确补偿策略。

#### 测试

- `NoteAccessService` 单元测试：
  - owner 可读写。
  - editor 可写但不能做 owner-only 操作。
  - viewer 可读不可写。
  - public 可读不可写。
  - 非法 ID 返回 400。
- `NoteCounterService` 单元测试：
  - create 增加分类和标签计数。
  - update categoryIds 增减正确。
  - update tags 增减正确。
  - delete 回滚分类和标签计数。
- `NotesService` 回归测试：
  - `findAll` 访问范围不扩大。
  - `remove` 对 ACL owner 的行为与设计一致。
  - 缓存命中不绕过权限。

#### 验收

- `NotesService` 行为保持兼容，职责减少。
- 标签计数在笔记更新时正确变化。
- 非法 ID 不再产生 500。
- 相关后端测试或 smoke test 通过。

## 测试矩阵

| 范围 | 正向 | 权限失败 | 非法输入 | 缺依赖/降级 | 并发/清理 |
| --- | --- | --- | --- | --- | --- |
| 协作鉴权 | token 有效连接成功 | token 缺失/过期不重连风暴 | YWS URL 非法时降级 | 无 YWS URL 进入本地模式 | 卸载释放 provider |
| Board/Mindmap | owner 可读写 | 他人资源不可读写 | 非法 ObjectId 返回 400 | 前端 403 不自动创建 | 同 ID 创建不能覆盖 |
| API 契约 | 已实现路径有记录 | 缺失路径有决策 | 清单路径格式可校验 | 未实现入口有提示 | 清单检查可重复运行 |
| NotesService | owner/editor 行为正确 | viewer/public 写入失败 | 非法 ID 返回 400 | 计数失败有补偿策略 | 更新/删除计数一致 |

## 验证命令

按最终改动范围运行：

```bash
cd notes-frontend
npm run type-check
npm run lint
npm run ci:test
```

```bash
cd notes-backend
npm run build
```

后端当前没有测试脚本。本阶段实现时应补充后端测试入口；如果受依赖限制无法补齐，必须至少运行 `npm run build` 和针对关键接口的 smoke test，并在实现总结中说明未覆盖范围。

## 回滚策略

- 协作鉴权：可回滚前端 token params 注入；服务端保留 `YWS_AUTH_DISABLED=1` 作为紧急开关，但生产不应长期依赖。
- Board/Mindmap 权限：如误伤正常访问，优先修查询条件，不回退到按 ID 裸查。
- API 契约清单：文档和检查脚本可独立回滚，不影响运行时。
- NotesService 拆分：保持 Controller 不变，若拆分引入风险，可把调用委托回原逻辑，但保留测试用例。

## 交付物

1. 协作鉴权修复与测试。
2. Board/Mindmap 权限修复与测试。
3. API 契约差异清单与轻量校验。
4. `NoteAccessService`、`NoteCounterService` 初步拆分与回归测试。
5. 更新后的验证记录，包含通过命令和未验证风险。

## 非目标

- 不实现完整文件资产系统。
- 不实现完整 embeds 服务。
- 不实现完整 drafts/vector/network 后端功能。
- 不重写搜索/推荐算法。
- 不做大规模 UI 重设计。
- 不把 `.DS_Store`、`__pycache__`、`.pyc` 这类系统或缓存文件纳入 skills 提交。
