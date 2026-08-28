# Bull Board AI 任务监控设计

## 目标

在后端提供受独立账号密码保护的 Bull Board 页面，让管理员查看 `note-derived` 队列的 waiting、delayed、active、completed 和 failed 任务，定位失败原因，并对单个失败任务执行安全重试。

## 范围

- Bull Board 挂载到后端 `/admin/queues`。
- 复用 NotesModule 已创建的 BullMQ `Queue` 和现有 `REDIS_URL`，不创建同名的第二套业务队列。
- 使用 `BULL_BOARD_USERNAME` 和 `BULL_BOARD_PASSWORD` 独立鉴权，不依赖普通用户 JWT。
- 保留 Bull Board 的单任务查看、重试和删除能力。
- 更新环境变量示例和 AI 派生任务运行手册。

本次不开发自定义监控前端、不引入告警通知、不增加批量清空队列功能，也不改变任务载荷、调度、重试或 provider 容量控制逻辑。

## 架构

新增独立的 Bull Board 模块，使用 `@bull-board/api` 的 `BullMQAdapter` 包装现有 `NOTE_DERIVED_QUEUE` provider，并通过 `@bull-board/express` 创建 Express adapter。模块在应用启动时将 router 挂载到 Nest Express 实例的 `/admin/queues`。

监控模块只依赖队列 token、配置服务和 HTTP adapter。NotesModule 导出队列 token，避免监控模块自行连接 Redis 或重新创建 Queue。

## 访问控制

监控路由使用 HTTP Basic Auth：

1. 读取 `Authorization` 请求头并解析用户名、密码。
2. 使用恒定时间比较校验两个凭据，降低可观察的时序差异。
3. 未认证请求返回 `401` 和 `WWW-Authenticate`；认证失败不记录明文凭据。
4. 所有响应设置 `Cache-Control: no-store`，避免浏览器或代理缓存队列详情。

开发和生产均只有在两个变量同时存在时才启用页面。生产环境缺少任一变量时应用启动失败；非生产环境缺少变量时不挂载路由并记录明确警告。这既防止生产裸奔，也不阻塞未使用监控功能的测试和本地开发。

## 数据与操作边界

Bull Board 展示 BullMQ 已保存的任务元数据和失败信息。`note-derived` job 继续只保存 `noteId`、`userId`、变化类型和 `expectedUpdatedAt` 等必要字段，不新增正文、prompt、reasoning、API key 或模型完整响应。

管理员可通过 Bull Board 重试单个 failed job。worker 仍会重新读取 Note 并检查 `expectedUpdatedAt`，因此重试不会绕过陈旧快照保护。Bull Board 的删除操作只影响选定任务，不提供本项目自定义的批量清理入口。

## 错误处理

- Redis 不可用时，由 BullMQ/Bull Board 返回连接错误；监控模块不吞掉错误，也不影响现有业务队列的恢复机制。
- 配置不完整时不使用默认账号密码。
- 鉴权失败只返回通用错误，不暴露用户名是否正确。
- Board 初始化失败应让生产启动失败，避免部署后误以为监控可用。

## 测试与验收

按 TDD 覆盖：

- 未认证和错误凭据返回 `401`。
- 正确凭据可访问 Bull Board，并带有 `no-store`。
- Board 使用注入的现有 `note-derived` Queue。
- 非生产缺少配置时路由不启用；生产缺少配置时启动失败。
- job 页面与操作不需要把正文或密钥加入任务数据。

完成后运行相关测试、后端全量单测、`npm run build` 和 `git diff --check`，并在运行手册记录访问路径、配置方式、失败任务排查和重试边界。
