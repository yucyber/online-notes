# 本项目常见坑位

排查 bug 时优先对照这些已知坑位。

## Mongoose / MongoDB

- **ObjectId vs 字符串**：写入用 `new Types.ObjectId()` 存成 ObjectId，查询用字符串数组做 `$in` 会匹配不上。mongoose 对 `$in` 数组里的字符串不会可靠地自动 cast。解决：显式转 ObjectId，或双形态兼容（同时塞 ObjectId + 字符串进 `$in`）。
  - 已发生案例：活动日志查不到 `note_created` 记录，见 `docs/debug-records.md`。
- **数据库选择**：当前项目实际使用 `test` 库（`.env` 连接串未显式指定库名时，落到默认库）。排查数据问题时先确认连的是哪个库，别被旧数据（`notes` 库）误导。
- **toJSON transform**：User schema 的 `toJSON` 里 `ret.id = ret._id`（未 `toString()`）是可疑点，序列化输出里 id 可能是 ObjectId 对象而非字符串，排查身份/ID 相关 bug 时留意。

## Redis（ioredis）

- **localhost 解析到 IPv6 ::1**：Node 解析 `localhost` 可能优先返回 IPv6 的 `::1`，而 Windows 本机 redis-server 常只监听 IPv4 的 `127.0.0.1`，导致 `ECONNREFUSED ::1:6379`。解决：`REDIS_URL` 显式写 `redis://127.0.0.1:6379`，不要用 `localhost`。

## 前端 Node 侧直连后端（SSR / route handler）

- **localhost 解析到 IPv6 ::1**（同 Redis 坑）：Node 进程内（SSR 组件、route handler、proxy）用 `localhost` fetch 后端会优先解析到 `::1`，而后端只监听 IPv4 `0.0.0.0:3001`，报 `ECONNREFUSED ::1:3001`。解决：Node 侧统一用 `SERVER_API_URL`（`src/lib/server/api-url.ts`，默认 `http://127.0.0.1:3001/api`），**不要复用 `NEXT_PUBLIC_API_URL`**——那是给浏览器的，必须保持 localhost 才能与页面同 site 带上登录 cookie。已发生案例：笔记详情 SSR 报 `ECONNREFUSED ::1:3001`，见 `docs/debug-records.md`。

## 认证 / 权限

- JWT token 中 `sub` 是用户 `_id`，`jwt.strategy.ts` 用 `findById(payload.sub)` 返回 mongoose document 挂到 `req.user`。
- 用户不存在返回 404「用户不存在」，常见原因是**查错了库**（token 里的 user id 在另一个库）。

## 审计日志（Audit）

- `AuditService.record()` 只持久化白名单字段（`sanitize`），note 类型只保留 `title`/`tags`/`categoryId`，不含 `content`。
- `list()` 查询口径是「当前用户可编辑笔记」上的协作轨迹（创建者 或 ACL editor），不是只看自己的记录。

## 协作（Yjs / WebSocket）

- `y-websocket/` 是独立的 Yjs 协作服务，排查协作/同步问题时单独看该目录，别和后端 NestJS 的 REST 接口混为一谈。

---

> 每次解决一个新 bug，若涉及新的通用坑位，除了写进 `docs/debug-records.md`，也顺手在这里补一条，方便下次快速命中。
