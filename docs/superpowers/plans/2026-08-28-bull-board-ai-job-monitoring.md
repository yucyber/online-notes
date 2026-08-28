# Bull Board AI Job Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在后端 `/admin/queues` 提供受独立 Basic Auth 保护的 Bull Board，用于监控和重试 `note-derived` AI 派生任务。

**Architecture:** NotesModule 将现有 BullMQ Queue 作为 `NOTE_DERIVED_QUEUE` token 导出，监控模块通过依赖注入复用该实例。Bull Board 模块在 Nest Express adapter 上挂载带鉴权和 `no-store` 响应头的 router；生产环境缺少凭据时拒绝启动，非生产环境则禁用页面并记录警告。

**Tech Stack:** NestJS 10、Express、BullMQ 5、`@bull-board/api`、`@bull-board/express`、Node test runner、TypeScript。

## Global Constraints

- 在当前 master 工作区实施，不创建 worktree。
- 按 TDD 执行；每项生产行为必须先有失败测试并确认因功能缺失而失败。
- 监控页面固定挂载到 `/admin/queues`，不受全局 `/api` prefix 影响。
- 独立凭据变量固定为 `BULL_BOARD_USERNAME` 和 `BULL_BOARD_PASSWORD`，不得提供默认密码。
- production 缺少任一凭据时启动失败；非 production 缺少凭据时不挂载页面。
- 复用现有 `note-derived` Queue 和 `REDIS_URL`，不得创建同名的第二套业务 Queue。
- 不向 job 增加正文、prompt、reasoning、API key 或模型完整响应。
- 不改变现有调度、陈旧快照保护、Gateway retry、provider fallback 或容量控制行为。
- 复杂权限边界和时序只写简洁中文原因注释。
- 每个独立阶段使用 `类型(范围): 中文简述` 提交。

---

### Task 1: 独立 Basic Auth 中间件

**Files:**
- Create: `notes-backend/src/modules/queue-monitor/queue-monitor-auth.ts`
- Test: `notes-backend/test/queue-monitor-auth.test.ts`

**Interfaces:**
- Produces: `createQueueMonitorAuth(username: string, password: string): RequestHandler`
- Produces: 未认证或错误凭据返回 `401`、`WWW-Authenticate: Basic realm="AI Task Monitor"` 和 `Cache-Control: no-store`；正确凭据调用 `next()`。

- [ ] **Step 1: 写鉴权失败测试**

创建最小 Express Request/Response test doubles，分别断言缺失 header、错误密码均返回 `401`，且响应不区分用户名或密码错误。

```ts
test('缺少或错误的 Bull Board 凭据统一返回 401', () => {
  const auth = createQueueMonitorAuth('operator', 'secret')
  for (const authorization of [undefined, `Basic ${Buffer.from('operator:wrong').toString('base64')}`]) {
    const result = invoke(auth, authorization)
    assert.equal(result.statusCode, 401)
    assert.equal(result.headers['www-authenticate'], 'Basic realm="AI Task Monitor"')
    assert.equal(result.headers['cache-control'], 'no-store')
    assert.equal(result.nextCalled, false)
  }
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `cd notes-backend && node --require ts-node/register --require tsconfig-paths/register --test test/queue-monitor-auth.test.ts`

Expected: FAIL，原因是 `queue-monitor-auth` 模块不存在。

- [ ] **Step 3: 写正确凭据测试**

```ts
test('正确的 Bull Board 凭据放行且禁止缓存', () => {
  const auth = createQueueMonitorAuth('operator', 'secret')
  const result = invoke(auth, `Basic ${Buffer.from('operator:secret').toString('base64')}`)
  assert.equal(result.statusCode, undefined)
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.equal(result.nextCalled, true)
})
```

- [ ] **Step 4: 实现最小鉴权中间件**

使用 `crypto.timingSafeEqual` 比较 UTF-8 Buffer；长度不同时用固定失败结果，解析失败统一返回 `401`。不要记录 header 或凭据。

```ts
export function createQueueMonitorAuth(username: string, password: string): RequestHandler {
  return (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    const credentials = parseBasicCredentials(request.headers.authorization)
    if (!credentials || !safeEqual(credentials.username, username) || !safeEqual(credentials.password, password)) {
      response.setHeader('WWW-Authenticate', 'Basic realm="AI Task Monitor"')
      response.status(401).send('Unauthorized')
      return
    }
    next()
  }
}
```

- [ ] **Step 5: 运行测试并确认 GREEN**

Run: `cd notes-backend && node --require ts-node/register --require tsconfig-paths/register --test test/queue-monitor-auth.test.ts`

Expected: 两项测试均 PASS。

- [ ] **Step 6: 提交鉴权阶段**

```powershell
git add -- notes-backend/src/modules/queue-monitor/queue-monitor-auth.ts notes-backend/test/queue-monitor-auth.test.ts
git commit -F .git/CODEX_COMMIT_MSG
```

Commit message: `feat(ai): 增加任务监控独立鉴权`

---

### Task 2: 导出并复用现有 BullMQ Queue

**Files:**
- Modify: `notes-backend/src/modules/notes/notes.module.ts`
- Modify: `notes-backend/src/modules/notes/note-derived-queue.service.ts`
- Test: `notes-backend/test/note-derived-queue-provider.test.ts`

**Interfaces:**
- Consumes: `NOTE_DERIVED_QUEUE` string token。
- Produces: NotesModule 可导出的 `Queue<NoteDerivedJobData>` provider，以及模块内部的 `NOTE_DERIVED_QUEUE_CONNECTION` connection token。
- Produces: `NoteDerivedQueueService` 继续接收同一个 Queue 实例，所有既有公开方法签名不变。

- [ ] **Step 1: 写 provider 复用失败测试**

测试 NotesModule metadata：`providers` 中存在 `provide: NOTE_DERIVED_QUEUE`，`NoteDerivedQueueService` factory 注入该 token，`exports` 包含该 token。断言 Queue provider 使用注入的 `REDIS_CLIENT` duplicate connection 创建实例。

```ts
test('NotesModule 导出供调度器和监控页共享的 Queue provider', () => {
  const metadata = Reflect.getMetadata('imports', NotesModule)
  void metadata
  const providers = Reflect.getMetadata('providers', NotesModule) as any[]
  const queueProvider = providers.find((provider) => provider.provide === NOTE_DERIVED_QUEUE)
  const serviceProvider = providers.find((provider) => provider.provide === NoteDerivedQueueService)
  assert.ok(queueProvider)
  assert.deepEqual(serviceProvider.inject, [NOTE_DERIVED_QUEUE, NOTE_DERIVED_QUEUE_CONNECTION, REDIS_CLIENT, ConfigService])
  assert.ok((Reflect.getMetadata('exports', NotesModule) as any[]).includes(NOTE_DERIVED_QUEUE))
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `cd notes-backend && node --require ts-node/register --require tsconfig-paths/register --test test/note-derived-queue-provider.test.ts`

Expected: FAIL，当前 NotesModule 没有单独的 Queue provider，也没有导出 queue token。

- [ ] **Step 3: 最小重构 Queue provider**

新增 `NOTE_DERIVED_QUEUE_CONNECTION` token，其 provider 从共享 Redis duplicate connection；Queue provider 注入该 connection 并创建 Queue。`NoteDerivedQueueService` factory 注入 Queue、owned connection、共享 Redis 和 ConfigService。Queue 的 connection 所有权仍由 service 在 `onModuleDestroy` 关闭，避免重复关闭共享 Redis client。

```ts
{
  provide: NOTE_DERIVED_QUEUE_CONNECTION,
  inject: [REDIS_CLIENT],
  useFactory: (redis: Redis) => redis.duplicate({ maxRetriesPerRequest: null }),
},
{
  provide: NOTE_DERIVED_QUEUE,
  inject: [NOTE_DERIVED_QUEUE_CONNECTION],
  useFactory: (connection: Redis) => new Queue(NOTE_DERIVED_QUEUE, { connection }),
}
```

- [ ] **Step 4: 运行 provider 测试和既有队列测试**

Run: `cd notes-backend && node --require ts-node/register --require tsconfig-paths/register --test test/note-derived-queue-provider.test.ts test/note-derived-queue.test.ts test/note-derived-queue-redis.test.ts`

Expected: 全部 PASS，真实 Redis 恢复测试仍复用 BullMQ 行为。

- [ ] **Step 5: 提交 Queue 复用阶段**

Commit message: `refactor(ai): 导出派生任务队列实例`

---

### Task 3: 挂载 Bull Board 与配置保护

**Files:**
- Create: `notes-backend/src/modules/queue-monitor/queue-monitor.service.ts`
- Create: `notes-backend/src/modules/queue-monitor/queue-monitor.module.ts`
- Modify: `notes-backend/src/app.module.ts`
- Modify: `notes-backend/package.json`
- Modify: `notes-backend/package-lock.json`
- Test: `notes-backend/test/queue-monitor.service.test.ts`

**Interfaces:**
- Consumes: 通过 `@Inject(NOTE_DERIVED_QUEUE)` 注入的 `Queue<NoteDerivedJobData>`、`ConfigService`、`HttpAdapterHost`。
- Produces: `QueueMonitorService implements OnModuleInit`。
- Produces: 正确配置时 `httpAdapter.getInstance().use('/admin/queues', auth, boardRouter)`；非生产缺配置时不挂载；production 缺配置时抛出 `Bull Board credentials are required in production`。

- [ ] **Step 1: 安装固定 major 的 Bull Board 依赖**

Run: `cd notes-backend && npm install @bull-board/api@^6 @bull-board/express@^6`

Expected: package manifest 和 lockfile 只新增 Bull Board 及其传递依赖。安装依赖不构成生产逻辑；在下一步测试 RED 后才编写模块实现。

- [ ] **Step 2: 写配置与挂载失败测试**

使用假的 HTTP adapter 收集 `use` 调用，注入假的 Queue。覆盖三个独立行为：

```ts
test('正确配置时挂载注入的 note-derived Queue', () => {
  const service = makeService({ NODE_ENV: 'production', BULL_BOARD_USERNAME: 'operator', BULL_BOARD_PASSWORD: 'secret' })
  service.onModuleInit()
  assert.equal(fakeExpress.mounts[0].path, '/admin/queues')
  assert.equal(fakeExpress.mounts[0].handlers.length, 2)
})

test('非生产环境缺少凭据时不挂载 Bull Board', () => {
  const service = makeService({ NODE_ENV: 'test' })
  service.onModuleInit()
  assert.equal(fakeExpress.mounts.length, 0)
})

test('生产环境缺少凭据时拒绝启动', () => {
  const service = makeService({ NODE_ENV: 'production' })
  assert.throws(() => service.onModuleInit(), /Bull Board credentials are required in production/)
})
```

- [ ] **Step 3: 运行测试并确认 RED**

Run: `cd notes-backend && node --require ts-node/register --require tsconfig-paths/register --test test/queue-monitor.service.test.ts`

Expected: FAIL，原因是 QueueMonitorService 尚不存在。

- [ ] **Step 4: 实现最小 Bull Board 模块**

在 service 构造时接收依赖，在 `onModuleInit` 校验配置；配置完整时创建 `ExpressAdapter`、设置 base path、调用 `createBullBoard({ queues: [new BullMQAdapter(handle.queue)], serverAdapter })`，最后按顺序挂载 auth 和 router。

```ts
serverAdapter.setBasePath('/admin/queues')
createBullBoard({
  queues: [new BullMQAdapter(this.queue)],
  serverAdapter,
})
express.use('/admin/queues', createQueueMonitorAuth(username, password), serverAdapter.getRouter())
```

QueueMonitorModule imports `NotesModule`，provider 注册 QueueMonitorService；AppModule imports QueueMonitorModule。

- [ ] **Step 5: 运行监控测试并确认 GREEN**

Run: `cd notes-backend && node --require ts-node/register --require tsconfig-paths/register --test test/queue-monitor-auth.test.ts test/queue-monitor.service.test.ts test/note-derived-queue-provider.test.ts`

Expected: 全部 PASS。

- [ ] **Step 6: 编译验证**

Run: `cd notes-backend && npm run build`

Expected: TypeScript 编译成功，无 Bull Board adapter 类型错误。

- [ ] **Step 7: 提交 Bull Board 集成阶段**

Commit message: `feat(ai): 接入 Bull Board 任务监控`

---

### Task 4: 配置与运行手册

**Files:**
- Modify: `notes-backend/.env.example`
- Modify: `docs/runbooks/ai-derived-job-operations.md`

**Interfaces:**
- Documents: `BULL_BOARD_USERNAME`、`BULL_BOARD_PASSWORD`、`http://localhost:3001/admin/queues`。
- Documents: failed job 查看字段、单任务 retry、陈旧快照保护、敏感数据禁止项和凭据轮换方法。

- [ ] **Step 1: 更新环境变量示例**

在 Redis/队列配置旁加入无真实秘密的占位值：

```dotenv
BULL_BOARD_USERNAME=change_me
BULL_BOARD_PASSWORD=use_a_long_random_password
```

- [ ] **Step 2: 更新运行手册**

记录：访问路径、production 必填规则、Basic Auth 浏览器登录方式；按 `failedReason`、`attemptsMade`、`processedOn`、`finishedOn` 排查；确认 Note 当前 `updatedAt` 后只重试单个任务；不得复制正文、prompt、reasoning、API key 或完整响应到工单。

- [ ] **Step 3: 检查文档与配置差异**

Run: `git diff --check`

Expected: exit code 0，无尾随空格或冲突标记。

- [ ] **Step 4: 提交文档阶段**

Commit message: `docs(ai): 补充任务监控运行说明`

---

### Task 5: 全量回归与本地冒烟验收

**Files:**
- Modify only if a failing test exposes a Bull Board integration defect; any fix must first add or refine a failing regression test in `notes-backend/test/queue-monitor-*.test.ts`。

**Interfaces:**
- Verifies: 全量后端行为、TypeScript build、实际 Redis 队列页面、鉴权与敏感数据边界。

- [ ] **Step 1: 运行后端全量测试**

Run: `cd notes-backend && npm run test:unit`

Expected: 所有测试 PASS，且没有未处理 Promise rejection。

- [ ] **Step 2: 运行最终构建**

Run: `cd notes-backend && npm run build`

Expected: exit code 0。

- [ ] **Step 3: 使用临时凭据启动本地后端并冒烟测试**

在当前 PowerShell 进程临时设置非真实凭据后启动后端；请求 `/admin/queues`：无凭据应为 `401`，正确凭据应为 `200` 且页面包含 Bull Board 静态资源或队列名称 `note-derived`。不得把临时凭据写入日志、仓库或测试快照。

- [ ] **Step 4: 验证失败任务操作边界**

使用测试专用 job 或现有无敏感数据的 failed job 检查详情页和单任务 retry；确认 job data 只包含 `noteId`、`userId`、`changes`、`expectedUpdatedAt`、`nextRunAt` 和安全审计字段。

- [ ] **Step 5: 最终仓库检查**

Run: `git diff --check && git status --short && git log -5 --oneline`

Expected: diff check 成功；只有明确需要提交的验收修复文件，或工作区完全干净。

- [ ] **Step 6: 如有验收修复则提交**

Commit message: `test(ai): 完成 Bull Board 任务监控验收`
