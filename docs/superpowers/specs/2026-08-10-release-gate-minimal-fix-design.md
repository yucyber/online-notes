# 发布门禁最小修复设计 Spec

日期：2026-08-10

## 目标

修复当前可稳定复现的发布门禁失败，不改变协作鉴权业务流程，不扩展到覆盖率提升、结构重构或新功能开发。完成后，前端测试、API 契约检查以及现有项目验证命令应全部通过，并将真实验证结果同步到整改报告。

## 当前问题与根因

### 1. 协作鉴权测试与实现脱节

`useTiptapCollab` 已从用户 JWT 迁移为异步调用 `notesAPI.getRoomTicket(noteId)`，成功后再用短时 room ticket 创建 `WebsocketProvider`。现有 `editor.tiptap.auth.spec.tsx` 仍向 `localStorage` 写入 `notes_token`，并在首次 render 后同步断言 provider，因此 3 条旧测试失败。

这属于测试契约过期，不修改生产协作逻辑。测试应 mock `notesAPI.getRoomTicket`，等待异步 effect 完成，并验证 room ticket、获取失败降级和配置缺失等当前行为。

### 2. OpenAPI 未登记现有路由

后端已实现以下接口，但 `notes-backend/openapi.yaml` 尚未声明：

- `POST /api/auth/logout`
- `POST /api/notes/{id}/room-ticket`

因此 `npm run check:api-contract` 报告未登记的契约漂移。修复只补充契约文档，不改变 controller 或 service 行为。

## 设计决策

| 决策项 | 选择 | 理由 |
| --- | --- | --- |
| 协作测试边界 | mock `notesAPI.getRoomTicket`，保留真实 hook 时序 | 覆盖前端与 room-ticket API 的交互，同时避免依赖后端和网络 |
| 异步断言 | 使用 Testing Library `waitFor` | provider 只会在 ticket Promise 完成和 React effect 更新后创建 |
| 鉴权失败场景 | room-ticket 请求 reject 后断言 `auth-failed` UI 和不创建 provider | 对齐当前 HttpOnly Cookie 模型，不再模拟浏览器不可读的用户 JWT |
| OpenAPI 修改 | 直接登记两个现有接口及响应 schema | 契约以实际 controller/service 行为为准，不反向改业务实现 |
| 报告同步 | 记录本轮实际执行命令、通过数和未执行项 | 避免继续保留“待安装、待 shell 恢复”等失效状态 |

## 具体变更

### 协作鉴权测试

修改 `notes-frontend/__tests__/editor.tiptap.auth.spec.tsx`：

- mock `notesAPI.getRoomTicket`。
- 成功场景返回 `{ ticket: 'room-ticket', role: 'writer', expiresIn: 300 }`。
- 等待 provider 创建后，断言 `options.params.access_token` 等于 room ticket。
- 请求失败场景断言 provider 不创建，并显示鉴权失败状态。
- WebSocket URL 缺失场景继续断言 `协作配置缺失`。
- 删除 localStorage 用户 JWT、JWT 过期计时器等旧模型断言。

### OpenAPI 契约

修改 `notes-backend/openapi.yaml`：

- 登记 `POST /api/auth/logout`，成功响应沿用统一 `ApiEnvelope`，业务数据为 `{ message: string }`。
- 登记 `POST /api/notes/{id}/room-ticket`，声明 JWT/Cookie 鉴权、`id` 路径参数、成功响应以及 `Unauthorized`、`NotFound`。
- 新增 `RoomTicket` schema：
  - `ticket: string`
  - `role: writer | reader`
  - `expiresIn: integer`，单位秒
- 不把 ticket 示例写成真实密钥或可复用凭证。

### 验证和报告

按以下顺序执行：

1. 定向运行协作鉴权测试，确认修改前失败、修改后通过。
2. 运行根目录 API 契约和 AI 配置检查。
3. 运行后端 build 与 85 条现有单元测试。
4. 运行 y-websocket 测试。
5. 运行前端 type-check、lint、完整 Jest 和生产 build。
6. 更新 `docs/代码安全-重复逻辑-功能验收扫描报告-2026-08-07.md`，只记录实际取得的结果；外部 AI live 检查、依赖 audit 或浏览器 E2E 若未运行，明确标为未验证。

## 不在本次范围

- 提升前端总体测试覆盖率。
- 拆分 `NoteEditorShell` 或处理其他结构债。
- 新增 Playwright/browser E2E 基础设施。
- i18n 迁移。
- 修改 room-ticket 的签发、权限规则或有效期。
- 依赖升级及 audit 漏洞治理。

## 验收标准

- `editor.tiptap.auth.spec.tsx` 不再依赖 localStorage JWT，并覆盖 room-ticket 成功与失败路径。
- `npm run check:api-contract` 退出码为 0。
- 前端 type-check、lint、完整 Jest、生产 build 均退出码为 0。
- 后端 build、完整单元测试均退出码为 0。
- y-websocket 完整测试退出码为 0。
- 整改报告中的状态与本轮命令输出一致。
- 除测试、OpenAPI 契约和整改报告外，不修改生产业务代码。
