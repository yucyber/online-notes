# 本地 staging 验收问题修复计划

> 状态：已执行，最终验收完成；在线 presence 展示保留为未完全验证项。

## 目标与边界

只修复本次本地验收暴露的五类问题：协作抽屉重复请求、AI 助手 500、AI 润色/摘要插入 envelope、YWS 本地配置缺失，以及开发者工具打开后的可复现布局问题。不扩展 AI 功能、不重做协作架构，也不处理无关告警。

## Task 1：建立干净且可复现的本地基线

- [ ] 从已合并的最新 `master` 创建 `fix-修复本地验收问题-20260810`。
- [ ] 停止遗留进程，重新构建 backend/frontend，并以同一组环境变量启动 frontend、backend、y-websocket。
- [ ] 本地 frontend 明确配置 `NEXT_PUBLIC_API_URL=http://localhost:3001/api` 与 `NEXT_PUBLIC_YWS_URL=ws://localhost:1234`；只提交 `.env.example`/启动说明，不提交密钥或个人 `.env`。
- [ ] 用两组一次性账号复现并记录 5 类问题；确认 AI 助手 500 是否在干净构建后仍存在。

## Task 2：收敛 ACL 请求

- [ ] 先补 `CollaboratorsPanel` 回归测试：挂载时各加载一次、邀请成功/手动刷新后加载、页面重新可见时加载；静置期间不按 5 秒持续轮询。
- [ ] 移除固定 5 秒轮询，保留显式刷新与可见性刷新；避免并发重复加载。
- [ ] 浏览器 Network 验证同一 noteId 不再持续产生 ACL/邀请请求。

## Task 3：修复 AI writer 响应解包

- [ ] 为 `/api/ai/writer` 代理和 `streamAIWriter` 补测试，覆盖纯文本流、普通 JSON envelope `{ data: { text } }`、错误 envelope 三种响应。
- [ ] 在代理边界根据响应 `Content-Type` 规范化输出，保证编辑器回调永远只接收生成文本，不把协议 envelope 写入正文。
- [ ] 验证续写、润色、摘要三种入口，摘要前缀只出现一次，正文中不包含 `code/requestId/timestamp`。

## Task 4：定位并修复 AI 助手 500

- [ ] 用现有 `check:ai-config:live` 与本地 `/api/ai/pet` 请求分别验证 provider 普通请求和 stream 请求，依据 requestId/后端日志确定失败边界。
- [ ] 若为陈旧构建，仅修正文档/启动流程并重建；若 provider 不兼容 SSE，则在 gateway 增加受控的非流式兼容路径，并保持前端收到纯文本。
- [ ] 补 backend gateway/controller 与 frontend `ChatWindow` 回归测试；错误时展示可读错误，不回显内部配置或密钥。

## Task 5：补齐本地协作配置并验证权限

- [ ] 在 frontend 环境示例和本地启动说明补 `NEXT_PUBLIC_YWS_URL`，明确该变量必须在 build/start 前提供。
- [ ] 保留“缺配置时本地降级”逻辑与现有回归测试，不用硬编码地址掩盖部署错误。
- [ ] 两账号验证 room-ticket、WebSocket 连接、在线协作者、editor 内容同步；未受邀账号仍不可访问私有笔记。

## Task 6：最小处理控制台打开后的 UI 问题

- [ ] 以用户截图中的约 680px 内容视口复现：左侧导航仍占 300px、顶部在线/API/重试/触发区域被压成单字竖排、标签清空按钮竖排、编辑器操作区与悬浮按钮拥挤。
- [ ] 窄视口自动收起或压缩左侧导航；顶部状态区允许折叠/换成紧凑图标，不允许中文逐字换行。
- [ ] 编辑器工具栏使用单行横向滚动或分组折叠；输入框与“清空标签”等操作改为可换行布局并设置合理的 `min-width`/`whitespace-nowrap`。
- [ ] 统一“重连/保存/触发”和右下角悬浮按钮的尺寸、圆角、图标与状态反馈；为纯圆点/加号按钮补明确图标、tooltip 与 aria-label。
- [ ] 只调整截图中可复现组件的 responsive 宽高、滚动和层级，不进行整体视觉改版。
- [ ] 验证常规桌面宽度与窄视口，确保控制台收窄页面时仍可操作。

## Task 7：全量验收与报告

- [ ] frontend：定向 Jest、全量 Jest、type-check、lint、build。
- [ ] backend：AI 定向测试、全量测试、build。
- [ ] 根目录：`check:api-contract`、`check:ai-config`；AI live 仅报告 provider 实测结果。
- [ ] 本地浏览器 smoke：注册/登录/退出、笔记创建与编辑、邀请/接受、ACL 请求数量、AI chat、AI 润色/摘要、YWS 双账号协作、窄视口 UI。
- [ ] 更新整改报告，记录已通过、未验证项和测试账号/测试数据清理限制；不把部分通过写成全部通过。

## 完成标准

1. 协作抽屉静置不再每 5 秒请求 ACL。
2. AI 润色、摘要和续写只插入模型文本。
3. AI 助手聊天在本地返回有效文本，或给出明确且不泄密的 provider 错误。
4. 正确配置后显示 WebSocket 已连接，可完成双账号实时同步。
5. 用户提供的控制台窄视口 UI 问题可复现项均修复。
6. 全量门禁通过，且无无关重构。

## 执行记录

- 已从 `origin/master` 创建 `fix-修复本地验收问题-20260810`，并保护用户已有的 `next-intl` package.json 改动。
- ACL：新增回归测试并移除 5 秒轮询；首次加载、手动刷新、页面重新可见刷新保留。
- AI writer：新增 JSON envelope/纯文本流测试；浏览器实测润色与摘要只写入模型文本。
- AI 助手：清理旧进程并重新 build 后，浏览器实测返回正常文本；原 500 判定为陈旧构建问题，未增加无必要的 provider fallback。
- YWS：`.env.local` 配置生效，并新增 `.env.example`；浏览器显示 `ws[on] sync[ok]`，第二账号接受 editor 邀请且独立 WebSocket 鉴权连接成功。在线 presence 未在页面显示，因此不标记为完全通过。
- UI：约 984px 视口下侧栏自动收起，按钮不再逐字换行；标签操作、抽屉、AI 面板和悬浮操作改为响应式布局与明确图标。
- 全量结果：frontend 10 suites/29 tests、type-check、lint、build；backend 85 tests、build；YWS 4 tests；OpenAPI 0 drift；AI dry-run 全通过。
- AI live：SenseNova、SiliconFlow embedding/reranker 通过；MiMo 返回 401，属于现有 reasoning provider 凭据问题，不在本次代码修复范围。
