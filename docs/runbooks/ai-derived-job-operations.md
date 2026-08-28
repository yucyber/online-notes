# Note 派生队列运行手册

## 配置

队列复用 `REDIS_URL`。`NOTE_DERIVED_QUIET_MS` 默认 10000。provider 容量默认值只是保守启动值，不代表供应商真实套餐：

BullMQ 建议 Redis 6.2 或更高版本。当前 Redis 5.x 可触发兼容性警告，生产发布前应安排升级并重新运行队列恢复测试。

| provider | 最大并发 | RPM | TPM |
| --- | ---: | ---: | ---: |
| siliconflow | 2 | 30 | 60000 |
| bai | 1 | 10 | 30000 |
| ar | 1 | 5 | 20000 |

分别通过 `SILICONFLOW_*`、`BAI_*`、`AR_*` 的 `AI_MAX_CONCURRENCY`、`AI_RPM`、`AI_TPM` 变量调整。修改前应在对应供应商控制台确认账户实际限制；不要把 API key 写入命令、日志或工单。

## 查看和控制队列

在 Nest application context 中获取 `NoteDerivedQueueService`：

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
