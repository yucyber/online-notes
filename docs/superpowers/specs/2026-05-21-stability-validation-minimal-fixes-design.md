# 稳定性改动最小验收修复设计

**目标：** 用最小改动清掉当前稳定性改动的验收阻塞点，不扩大到测试体系迁移、全项目 lint 治理或额外业务重构。

**范围：** 只处理前端聚焦测试失败、附件暂不可用时的用户反馈、根目录依赖边界、`git diff --check` 格式失败。

---

## 背景

当前稳定性改动的主线已经基本成立：后端权限测试通过，后端构建通过，前端类型检查通过，API drift 检查通过，协作鉴权聚焦测试通过。

剩余问题集中在验收和体验收尾：

1. `search.console` 测试里的 `next/navigation` mock 没包含 `usePathname`，测试环境和真实组件使用方式不一致。
2. `editor.markdown` 测试直接加载 `react-markdown` 等 ESM 依赖，当前 Jest 配置无法解析。
3. `assetsAPI.uploadBase64` 已改为明确返回“暂不可用”，但两个附件入口的失败发生在 `FileReader.onload` 异步回调里，外层 `try/catch` 接不住，用户看不到明确反馈。
4. 根 `package.json` 仍保留子项目依赖，和“根只加 API drift 检查脚本”的边界不一致。
5. 两个 skill 文档存在尾随空格，导致 `git diff --check` 失败。

---

## 设计原则

- **最小改动：** 只修验收阻塞点，不迁移 Jest，不重写测试体系。
- **不改变业务主线：** 不改 Board/Mindmap 权限策略，不改 WebSocket 鉴权逻辑。
- **测试层隔离：** 对 Markdown 的 ESM 依赖问题优先在测试文件中 mock，避免为一个聚焦测试改全局 Jest 配置。
- **用户可见失败：** 附件不可用时要给明确提示，不能静默失败或变成未捕获异常。
- **依赖边界清楚：** 根目录只保留 monorepo 级脚本，不承载前端/后端运行依赖。

---

## 修复设计

### 1. 搜索测试补齐 mock

在 `notes-frontend/__tests__/search.console.spec.tsx` 的 `next/navigation` mock 中补 `usePathname`。

预期效果：

- `NotesPage` 渲染时不再因为 `usePathname` 缺失崩溃。
- 不改变真实业务代码。

### 2. Markdown 测试 mock ESM 渲染依赖

在 `notes-frontend/__tests__/editor.markdown.spec.tsx` 中 mock 掉当前测试不关心的 Markdown 渲染依赖，例如：

- `react-markdown`
- `rehype-raw`
- `rehype-sanitize`
- `react-syntax-highlighter`

预期效果：

- 测试继续覆盖“输入和快捷保存”这个行为。
- 不为了一个测试调整整个 Jest ESM 配置。

### 3. 附件入口补异步错误处理

在两个附件入口里，把真正执行 `await assetsAPI.uploadBase64(...)` 的 `FileReader.onload` 内部包上 `try/catch`。

涉及位置：

- 笔记详情包装页的附件入口。
- 笔记编辑页的附件入口。

失败时使用明确提示，例如 `alert('附件上传暂不可用')`。这是最小修复；后续如果要做更好的 toast/inline error，可以另开 UI 体验任务。

预期效果：

- 后端未实现 assets 时，用户能看到明确提示。
- 不再产生未捕获的 Promise rejection。

### 4. 根依赖清理

根 `package.json` 只保留：

- `scripts.check:api-contract`

移除根目录中不属于 monorepo 根的依赖：

- `ts-node`
- `@types/ws`
- `ws`
- `y-websocket`
- `yjs`

这些依赖如果子项目需要，应继续留在对应子项目中；本修复不动 `notes-frontend/package.json` 和 `notes-backend/package.json`。

### 5. 清理尾随空格

清理以下文件中导致 `git diff --check` 失败的尾随空格：

- `.agents/skills/webapp-testing/SKILL.md`
- `.claude/skills/webapp-testing/SKILL.md`

不改动这些 skill 文档的内容语义。

---

## 验收标准

必须通过：

```bash
npm run check:api-contract
```

```bash
cd notes-backend
npm run test:unit
npm run build
```

```bash
cd notes-frontend
npm run type-check
./node_modules/.bin/jest __tests__/editor.tiptap.auth.spec.tsx --runInBand --coverage=false
./node_modules/.bin/jest __tests__/editor.tiptap.spec.tsx __tests__/editor.markdown.spec.tsx __tests__/search.console.spec.tsx --runInBand --coverage=false
```

```bash
git diff --check 54a9430..HEAD
```

可选补充：

- 如果本地前后端能正常启动，用 Chrome/Codex 插件打开页面做一次 smoke test。
- smoke test 只作为补充，不替代自动化验收。

---

## 不做事项

- 不迁移 Jest 到 Vitest。
- 不配置全局 Jest ESM 转译。
- 不清理全项目 lint warning。
- 不调整 Board/Mindmap 权限策略。
- 不调整 WebSocket 鉴权策略。
- 不扩展 OpenAPI 内容。

---

## 风险与应对

- **Markdown mock 过浅：** 当前测试只验证输入与保存，不验证 Markdown 渲染，所以 mock 是合理的。若后续要测渲染，再单独设计 ESM 支持或浏览器测试。
- **`alert` 体验一般：** 这是最小可见反馈。后续可以统一换成 toast，但不放进本次验收修复。
- **根依赖清理影响未知脚本：** 当前根目录只需要 API drift 检查脚本。清理前后用验收命令确认没有依赖根包的行为。

---

## 自检

- 无 TBD/TODO。
- 范围只覆盖当前验收阻塞点。
- 每个问题都有对应修复和验收命令。
- 未引入测试框架迁移或额外业务重构。
