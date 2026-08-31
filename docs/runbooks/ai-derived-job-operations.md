# Note 派生队列运行手册

## 配置

队列复用 `REDIS_URL`。`NOTE_DERIVED_QUIET_MS` 默认 10000。provider 容量默认值只是保守启动值，不代表供应商真实套餐：

BullMQ 建议 Redis 6.2 或更高版本。本机当前使用兼容 Redis 7.2.5 的 Memurai；升级或迁移 Redis 后需重新运行队列恢复测试。

| provider | 最大并发 | RPM | TPM |
| --- | ---: | ---: | ---: |
| siliconflow | 2 | 30 | 40000 |
| bai | 1 | 10 | 30000 |
| ar | 1 | 5 | 20000 |

分别通过 `SILICONFLOW_*`、`BAI_*`、`AR_*` 的 `AI_MAX_CONCURRENCY`、`AI_RPM`、`AI_TPM` 变量调整。修改前应在对应供应商控制台确认账户实际限制；不要把 API key 写入命令、日志或工单。

## 查看和控制队列

配置独立监控凭据后访问 `http://localhost:3001/admin/queues`。生产环境必须同时设置 `BULL_BOARD_USERNAME` 和 `BULL_BOARD_PASSWORD`，否则后端拒绝启动；非生产环境缺少凭据时不启用监控页面。浏览器会显示 Basic Auth 登录框，凭据不得与普通用户账号或 API key 复用。

Bull Board 展示 `note-derived` 的 waiting、delayed、active、completed 和 failed 任务。排查 failed job 时优先查看 `failedReason`、`attemptsMade`、`processedOn` 和 `finishedOn`，确认 Note 当前 `updatedAt` 后再重试单个任务。worker 重试时仍校验 `expectedUpdatedAt`，不会绕过陈旧快照保护。

页面允许操作单个任务，但不要批量清空队列。不得把完整正文、prompt、reasoning、模型响应、API key 或监控密码复制到截图、日志或工单。轮换监控密码后应滚动重启后端实例，并确认旧凭据返回 `401`。

命令行应急操作仍可在 Nest application context 中获取 `NoteDerivedQueueService`：

```ts
const queue = app.get(NoteDerivedQueueService)
console.log(await queue.getCounts())
await queue.pause()
await queue.resume()
```

`getCounts()` 返回 `waiting`、`active`、`delayed`、`failed`、`completed`。暂停只阻止新 job 被 worker 领取，不中断正在运行的模型请求。

## 安全重放

只按 Note ID 重放 failed job，服务会拒绝不存在或非 failed 状态的任务：

```ts
await queue.replayFailed(noteId)
```

worker 重放时仍会按 job 的 `userId` 重新读取 Note，并校验 `expectedUpdatedAt`。笔记已经更新时旧 job 会被丢弃，不会覆盖新 summary、主题向量或 Chunk。

## 故障处理

- Redis 暂时不可用：保存 API 不等待 AI；入队失败会记录安全错误，后续编辑会重新调度。已有 job 保留在 Redis，连接恢复和进程重启后继续。
- provider 容量不足：worker 把 job 移回 delayed，不在 active 槽内循环等待。
- provider 返回 429/502/503/504：Gateway 继续遵循 `Retry-After` 或有限指数退避；每次实际重试重新预约容量，最多重试两次。
- failed job：先查看 BullMQ 的 `attemptsMade`、`failedReason`、`timestamp`、`processedOn` 和 `finishedOn`。不得把完整正文、prompt、reasoning、模型响应或 API key 复制到审计记录。

## 调整步骤

1. 在供应商控制台确认目标账户的并发、RPM、TPM。
2. 先暂停 queue，修改环境变量并滚动重启实例。
3. 确认所有实例读取相同 `REDIS_URL` 和容量变量。
4. 恢复 queue，观察 delayed/failed 数量与 provider 429 比例；逐步调高，不根据余额百分比猜限额。
