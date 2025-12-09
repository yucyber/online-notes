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
