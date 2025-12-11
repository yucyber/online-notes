# 在线笔记项目部署（Render + Vercel）

## 概览
- 前端：Vercel（Next.js 14，目录 `notes-frontend`）
- 后端：Render Web Service（NestJS，目录 `notes-backend`，前缀 `/api`）
- 协作：Render Web Service（y-websocket，路径 `/ws/yjs`）
- 数据库：MongoDB Atlas
- 缓存：Upstash Redis（TLS，`rediss://`）

## 环境变量示例（以 Render 域名为例）
- 前端（Vercel）：
  - `NEXT_PUBLIC_API_URL` = `https://<render-backend>.onrender.com/api`
  - `NEXT_PUBLIC_RUM_ENDPOINT` = `https://<render-backend>.onrender.com/api/rum/collect`
  - `NEXT_PUBLIC_YWS_URL` = `wss://<render-yws>.onrender.com/ws/yjs`
- 后端（Render）：
  - `MONGODB_URI` = `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/notes?retryWrites=true&w=majority`
  - `REDIS_URL` = `rediss://default:<TOKEN>@<upstash-host>.upstash.io:6379`
  - `JWT_SECRET` = `<随机字符串>`
  - `CLIENT_URL` = `https://<your>.vercel.app,https://<your>-git-<branch>-<account>.vercel.app`
  - `NODE_ENV` = `production`
- 协作（Render）：
  - `YWS_PATH` = `/ws/yjs`
  - `JWT_SECRET` = `<与后端一致>`

## 在 Render 部署后端（NestJS）
- 打开 https://render.com → `New` → `Web Service`
- 选择你的 GitHub 仓库，`Root Directory` 选 `notes-backend`
- Build Command：`npm install && npm run build`
- Start Command：`npm run start`
- 添加环境变量：按上面“后端（Render）”列表逐一添加
- 部署完成后，记下域名，例如：`https://online-notes-backend.onrender.com`
- 验证：访问 `https://<render-backend>.onrender.com/api/health` 返回 200

## 在 Render 部署协作服务（y-websocket）
- 在同一项目 `New` → `Web Service`
- 选择同一仓库，`Root Directory` 选 `notes-frontend`
- Start Command：`node node_modules/y-websocket/bin/server.js`
- 添加环境变量：`YWS_PATH=/ws/yjs`、`JWT_SECRET=<与后端一致>`
- 部署完成后，记下域名，例如：`https://online-notes-yws.onrender.com`
- 验证：访问 `https://<render-yws>.onrender.com/` 返回 `{ code: 0, message: 'y-websocket ok' }`

## 在 Vercel 部署前端（Next.js）
- 打开 https://vercel.com → `New Project` → 选择仓库，`Root Directory` 选 `notes-frontend`
- Build Command：`npm run build`；Output：`.next`
- Settings → Environment Variables → 添加：
  - `NEXT_PUBLIC_API_URL` = `https://<render-backend>.onrender.com/api`（为 Production/Preview/Development 全部保存）
  - `NEXT_PUBLIC_RUM_ENDPOINT` = `https://<render-backend>.onrender.com/api/rum/collect`
  - `NEXT_PUBLIC_YWS_URL` = `wss://<render-yws>.onrender.com/ws/yjs`
- 点击 `Deploy`，完成后访问：`https://<your>.vercel.app`
- 验证：`https://<your>.vercel.app/api/health` 返回 200；编辑器握手 `wss://<render-yws>.onrender.com/ws/yjs/...`

## 本地一键启动（可选）
- 复制 `.env.compose.example` 为 `.env` 并按需修改
- 运行 `docker compose up -d`
- 访问：前端 `http://localhost:3000`；后端 `http://localhost:3002/api/health`；协作 `ws://localhost:1234/ws/yjs`

## 常见问题
- CORS 报错：把 Vercel 的生产与预览域加入后端 `CLIENT_URL`
- Redis 连接失败：使用 `rediss://`，不可用只读 Token
- WebSocket 失败：`NEXT_PUBLIC_YWS_URL` 必须是 `wss://<render-yws>.onrender.com/ws/yjs`，`JWT_SECRET` 与后端一致

## 反向代理与同域配置（Nginx）
- 目的：将 `wss://<你的域名>/ws/yjs` 反代到后端协作服务，实现同域、TLS 与长连接升级。
- 要点：启用 WebSocket 升级头，合理的连接/读取超时，限流与健康检查。

示例（请将占位域名替换为你的实际域名/上游地址）：

```nginx
map $http_authorization $auth_present { default 0; "~^Bearer\s+.+" 1; }

limit_req_zone $binary_remote_addr zone=yws_limit:10m rate=100r/m;

upstream yws_backend {
  # 如为 Render/多实例，建议 2–3 个副本；若使用一致性哈希可用 Nginx stream/模块
  server <render-yws-1>:1234 max_fails=2 fail_timeout=5s;
  # server <render-yws-2>:1234 max_fails=2 fail_timeout=5s;
}

server {
  listen 443 ssl http2;
  server_name collab.example.com;

  ssl_certificate     /etc/ssl/certs/collab.crt;
  ssl_certificate_key /etc/ssl/private/collab.key;
  ssl_protocols       TLSv1.2 TLSv1.3;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

  # 健康检查（可供监控探测）
  location = / {
    default_type application/json;
    return 200 '{"code":0,"message":"y-websocket ok"}';
  }

  location /ws/yjs {
    # 如需在网关校验 JWT，可启用以下鉴权（可选）
    # if ($auth_present = 0) { return 401; }

    limit_req zone=yws_limit burst=50 nodelay;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Real-IP $remote_addr;

    proxy_connect_timeout 300ms;
    proxy_send_timeout    1s;
    proxy_read_timeout    120s;
    proxy_buffering off;

    proxy_next_upstream error timeout http_502 http_503 http_504;
    proxy_pass http://yws_backend/ws/yjs;
  }
}

server { listen 80; server_name collab.example.com; return 301 https://$host$request_uri; }
```

## 上线检查清单
- 前端环境变量已设置：`NEXT_PUBLIC_YWS_URL=wss://<你的域名>/ws/yjs`
- 代理已放通升级头：`Upgrade/Connection`、`proxy_http_version 1.1`
- 超时与长连接：`proxy_read_timeout ≥120s`，客户端心跳（若启用）可见
- 健康检查：`https://<你的域名>/` 返回 `{code:0,message:"y-websocket ok"}`
- 观测：建立连接、同步、降级事件在前端 RUM 中可见
- 安全（可选）：JWT 在网关侧鉴权；限流 `100/min/IP`；开启 HSTS

## 高可用建议
- y-websocket 默认内存态，不建议多副本水平扩容；如需扩容，建议引入 Redis Pub/Sub 或迁移到支持集群的 Yjs 服务（如 `@hocuspocus/server` + Redis），并在网关按 `room` 做粘性路由。
- 发生上游故障时返回 `503`，客户端指数退避 1–3s 重连；必要时临时提高 `burst` 以缓解抖动。
