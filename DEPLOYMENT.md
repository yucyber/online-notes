# ECS 单机 HTTPS 部署（公网 IP）

Compose 运行 Next.js、NestJS、y-websocket、Redis 和 Nginx 五个容器，MongoDB 使用外部 Atlas。只有 Nginx 发布 80/443：HTTP 统一 301 跳转 HTTPS，业务、Cookie 和 WebSocket 都通过 TLS 传输。

## 准备 ECS

使用 Ubuntu 22.04 / 24.04，建议至少 4 GB 内存，预留镜像构建和 Redis AOF 磁盘空间。安装 Git、OpenSSL、Docker Engine、Compose 插件和 Certbot，按照 [Docker Ubuntu 官方安装说明](https://docs.docker.com/engine/install/ubuntu/) 操作。运行 sudo docker version 和 sudo docker compose version 确认安装完成。Compose 需支持 [up --wait --wait-timeout](https://docs.docker.com/reference/cli/docker/compose/up/)。

安全组网站放行 80 和 443，SSH 22 仅放行自己的管理 IP；不要开放 3000、3001、1234 或 6379。Docker 发布端口可能绕过 UFW，因此也要检查安全组。Atlas IP Access List 仅放行 ECS 公网 IP `47.97.243.59/32`，不要开放为全网访问。

1Panel 可选；本配置由 Compose Nginx 占用 80/443，如果已有 1Panel OpenResty，需要先处理端口冲突。将仓库克隆或上传至服务器固定目录，例如 `/opt/online-notes`。不要上传本地 `node_modules`、`.next`、证书或开发环境密钥。以下命令在仓库根目录执行。

## 首次启动

```bash
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 32
openssl rand -hex 16
nano .env.production
```

`PUBLIC_HOST` 保持为 `47.97.243.59`，不带协议、端口或路径；`MONGODB_URI` 填写 Atlas `mongodb+srv://` 连接串。两次随机输出分别填入 `JWT_SECRET` 和 `BULL_BOARD_PASSWORD`，`BULL_BOARD_USERNAME` 可用 `admin`。模板使用不加引号、等号两侧无空格的格式；AI Key 保持空值。真实连接串和密钥只保存在权限为 600 的 `.env.production`，不要提交。

首次启动前确认 Certbot 已签发公网 IP 短有效期证书，且宿主机存在以下文件：

- `/etc/letsencrypt/live/47.97.243.59/fullchain.pem`
- `/etc/letsencrypt/live/47.97.243.59/privkey.pem`

Compose 将整个 `/etc/letsencrypt` 只读挂载给 Nginx，以便 `live` 中的符号链接仍能解析；证书和私钥不进入仓库或镜像。

```bash
sudo bash scripts/deploy-production.sh
```

脚本校验变量，先构建所有镜像，再启动、等待健康、刷新网关上游地址并探测 API 和登录页。失败时按提示查看服务日志，修正后重跑。不要打印完整 docker compose config，它可能包含密钥。

打开 `https://47.97.243.59`，完成：

- 注册、登录、刷新、退出、重新登录。
- 笔记创建、修改、刷新读取和删除。
- 两个独立浏览器登录测试账户，授权协作后验证双向编辑；`wss://47.97.243.59/ws/yjs/` WebSocket 返回 101。
- 停止后重跑部署脚本，确认已保存笔记仍存在。
- 从另一台机器确认 3000、3001、1234、6379 不能直连，并确认访问 HTTP 80 返回到同路径 HTTPS 的 301。

停止命令：sudo docker compose --env-file .env.production -f docker-compose.production.yml stop。

后端 health 只证明进程响应，仍需业务验收。Yjs 当前是内存房间，持久化验收只涵盖已保存到 Atlas 的笔记；重启前尚未保存的协作状态不保证恢复。空 Key 时派生 AI 任务可能失败重试，本阶段不验收 AI 结果。

## 填写 AI Key

模板包含 SiliconFlow、B.AI、AgentRouter 的模型、URL 和容量变量。先填写 SILICONFLOW_API_KEY 以启用默认 text、embedding、rerank；BAI_API_KEY 用于 fallback，AR_API_KEY 用于专家任务。模型权限、额度以账户实际情况为准。

修改 .env.production 后重建后端容器，无需重新构建镜像：

```bash
sudo docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-deps --force-recreate backend
sudo docker compose --env-file .env.production -f docker-compose.production.yml exec nginx nginx -s reload
```

普通 restart 不会重新注入环境变量。也可重跑完整部署脚本并等待全部健康。Key 只注入 backend，不进入浏览器包。

## 更新、日志和回滚

```bash
sudo bash scripts/deploy-production.sh
sudo docker compose --env-file .env.production -f docker-compose.production.yml ps
sudo docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=100 backend
```

配置或构建失败保留旧容器；启动更新失败可能已有部分服务被替换，应恢复已知可用 Git commit 后重跑。记录每次部署 commit；代码回滚不回滚 Atlas 数据。Redis 命名 volume 使用固定 online-notes 项目名。不要用 `down -v` 或 `volume prune` 更新项目。

## 数据保护

MongoDB 数据位于 Atlas，不存在本地 MongoDB 容器、volume 或容器内备份命令。数据库备份、恢复演练和保留周期在 Atlas 中管理；恢复前先在隔离集群验证。Redis AOF 位于 `redis-data` volume，Yjs 内存房间不在备份范围内。

## HTTPS 证书续期

公网 IP 证书是 Certbot 管理的短有效期证书，不能按传统长周期证书运维。保持 Certbot 自动续期 timer 启用，并定期检查 `sudo certbot certificates` 与 `sudo systemctl status certbot.timer`。用 `sudo certbot renew --dry-run` 验证续期链路；续期成功后必须执行 `sudo docker compose --env-file .env.production -f docker-compose.production.yml exec -T nginx nginx -t` 和 `nginx -s reload`，使容器读取宿主机只读挂载的新证书。建议将这两步配置为 Certbot deploy hook，并监控续期失败。

当前 Compose 固定 `CLIENT_URL=https://${PUBLIC_HOST}`、`COOKIE_SECURE=true` 和 `NEXT_PUBLIC_YWS_URL=wss://${PUBLIC_HOST}/ws/yjs`。更换公网入口时需要同步证书路径和 Nginx `server_name`，然后重新构建 frontend 并重建 backend。

## 本地预检和验证边界

Node 22 环境在根目录 npm ci 后运行：

```powershell
./scripts/deploy-production.ps1
./scripts/deploy-production.ps1 -CheckEnv
```

第一条检查静态结构与空 Key 模板，第二条还检查真实环境文件，不输出密钥。ECS Bash 脚本不需要宿主机 Node。

2026-09-09：ECS 当前以五个容器连接外部 Atlas，Nginx 通过 Certbot IP 证书提供 HTTPS；Docker Hub 不稳定，因此 Node、Redis 和 Nginx 基础镜像统一使用 `m.daocloud.io/docker.io/library/` 前缀。当前电脑没有 Docker，本地只能完成静态检查和应用构建；证书续期与公网双浏览器验收仍应在 ECS 定期执行。
