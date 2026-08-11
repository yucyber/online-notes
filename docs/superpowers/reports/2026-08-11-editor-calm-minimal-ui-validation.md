# 编辑器简洁界面全量验收报告

- 验收日期：2026-08-11
- 验收基线：`73e2caf0685239276da7344c9f4b27427d9d6119`
- 验收结论：`DONE_WITH_CONCERNS`
- 说明：本报告与 Task 7 测试处于同一提交，因此用上述父提交作为被验收产品代码的精确 SHA；Task 7 提交可用 `git log -1 --format=%H` 获取。

## 自动化回归

先临时移除新增断言依赖的产品行为，确认 2 个 suite 中有 3 个测试按预期失败；恢复产品行为后再执行 GREEN。临时变更未保留，Task 1–6 产品代码未修改。

| 阶段 | 命令 | 结果 | Exit code |
| --- | --- | --- | ---: |
| RED | 临时变异后执行 `npm.cmd exec -- jest --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx __tests__/editor.tiptap.spec.tsx` | 2 suites 中 3 failed、40 passed，共 43 tests | 1 |
| GREEN | `npm.cmd exec -- jest --runInBand --coverage=false __tests__/responsive-editor-ui.spec.tsx __tests__/editor.tiptap.spec.tsx` | 2 suites、43 tests 全部通过 | 0 |
| brief 原命令 | `npm.cmd test -- --runInBand --coverage=false ...`（8 个指定文件） | 未执行测试；`package.json` 不存在 `test` script | 1 |
| focused 等价命令 | `npm.cmd exec -- jest --runInBand --coverage=false`（8 个指定文件） | 8 suites、87 tests 全部通过 | 0 |
| lint | `npm.cmd run lint` | 6 errors、2 warnings | 1 |
| type-check | `npm.cmd run type-check` | 通过 | 0 |
| ci:test | `npm.cmd run ci:test` | 17 suites、112 tests 全部通过；全局 coverage threshold 通过 | 0 |
| build | `npm.cmd run build` | Next.js 生产构建通过 | 0 |

`ci:test` coverage：Statements 36.57%、Branches 25.40%、Functions 25.47%、Lines 39.20%。测试输出还包含现有的 ts-jest、React `act`、IndexedDB/协作 mock 日志，不影响 Jest 退出码。

末轮复验时，首次 focused 执行曾出现 `editor.tiptap.spec.tsx` 单个瞬时失败（7 suites / 86 tests 通过，exit 1）；该文件隔离重跑为 33/33，通过后相同 8-suite 命令再次重跑为 87/87、exit 0。未修改产品代码或测试来掩盖该波动。

lint 的 6 个错误均为 `@typescript-eslint/no-require-imports`：

- `__tests__/editor-layout-preferences.spec.tsx`：第 5、7 行
- `__tests__/editor.markdown.spec.tsx`：第 2、3、4 行
- `src/components/editor/useTiptapEditorBridge.ts`：第 99 行

另有 2 个 warning：`src/components/editor/useEditorAutoSave.ts` 第 173 行的 Hook dependency，以及 `src/components/ui/AppToaster.tsx` 第 16 行未使用的 `tone`。这些均不在 Task 7 允许修改的文件范围内。

## 浏览器验收

环境：Chromium（agent-browser 0.27.0），本地前端 `localhost:3000`、后端 `localhost:3001`、y-websocket `localhost:1234`。账号只从仓库外的 `account-test` 文件读取，报告不记录凭据。两个账号使用隔离会话。

| 视口 | 账号角色 | 场景 | 结果 | 证据摘要 |
| --- | --- | --- | --- | --- |
| 1440×900 | 可写用户 | 左栏拖拽、左右面板收起/恢复、刷新持久化 | PASS | 左栏由 280px 拖到 340px；双栏折叠为 52px/52px，正文宽度由 498px 扩到 974px；刷新后保持，恢复按钮可聚焦并以 Enter 操作 |
| 1440×900 | 可写用户 | 防抖自动保存 | PASS | 连续输入仅产生 1 次 `PUT`，响应 200，界面显示“已自动保存” |
| 1440×900 | 可写用户 | 离线编辑与恢复保存 | PASS | 离线输入时显示“已保存到本地”且无 `PUT`；恢复网络后产生 1 次 `PUT` 并显示“已自动保存” |
| 1440×900 | 可写用户 | Toast 与 AI 入口不重叠 | PASS | Toast 位于右上（top 16、bottom 72），AI 入口位于右下（top 820、bottom 876），矩形不相交 |
| 960×900 | 可写用户 | 正文宽度、tooltip 边界、水平溢出 | FAIL | 页面无 document 级横向滚动，但 layout columns 为 `340px 514px`；正文与左栏重叠且 paper/toolbar 被 `overflow:hidden` 裁切，评论/协作 tooltip anchor 位于视口右边界之外 |
| 960×900 | 可写用户 | `prefers-reduced-motion` | PASS | media query 命中；左右面板与 tooltip 的 transition duration 为 `0s`，animation 为 `none` |
| 1440×900 | 可写用户 | y-websocket 不可用降级 | FAIL | 停止服务并刷新后持续显示“连接中”，未显示离线编辑状态；无带“重新连接”文案的统一 Toast action。验收后已恢复服务 |
| 1440×900 | 可写用户 | AI 请求失败 | FAIL | 离线请求只显示 ChatWindow 内英文错误，未产生统一错误 Toast，也没有“重试生成”action |
| 1440×900 | 只读协作者 | 全部写入口与 Network | PASS | 正文/标题不可编辑，属性、标签、工具栏写操作、保存和评论入口禁用；注入编辑/保存事件及 Ctrl+S 后内容不变，写请求为 0 |
| 1440×900 | 可写用户 | Markdown 富文本输入、粘贴与刷新 | PASS | 标题、列表、引用、代码块、链接、表格均呈现；自动保存后刷新结构与内容保留 |

## 发现的问题

1. 约 960px 视口下，三栏仍使用桌面列宽，正文与左栏重叠，工具栏及 tooltip anchor 被右侧裁切。这是本次验收发现的产品 bug。
2. y-websocket 不可用时，状态长期停留在“连接中”，没有明确离线降级，也没有统一 Toast 的“重新连接”操作。
3. AI 请求失败使用 ChatWindow 内联英文错误，没有复用统一 Toast，也没有“重试生成”操作。
4. 全局 lint 因 6 个既有 `require` 错误退出 1；Task 7 未越权修改这些文件。
5. brief 指定的 `npm.cmd test` 无法运行，因为前端未定义 `test` script；已用等价 Jest 命令完成 focused 验收。

## 未验证项

- 保存请求真实失败时，同类错误 Toast 去重及“重新保存”重试。请求拦截未能稳定制造失败，因此不写为通过。
- 两个浏览器同时在线时的实时协作同步。y-websocket 服务已实际启动并做不可用场景，但未完成可靠的双端同步断言。
- 移动真机检查。本次仅使用桌面 Chromium 的 1440×900 和 960×900 模拟视口。

鉴于新增回归、type-check、全量 Jest 与 build 均通过，但 lint 未通过且浏览器验收发现 3 项产品问题，本任务结论为 `DONE_WITH_CONCERNS`，不将未执行或不可靠的检查记为通过。
