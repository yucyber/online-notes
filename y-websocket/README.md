# y-websocket 自定义服务

## 启动

```bash
cd y-websocket
npm install
npm start  # 等同于 node start.js
```

`JWT_SECRET` 会自动从 `../notes-backend/.env` 读取。也可通过环境变量 `YWS_JWT_SECRET` 或 `JWT_SECRET` 显式设置。

## Smoke Test

先启动服务，然后运行：

```bash
node scripts/smoke.js
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 1234 | 监听端口 |
| JWT_SECRET | — | JWT 密钥（从 notes-backend/.env 读取） |
| YWS_JWT_SECRET | — | 专用 JWT 密钥（优先于 JWT_SECRET） |
| YWS_AUTH_DISABLED | — | 设为 `1` 关闭认证（生产环境禁止） |
> 以下三个开关**当前未实现**（`server.js` 中无对应逻辑），保留在文档中仅作规划记录，请勿依赖：
> `YWS_MAX_CONNS_PER_IP`、`YWS_MAX_CONNS_PER_ROOM`、`YWS_MAX_PAYLOAD`

## 认证流程

1. 前端调用 `POST /api/notes/:id/room-ticket` 获取短期 JWT（5 分钟有效期，`type: 'room-ticket'`）。
2. 建立 WebSocket 连接时在 URL 带上 `?access_token=<ticket>`。
3. 服务端在 `upgrade` 阶段验证：签名有效、`type === 'room-ticket'`、且票据 `noteId` 与所请求房间绑定一致（见下节）。
4. reader 角色的连接会在服务端丢弃 Yjs update 消息（write 操作静默忽略）。

## 房间名格式与拒绝原因

房间名即连接 URL 的路径（不含前导 `/`），前端约定为：

```
note:<noteId>              例：note:6622a3f1b4a9e1234567890a
note:<noteId>:<versionKey> 例：note:6622a3f1b4a9e1234567890a:v2
```

服务端要求房间名与票据中的 `noteId` 绑定一致（`room-auth.js` 的 `roomMatchesNote`）。这样即使攻击者持有
「自己有权访问的另一篇笔记」的合法票据，也无法加入别人的房间 —— 修复了此前"票据不绑定房间"导致的跨笔记读风险。

`upgrade` 被拒绝时返回 HTTP 状态码并关闭连接：

| 情况 | 状态码 | 日志标记 |
|------|--------|----------|
| 无 token | 401 | `missing-token` |
| 签名无效 / 已过期 | 401 | `invalid-token` |
| token 的 `type` 不是 `room-ticket`（例如登录 token） | 401 | `wrong-ticket-type` |
| 票据 `noteId` 与房间不匹配 | 401 | `room-note-mismatch` |
| 未配置任何 JWT secret | 500 | `missing-secret` |

说明：`YWS_AUTH_DISABLED=1` 在非生产环境会跳过以上全部校验（启动后首次放行时打印一次醒目告警）；
在 `NODE_ENV=production` 下该开关**被忽略**，始终校验。

端到端验证脚本：`node scripts/metrics/verify-ws-room-auth.mjs`（需先以 `YWS_JWT_SECRET` 启动服务），
原始证据：`docs/metrics/raw/verify-ws-room-auth.json`。
