# ECS 单机生产部署设计

## 目标

为当前在线笔记项目建立一套可在阿里云 ECS 单机运行的生产部署基座。不依赖域名，以公网 IP `47.97.243.59` 和 Certbot IP 短有效期证书完成 HTTPS 核心功能验收；未来绑定域名或填写 AI provider Key 时，不需要重做镜像架构。

本阶段验收注册登录、笔记 CRUD、MongoDB 持久化、Redis 连接和双浏览器 Yjs 实时协作。AI 摘要、embedding、RAG 等能力不要求成功调用，但保留完整环境变量入口和既有 provider 路由。

## 部署架构

### 实施核对修正（2026-09-08）

以下细节以当前源码为依据，优先于下文初始设计中的简化描述：

- `/api/assistant/*` 与五个 Next AI 入口（writer、pet、mindmap、mermaid、summary）由 frontend 处理；其余 `/api/*`（包括 AI runs、knowledge-graph）直达 backend。
- Compose 固定 `CLIENT_URL=https://${PUBLIC_HOST}`、`COOKIE_SECURE=true` 和 `NEXT_PUBLIC_YWS_URL=wss://${PUBLIC_HOST}/ws/yjs`。
- 使用未发布数据端口的 Docker bridge 网络，保留 backend 的外网 AI 访问能力。宿主机管理员仍可访问容器网络。
- Key 更新必须重建 backend 容器以重新注入环境变量，单纯 restart 不够；无需重新构建镜像。
- MongoDB 使用外部 Atlas；Compose 只保留 Redis AOF volume。当前 Yjs 房间为内存态，不保证重启前未保存的协作状态。
- ECS 直连 Docker Hub 不稳定，Node、Redis 和 Nginx 基础镜像使用 `m.daocloud.io/docker.io/library/` 前缀。
- Certbot 证书从宿主机 `/etc/letsencrypt` 只读挂载，Nginx 使用 `live/47.97.243.59/fullchain.pem` 和 `privkey.pem`。
- 已有鉴权与连接限制以实际源码为准，本次不扩展或承诺未实现的权限校验。

单台 ECS 使用 Docker Compose 运行五个容器，并连接外部 Atlas：

```text
Internet
   |
   | HTTP :80 (301) / HTTPS :443
   v
Nginx
   |-- /          -> frontend:3000
   |-- /api       -> backend:3001
   `-- /ws/yjs    -> y-websocket:1234

Docker internal network
   |-- backend    -> redis:6379
   |-- y-websocket 与 backend 共用 JWT_SECRET
   `-- backend    -> MongoDB Atlas (external)
```

只有 Nginx 映射宿主机 80/443。frontend、backend、y-websocket 和 Redis 仅加入 Compose 内部网络，不向公网暴露端口；Atlas 用 IP Access List 限制为 ECS 公网 IP `/32`。该 HTTPS 同源入口避免跨域、SameSite Cookie 和 WebSocket 地址分散问题。

## 服务职责与数据流

### Nginx

- 监听宿主机 `80` 和 `443`，80 固定 301 到 `https://47.97.243.59`。
- 使用 Certbot IP 短有效期证书，证书目录由宿主机只读挂载；续期后 reload Nginx。
- `/` 代理到 Next.js。
- `/api` 原样代理到 NestJS，保留请求头、Cookie 和客户端 IP 信息。
- `/ws/yjs` 代理到独立 y-websocket 服务，并设置 HTTP/1.1、`Upgrade`、`Connection`、长读取超时和关闭响应缓冲。

### Next.js

- 使用 Node 22 多阶段镜像构建和运行。
- 浏览器 API 地址采用同源 `/api`。
- 浏览器协作地址为 `wss://<PUBLIC_HOST>/ws/yjs`。
- SSR 和 route handler 使用 `SERVER_API_URL=http://backend:3001/api` 访问 Docker 内部服务，不能使用容器自身的 `127.0.0.1`。

### NestJS

- 监听容器内 `3001`。
- 使用 `.env.production` 注入的 Atlas `MONGODB_URI=mongodb+srv://...`。
- 使用 `REDIS_URL=redis://redis:6379`。
- `CLIENT_URL` 精确设置为 `https://<PUBLIC_HOST>`，并启用 Secure Cookie。
- 使用高强度随机 `JWT_SECRET`，并与 y-websocket 共享该值。

### y-websocket

- 监听容器内 `1234`，公开路径为 `/ws/yjs`。
- 使用 NestJS 签发 room ticket 时所用的同一个 `JWT_SECRET`。
- 保留现有鉴权、消息大小限制和连接限制，不改变协作协议。

### Atlas 与 Redis

- MongoDB 使用外部 Atlas，不在 Compose 中创建 MongoDB 服务或 volume。
- Redis 开启 AOF，并使用命名 volume 保存数据。
- Redis 不发布 `6379` 到宿主机；Atlas 通过用户凭据和 ECS IP Access List 控制访问。

## 环境变量设计

仓库提交 `.env.production.example`，ECS 将其复制为不提交的 `.env.production`。模板需要覆盖：

- 公网入口：`PUBLIC_HOST`。
- 核心安全配置：`JWT_SECRET`、Bull Board 用户名和长随机密码。
- 数据服务：外部 Atlas URI 和 Compose 内部 Redis 连接地址。
- 前后端公开与内部地址：`NEXT_PUBLIC_API_URL`、`NEXT_PUBLIC_YWS_URL`、`SERVER_API_URL`、`CLIENT_URL`。
- AI provider：SiliconFlow、B.AI、AgentRouter 的 base URL、模型、并发、RPM、TPM 和空 Key 槽位。
- 既有队列与容量配置：`NOTE_DERIVED_QUIET_MS`、`AI_CAPACITY_KEY_PREFIX`、路由开关和 provider 选择。

真实 `.env.production` 必须加入 `.gitignore`。部署预检在以下情况终止：核心变量缺失、`JWT_SECRET` 仍是示例值或长度不足、Bull Board 凭据仍是示例值、`PUBLIC_HOST` 带协议或路径。AI Key 允许为空；未配置时核心功能仍可运行，AI 请求按既有后端行为明确失败。

Next.js 的 `NEXT_PUBLIC_*` 变量在镜像构建时写入浏览器包，因此修改公网入口、协议或域名后必须重新构建 frontend 镜像。服务端变量在容器启动时注入。

## 编排、健康检查与持久化

`docker-compose.production.yml` 定义五个服务、一个内部网络和 Redis 命名 volume。

启动依赖按健康状态组织：

- Redis 先通过健康检查。
- backend 在 Redis 健康后启动，连接 Atlas，并通过 HTTP health endpoint 检查。
- y-websocket 通过自身 HTTP health endpoint 检查。
- frontend 在构建完成后通过本机 HTTP 页面检查。
- Nginx 在三个公开上游可用后启动，并通过统一入口检查。

应用容器设置合理的自动重启策略。停止、更新或回滚默认不得删除 volume；运维文档明确禁止将 `docker compose down -v` 用作普通重启命令。

## 文件改动

- 新增 `docker-compose.production.yml`：生产服务编排、健康检查、内部网络和 volume。
- 新增 `.env.production.example`：可直接复制的生产变量模板和 AI Key 槽位。
- 新增 `notes-frontend/Dockerfile`：Node 22 多阶段构建。
- 更新 `notes-backend/Dockerfile`：统一 Node 22、容器端口和健康检查所需条件。
- 更新 `y-websocket/Dockerfile`：统一 Node 22 和可复现依赖安装。
- 新增或更新各服务 `.dockerignore`：排除依赖、缓存、日志、测试产物和本地密钥。
- 新增 `deploy/nginx.conf`：同源 HTTP、API 和 WebSocket 反向代理。
- 新增 `scripts/deploy-production.ps1`：Windows 本地静态预检入口。
- 新增 `scripts/deploy-production.sh`：ECS 配置校验、构建、启动和健康验证。
- 更新 `notes-frontend/next.config.js` 及相关地址解析：区分浏览器同源地址与 Docker 内部 SSR 地址。
- 更新根目录 `.gitignore`：排除真实生产环境文件。
- 重写 `DEPLOYMENT.md`：ECS 首次部署、更新、日志、Atlas 数据保护、回滚、AI Key 注入和 Certbot 短证书续期步骤。
- 新增部署配置静态测试：校验公网端口、内部依赖、Node 版本、WebSocket 代理和密钥模板规则。

## 部署与更新流程

首次部署：

```text
将仓库放到 ECS
-> 复制 .env.production.example 为 .env.production
-> 填写 PUBLIC_HOST、JWT_SECRET 和 Bull Board 凭据
-> 执行 scripts/deploy-production.sh
-> 访问 https://<PUBLIC_HOST>
-> 执行验收清单
```

日常更新使用 `docker compose --env-file .env.production -f docker-compose.production.yml up -d --build` 的等价封装。脚本先验证配置，再构建镜像；构建失败不得主动停止当前容器或删除 volume。回滚时切换到已知可用 Git commit 后重新构建。

AI 功能启用流程仅包括：在 `.env.production` 填入对应 provider Key，确认 provider 选择与模型名，然后重建或重启 backend。无需修改 Compose、Nginx 或应用源码。

## 失败处理与运维边界

- 配置预检失败：不运行 Compose 变更，并显示具体变量名和修复方式。
- 镜像构建失败：保留已运行容器和持久化数据。
- 上游不健康：部署脚本返回失败，并给出按服务查看 Compose 日志的命令。
- 数据服务重启：依赖命名 volume 恢复数据；不自动清库或重建 volume。
- 应用回滚：回到旧 Git commit 后重新构建，不执行破坏性数据迁移。
- 证书续期失败：检查 Certbot timer 与证书状态，续期成功后校验并 reload Nginx。

## 验收标准

1. `docker compose ps` 显示五个容器均运行且健康。
2. `http://<PUBLIC_HOST>` 返回 301，`https://<PUBLIC_HOST>` 可打开前端页面且证书有效。
3. 用户可以注册、登录、退出并重新登录，Cookie 不产生跨域循环。
4. 可以创建、读取、更新和删除笔记。
5. 刷新浏览器及重启 Compose 后，已保存数据仍存在。
6. 两个独立浏览器会话进入同一授权笔记后，编辑内容可以通过 `/ws/yjs` 实时同步。
7. 公网无法直接连接 `3000`、`3001`、`1234`、`27017` 和 `6379`。
8. AI Key 为空不阻塞应用启动和核心功能；模板中可直接填写既有三个 provider 的 Key。
9. 部署配置静态测试、frontend 构建、backend 构建和 y-websocket 测试通过。

## 非目标

- 本阶段不购买或配置域名、商业证书和备案；使用 Certbot 公网 IP 短有效期证书。
- 本阶段不验证外部 AI provider 的真实调用质量或额度。
- 本阶段不做 Redis 集群、Yjs 多副本或跨主机高可用。
- 本阶段不引入 Kubernetes、对象存储或外部监控平台。
- 本阶段不修改业务权限、笔记模型、AI 路由算法或协作协议。
