# 编辑器简洁界面全量验收报告

- 验收日期：2026-08-11
- 原产品基线：`73e2caf0685239276da7344c9f4b27427d9d6119`
- Task 7 / fix base：`53bfbbfedf6fd787823269ad4a760a79116a5053`
- Fix round 1：`a28b6013ba1a6ad29573d31cd83327c804ab22f7`
- Fix round 2 代码与测试 HEAD：`1f08d1618f6a34e6e972dea896af3d2c33f62d57`
- Fix round 2 浏览器证据 SHA：`de174cc387c76e48a61c5f8abbb445e7031e438c`
- 结论：`DONE_WITH_CONCERNS`

本报告的元数据提交 B 直接以浏览器证据提交 `de174cc387c76e48a61c5f8abbb445e7031e438c` 为 parent。B 无法在自身内容中记录自身 SHA；交付时以 `git log -1 --format=%H` 取得，并用 `git show -s --format=%P HEAD` 核对其 parent。该自引用限制不影响代码/测试 SHA 与浏览器证据 SHA 的精确追溯。

## 自动化验证

### Fix round 2 RED / GREEN

| 阶段 | 命令与结果 | Exit code |
| --- | --- | ---: |
| RED | `npx jest --runInBand __tests__/editor.tiptap.auth.spec.tsx __tests__/responsive-editor-ui.spec.tsx __tests__/editor-css-contract.spec.ts`：401/4401/1008 后的通用 `disconnected` 均覆盖鉴权终态；初版 CSS AST helper 另有一次 selector 匹配歧义 | 1 |
| GREEN | `npx jest --runInBand --coverage=false __tests__/editor.tiptap.auth.spec.tsx __tests__/responsive-editor-ui.spec.tsx __tests__/editor-css-contract.spec.ts`：3 suites / 20 tests | 0 |

round 2 新增/补强的回归：

- 组件测试读取实际 inline CSS vars，逐段断言 `left 280px → 52px → 280px`、`right 240px → 52px → 240px`；左恢复使用 Enter，右恢复使用 Space。
- 同一组件测试检查真实产品 CSS 的三轨 `minmax(0, 1fr)` 与 `.editor-layout-main { min-width: 0 }` 契约，不再用固定视口减法代替正文轨道证据。
- CSS contract 测试直接解析 `src/styles/editor-tokens.css` 与 `src/app/globals.css`，覆盖 1023px 单列、侧栏 overlay、正文/toolbar overflow，以及 reduced-motion 对普通元素和 pseudo-elements 的覆盖。
- 鉴权 401、close 4401、close 1008 均保持 `auth-failed`；随后通用 `status: disconnected` 不再显示普通网络断线 Toast。普通网络断线仍有固定 id、“重新连接”action 和连接成功 dismiss。

### Focused 与质量门禁

brief 中的 `npm.cmd test -- ...` 仍因 `package.json` 没有 `test` script 而 exit 1。最终实际执行的完整 focused 命令为：

```powershell
npm.cmd exec -- jest --runInBand --coverage=false --silent __tests__/app-toast.spec.tsx __tests__/editor-auto-save.spec.tsx __tests__/editor-layout-preferences.spec.tsx __tests__/editor-unified-input.spec.tsx __tests__/responsive-editor-ui.spec.tsx __tests__/readonly-controls.spec.tsx __tests__/editor.tiptap.spec.tsx __tests__/editor.tiptap.auth.spec.tsx __tests__/editor.markdown.spec.tsx __tests__/ai-chat-window.spec.tsx __tests__/editor-css-contract.spec.ts
```

| 命令 | 结果 | Exit code |
| --- | --- | ---: |
| 上述完整 focused 命令 | 11 suites / 98 tests | 0 |
| `npm.cmd run lint` | 0 errors、2 warnings | 0 |
| `npm.cmd run type-check` | 通过 | 0 |
| `npm.cmd run ci:test` | 19 suites / 118 tests；coverage threshold 通过 | 0 |
| `npm.cmd run build` | Next.js 16.0.10 生产构建通过 | 0 |

`ci:test` coverage：Statements 38.38%、Branches 27.01%、Functions 27.11%、Lines 41.25%。现有 ts-jest、浏览器数据陈旧提示及测试预期日志不影响退出码。lint 保留的 2 个 warning 是：

- `src/components/editor/useEditorAutoSave.ts:173`：Hook dependency `snapshot`
- `src/components/ui/AppToaster.tsx:16`：参数 `tone` 未使用

## 浏览器验收

环境：Chromium / agent-browser 0.27.0；既有验收时前端为 `localhost:3000`、后端为 `localhost:3001`。Fix round 2 遵照指示没有重启服务或浏览器；以下数值来自 Fix round 1 已保存的脱敏会话证据。精确命令、selector、操作顺序和动态输出见 [browser-transcript.md](assets/2026-08-11-editor-calm-minimal-ui/browser-transcript.md)。

| 视口 / 角色 | 操作与 selector | 实测结果 | 状态 |
| --- | --- | --- | --- |
| 1440×900 / writer | `.ProseMirror` 输入，清空并读取 network requests | 防抖窗口内笔记 PUT count = 1，HTTP 200；显示“已自动保存” | PASS |
| 1440×900 / writer | 收起双栏；`[aria-label="展开左侧导航"]` Enter；`[aria-label="展开右侧面板"]` Space | 展开 `280px 558px 240px`、双折叠 `52px 974px 52px`；main rect width 558→974；Enter 后 `280px 746px 52px`，Space 后恢复 | PASS |
| 1440×900 / writer | offline 输入后恢复网络 | 离线 0 requests 且显示“已保存到本地”；恢复后 PUT count = 1、HTTP 200 | PASS |
| 1440×900 / viewer | 派发 setContent/save 并按 Ctrl+S | `.ProseMirror[contenteditable="false"]`，probe=false，25/27 buttons disabled，写请求 count = 0 | PASS |
| 960×900 / writer | 设置真实 viewport 后读取 document、grid、main、toolbar、tools、paper rect | document scroll/client 952/952；grid/main/toolbar width 854、left/right 49/903；paper 83/869/786；tools scroll/client 592/546，仅工具区局部滚动；右栏默认 collapsed | PASS |
| 960×900 / writer | `set media light reduced-motion` 后读取 computed transition | media 命中；left/right/tooltip 均为 `0s` | PASS |
| 1440×900 / writer | reload 后检查标题、列表、引用、代码、链接、表格 | 结构与内容仍存在 | PASS |
| 1440×900 / writer | y-websocket 断线→重连 | 自动化状态机通过；既有浏览器环境缺少可信断线→重连链路 | UNVERIFIED |
| 1440×900 / writer | AI 请求失败与“重试生成” | Jest action 回归通过；未取得可信浏览器失败注入 | UNVERIFIED |

### 截图资产

三张截图均只保留编辑器主体，已在 round 2 再次逐张目视检查，不含登录信息或请求机密：

- `assets/2026-08-11-editor-calm-minimal-ui/writer-responsive-960-redacted.png`
- `assets/2026-08-11-editor-calm-minimal-ui/writer-collapsed-saved-1440-redacted.png`
- `assets/2026-08-11-editor-calm-minimal-ui/viewer-readonly-1440-redacted.png`

## 剩余未验证项

- 浏览器层 y-websocket 真实断线、统一 Toast action 与成功 dismiss 的完整链路。
- 浏览器层 AI 真实失败注入与“重试生成”。
- 保存请求真实失败时，同类 Toast 去重和“重新保存”重试。
- 两个浏览器同时在线的实时内容同步。
- 移动真机；已有证据仅覆盖桌面 Chromium 1440×900 与真实 960×900 viewport。

## 结论

响应式轨道、真实 CSS contract 和鉴权终态均有自动化回归；focused、lint、type-check、ci:test、build 全部 exit 0。真实 960 几何、writer 保存/离线恢复和 viewer 零写请求沿用已脱敏的既有浏览器证据。协作断线重连与 AI 失败没有完整浏览器链路，因此结论保持 `DONE_WITH_CONCERNS`，未验证项未写成通过。
