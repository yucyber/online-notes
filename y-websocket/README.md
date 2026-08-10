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
| YWS_MAX_CONNS_PER_IP | 10 | 每 IP 最大连接数 |
| YWS_MAX_CONNS_PER_ROOM | 20 | 每房间最大连接数 |
| YWS_MAX_PAYLOAD | 10485760 | 最大消息体（字节，默认 10 MB） |

## 认证流程

1. 前端调用 `POST /api/notes/:id/room-ticket` 获取短期 JWT（5 分钟有效期，`type: 'room-ticket'`）。
2. 建立 WebSocket 连接时在 URL 带上 `?access_token=<ticket>`。
3. 服务端验证 token 类型、noteId 匹配、IP 连接数和房间容量上限。
4. reader 角色的连接会在服务端丢弃 Yjs update 消息（write 操作静默忽略）。

## 房间名格式

房间名必须符合 `note:<24位 hex ObjectId>` 格式，例如：

```
note/6622a3f1b4a9e1234567890a
```

非法格式会收到 `400 Bad Request`。
