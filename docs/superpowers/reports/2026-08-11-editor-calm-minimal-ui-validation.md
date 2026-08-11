# 编辑器简洁界面全量验收报告

- 验收日期：2026-08-11
- 产品基线 SHA：`73e2caf0685239276da7344c9f4b27427d9d6119`
- Fix round 1 起始 HEAD SHA：`53bfbbfedf6fd787823269ad4a760a79116a5053`
- 验收对象：上述 HEAD 叠加本报告同提交中的 Fix round 1 产品、测试与证据变更
- 结论：`DONE_WITH_CONCERNS`

报告无法在自身提交内容中稳定写入最终提交 SHA；最终交付 HEAD 以 `git log -1 --format=%H` 为准。上述 baseline 与起始 HEAD 均为验收时实际读取值。

## 自动化验证

### RED / GREEN

| 阶段 | 命令与结果 | Exit code |
| --- | --- | ---: |
| RED（键盘、协作） | `npm.cmd exec -- jest --runInBand --coverage=false --silent __tests__/responsive-editor-ui.spec.tsx __tests__/editor.tiptap.auth.spec.tsx __tests__/ai-chat-window.spec.tsx`：响应式与协作两个新增行为断言按预期失败；AI suite 首次因测试环境未 mock ESM `react-markdown` 而未进入行为断言 | 1 |
| RED（AI 行为） | 补齐测试环境后执行 `npm.cmd exec -- jest --runInBand --coverage=false --silent __tests__/ai-chat-window.spec.tsx`：因仍显示英文内联错误、没有统一 Toast 而 1 test failed | 1 |
| GREEN | `npm.cmd exec -- jest --runInBand --coverage=false --silent __tests__/responsive-editor-ui.spec.tsx __tests__/editor.tiptap.auth.spec.tsx __tests__/ai-chat-window.spec.tsx`：3 suites / 16 tests 全部通过 | 0 |

新增回归验证：左恢复按钮用 Enter、右恢复按钮用 Space，并分别断言轨道恢复；协作断线只产生一个固定 id Toast，action 为“重新连接”，连接成功 dismiss；AI 失败保留中文 inline error，并从统一 Toast 的“重试生成”action 重试原请求。已移除把 JSDOM computed style 当作真实溢出证明的测试。

### Focused 与质量门禁

brief 原命令仍不能运行：

```powershell
npm.cmd test -- --runInBand --coverage=false __tests__/app-toast.spec.tsx __tests__/editor-auto-save.spec.tsx __tests__/editor-layout-preferences.spec.tsx __tests__/editor-unified-input.spec.tsx __tests__/responsive-editor-ui.spec.tsx __tests__/readonly-controls.spec.tsx __tests__/editor.tiptap.spec.tsx __tests__/editor.tiptap.auth.spec.tsx
```

结果：`package.json` 没有 `test` script，exit 1。实际使用的完整 focused 等价命令为：

```powershell
npm.cmd exec -- jest --runInBand --coverage=false --silent __tests__/app-toast.spec.tsx __tests__/editor-auto-save.spec.tsx __tests__/editor-layout-preferences.spec.tsx __tests__/editor-unified-input.spec.tsx __tests__/responsive-editor-ui.spec.tsx __tests__/readonly-controls.spec.tsx __tests__/editor.tiptap.spec.tsx __tests__/editor.tiptap.auth.spec.tsx __tests__/editor.markdown.spec.tsx __tests__/ai-chat-window.spec.tsx
```

| 命令 | 结果 | Exit code |
| --- | --- | ---: |
| 上述完整 focused 命令 | 10 suites / 93 tests 全部通过 | 0 |
| `npm.cmd run lint` | 0 errors、2 warnings | 0 |
| `npm.cmd run type-check` | 通过 | 0 |
| `npm.cmd run ci:test` | 18 suites / 113 tests 全部通过，coverage threshold 通过 | 0 |
| `npm.cmd run build` | Next.js 16.0.10 生产构建通过 | 0 |

`ci:test` coverage：Statements 38.18%、Branches 26.51%、Functions 26.97%、Lines 41.02%。现有 ts-jest、React `act`、IndexedDB/协作 mock 日志不影响退出码。

原先 6 个 `@typescript-eslint/no-require-imports` error 已通过等价 ESM import 清零。保留的 2 个 warning 是：

- `src/components/editor/useEditorAutoSave.ts:173`：Hook dependency `snapshot`
- `src/components/ui/AppToaster.tsx:16`：参数 `tone` 未使用

## 浏览器验收

环境：Chromium / agent-browser 0.27.0；前端 `localhost:3000`、后端 `localhost:3001`。两个账号只从仓库外 `account-test` 读取并使用隔离会话；报告和提交不记录账号或凭据。

### 操作与实测证据

| 视口 / 角色 | 操作与 selector | 实测结果 | 状态 |
| --- | --- | --- | --- |
| 1440×900 / writer | 聚焦 `.ProseMirror`，`Control+End` 后输入；清空并读取 browser network requests | 防抖窗口内恰好 1 个笔记 `PUT`，HTTP 200；页面包含“已自动保存” | PASS |
| 1440×900 / writer | 收起两栏；聚焦 `[aria-label="展开左侧导航"]` 后 Enter，聚焦 `[aria-label="展开右侧面板"]` 后 Space | 展开轨道 `280px 558px 240px`；双栏折叠 `52px 974px 52px`；Enter 后 `280px 746px 52px`；Space 后恢复 `280px 558px 240px`，localStorage 同步 | PASS |
| 1440×900 / writer | `set offline true` 后向 `.ProseMirror` 输入，再 `set offline false` | 离线时 `navigator.onLine=false`、显示“已保存到本地”、0 requests；恢复后显示“已自动保存”，恰好 1 个笔记 `PUT`，HTTP 200 | PASS |
| 1440×900 / viewer | 清空 network；派发 `editor:setContent`、`tiptap:exec save`，再按 Ctrl+S | `.ProseMirror[contenteditable="false"]`；probe 未写入；toolbar 25/27 buttons disabled；0 requests | PASS |
| 960×900 / writer | `set viewport 960 900`、清空布局偏好、reload；读取 `.editor-layout-grid`、`.editor-layout-main`、`.editor-toolbar`、`.editor-toolbar__tools`、`.editor-paper` rect 与 document scroll | document scroll/client `952/952`；grid/main/toolbar 均宽 854，left/right `49/903`；paper left/right/width `83/869/786`；tools scroll/client `592/546`，仅工具区局部滚动；tooltip anchors 为评论 `777–809`、协作 `813–845`；右栏默认 collapsed | PASS |
| 960×900 / writer | `set media light reduced-motion`；读取左右栏与 `.editor-tooltip::after` transition duration | media query 命中，left/right/tooltip 均为 `0s` | PASS |
| 1440×900 / writer | 原有 Markdown 标题、列表、引用、代码、链接、表格在 reload 后检查 | 富文本结构与内容仍存在 | PASS |
| 1440×900 / writer | y-websocket 断线→重连 | 自动化状态机测试通过；浏览器首次启动的 worktree 前端没有注入既有 `NEXT_PUBLIC_YWS_URL`，只得到“协作配置缺失”，未形成可信断线→重连链路 | UNVERIFIED |
| 1440×900 / writer | AI 请求失败与“重试生成” | Jest action 回归通过；本轮浏览器收尾前未完成可信失败注入 | UNVERIFIED |

### 截图资产

截图均仅保留编辑器主体，机械裁去顶部 96px 账号导航区；已逐张目视检查，不含账号、密码、token、Cookie 或 Authorization。

- `assets/2026-08-11-editor-calm-minimal-ui/writer-responsive-960-redacted.png`：960px 修复后 layout、paper、toolbar 与局部工具栏滚动
- `assets/2026-08-11-editor-calm-minimal-ui/writer-collapsed-saved-1440-redacted.png`：writer 折叠轨道与“已自动保存”
- `assets/2026-08-11-editor-calm-minimal-ui/viewer-readonly-1440-redacted.png`：viewer 查看模式、禁用工具栏与只读正文

## 剩余未验证项

- 浏览器层 y-websocket 真实断线、固定 id Toast、“重新连接”action 与成功 dismiss 的完整链路；自动化状态机回归已覆盖，但不替代浏览器结论。
- 浏览器层 AI 真实失败注入与“重试生成”；自动化 action 回归已覆盖。
- 保存请求真实失败时，同类保存 Toast 去重和“重新保存”重试。
- 两个浏览器同时在线的实时内容同步。
- 移动真机；本轮只有桌面 Chromium 1440×900 与真实 960×900 viewport。

## 结论

960 裁切、键盘恢复、协作断线状态机、AI 失败 Toast 和 6 个 lint error 均已在代码与自动化层修复；真实 960 几何、writer 保存/离线恢复和 viewer 零写请求通过。由于协作断线重连和 AI 失败未取得完整浏览器链路，结论保持 `DONE_WITH_CONCERNS`，未验证项没有写成通过。
