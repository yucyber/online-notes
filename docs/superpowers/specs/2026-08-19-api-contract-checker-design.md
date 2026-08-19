# API 契约检查器全量扫描设计

## 背景

当前 `scripts/check-api-contract.mjs` 只读取聚合文件 `notes-frontend/src/lib/api.ts`。该文件已经改为 re-export，真实请求分布在 `notes-frontend/src/lib/api/**/*.ts`，因此客户端契约集合实际为空。脚本同时只比较 path，不比较 HTTP method，也没有覆盖 Next.js 本地 `/api/*` 路由和代理目标。

本设计只修复检查器及其回归测试，不顺带修复扫描发现的接口漂移，也不调整业务 API。

## 目标

- 递归扫描 `notes-frontend/src/lib/api/**/*.ts` 中的领域 API 调用。
- 使用 `METHOD + normalized path` 作为所有 HTTP operation 的唯一契约键。
- 比较前端领域 API、NestJS Controller 与 OpenAPI operation。
- 校验前端对 Next 本地 API 的调用是否被 route 接受。
- 校验 Next 代理的后端目标是否同时存在于 NestJS Controller 和 OpenAPI。
- 对无法静态解析的第一方 API 调用显式失败，不再静默形成盲区。

## 非目标

- 本阶段不比较 query、request body 或 response schema。
- 不引入 TypeScript compiler、Babel 等新的解析依赖。
- 不把 Next 本地路径直接与 NestJS/OpenAPI 路径比较。
- 不把 `NEXT_PUBLIC_RUM_ENDPOINT` 等环境配置地址当作 Next 本地路由。
- 不修复 `/api/users/me`、logout 等现有契约漂移；检查器应准确报告它们。

## 契约模型

统一使用以下 operation 结构：

```text
METHOD /normalized/path
```

规则如下：

- method 转为大写，仅接受 `GET`、`POST`、`PUT`、`PATCH`、`DELETE`。
- 去除 query string。
- `${id}`、`{id}`、`:noteId`、Next `[id]` 统一为 `:id`。
- Next catch-all 参数 `[...path]` 不直接形成可调用 operation；由其静态 allowlist 展开为具体路径。
- 领域 API 中 `/v1/*` 保持现有规则，规范化为 `/api/v1/*`；其他 `/notes/*` 等相对后端路径加 `/api` 前缀。

Active Drift Registry 中的主键同步升级为完整 operation，例如 `PATCH /api/users/me`。只有 path、没有 method 的活跃登记不再有效。Planned/Discarded 表记录的是尚未形成可执行契约的候选 path，继续保持 path-only，并且只用于排除 OpenAPI 中不应出现的路径。

## 扫描边界

### 前端领域 API

递归读取 `notes-frontend/src/lib/api` 下全部 `.ts` 文件，识别当前仓库真实使用的调用形式：

- `api.get/post/put/patch/delete(path, ...)`
- `getTyped/postTyped/patchTyped(path, ...)`
- ``fetch(`${API_URL}/path`, { method })`` 等以本文件明确后端 base 常量开头的服务端直连调用

首个参数必须是可静态解析的字符串或模板字符串。模板插值统一为 `:id`。已知后端 base 标识符只作为 origin 前缀剥离，后续 path 仍参与比较。`client.ts` 中以 `url` 参数转发的通用 helper 本身不是 operation；调用这些 helper 的字面量参数才是 operation。`RUM_ENDPOINT` 等没有固定第一方 path 的环境地址不进入领域 API 集合。

扫描结果保留来源文件和行号，用于输出可定位的错误。

### NestJS Controller

递归扫描 `notes-backend/src/modules/**/*.controller.ts`，组合 `@Controller()` 前缀和 `@Get/@Post/@Put/@Patch/@Delete()` 路径，生成完整 operation。

### OpenAPI

直接解析 `notes-backend/openapi.yaml`，遍历 `paths` 下的 HTTP operation。不要再用只提取 path 的正则。`parameters`、`summary` 等非 HTTP key 不进入集合。

### Next 本地 API

扫描 `notes-frontend/src` 中显式以 `/api/` 开头的第一方调用，覆盖当前使用的：

- `fetch(path, { method })`，未声明 method 时按 `GET`；
- `axios.get/post/put/patch/delete(path, ...)`；
- `postAiJson(path, ...)`，按 `POST`。

递归扫描 `notes-frontend/src/app/api/**/route.ts`：

- 普通 route 由目录结构和导出的 `GET/POST/PUT/PATCH/DELETE` 生成 operation；
- `[id]` 等动态目录参数规范化为 `:id`；
- 当前 `/api/ai/[...path]` 从 route 内的静态 `STREAM_PATHS`、`JSON_PATHS` 展开 allowlist；
- `writer` 映射到后端 `POST /api/ai/writer/stream`，其余条目映射到对应 `POST /api/ai/<name>`；
- 前端 Next 调用必须存在于展开后的本地 operation 集合；代理目标必须同时存在于 Controller 和 OpenAPI。

Next 本地路径与后端目标是两层契约。例如 `POST /api/ai/writer` 只与 Next allowlist 比较；解析出的 `POST /api/ai/writer/stream` 再与 NestJS/OpenAPI 比较。

## 漂移计算

检查器分别计算：

1. 前端领域 operation 与后端 operation 的差异；
2. 后端 operation 与 OpenAPI operation 的差异；
3. 前端 Next 本地调用与 Next route operation 的差异；
4. Next 代理目标与后端/OpenAPI operation 的差异。

领域 API wrapper 并不要求覆盖所有后端 operation，因此“后端存在但前端无 wrapper”不是失败。失败项包括：

- 前端调用不存在的后端或 Next operation；
- 后端 operation 未写入 OpenAPI，或 OpenAPI operation 没有后端实现；
- Next 代理目标不存在于后端或 OpenAPI；
- 无法静态解析的第一方调用；
- 漂移未登记、登记决策无效、验证说明缺失或登记已经过期。

错误信息必须输出 operation、来源层和文件位置，避免只显示一个无上下文 path。

## 实现结构

在现有脚本内保留小型、可独立测试的纯函数：

- `normalizeOperation(method, path)`
- `extractClientOperations(files)`
- `extractBackendOperations(files)`
- `extractOpenApiOperations(document)`
- `extractNextOperations(files)`
- `calculateDrift(surfaces)`

文件递归、文本读取和命令行退出码留在边界层。解析函数接收文本 fixture，测试不依赖真实仓库状态，也不需要 mock 文件系统。

不新增通用 AST 框架。正则只覆盖仓库已经采用并由测试锁定的调用约定；遇到新写法时检查器应明确报“无法静态解析”，促使调用方采用可检查形式或扩展扫描器。

## 测试设计

使用现有 `node:test` 文件 `scripts/check-api-contract.test.mjs`，按 TDD 增加以下回归：

1. 递归文件列表中的嵌套模块会被扫描，聚合 re-export 不影响结果。
2. 同一路径的 `PUT` 与 `PATCH` 被识别为不同 operation。
3. 模板字符串、Nest `:id`、OpenAPI `{id}` 和 Next `[id]` 归一为相同路径。
4. `getTyped/postTyped/patchTyped` 的字面量调用会进入客户端集合，通用 helper 的动态 `url` 参数不会伪造 operation。
5. OpenAPI 遍历同时读取 method 和 path。
6. 普通 Next route 能从目录和导出 method 建立 operation。
7. AI catch-all allowlist 展开五个本地 operation，并产生正确的五个后端代理目标。
8. 前端调用不在 Next allowlist 时报告漂移。
9. Next 代理目标缺少 Controller 或 OpenAPI operation 时报告对应层漂移。
10. 漂移登记以完整 operation 为键，旧 path-only 行不再掩盖 method 漂移。

每个新增行为都先运行对应测试并确认因功能缺失而失败，再写最小实现使其通过。

## 验证标准

- `node --test scripts/check-api-contract.test.mjs` 全部通过。
- `npm run check:api-contract` 能扫描真实 12 个领域 API 文件，而不是只扫描聚合文件。
- 当前仓库中客户端领域 API 不产生“后端不存在”误报。
- 检查器明确报告现有 `PATCH /api/users/me` OpenAPI 漂移。
- 五个 AI 本地 API 调用与 Next allowlist 对齐，五个代理目标与后端/OpenAPI 对齐。
- 修改一个 fixture 的 method 或 allowlist 时，对应测试能稳定失败。
- 本次改动不修改业务路由、API wrapper 或 OpenAPI 内容。
