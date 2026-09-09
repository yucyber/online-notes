# ECS 部署实施计划

目标：提供公网 IP HTTPS 验证所需的五容器 Compose，使用外部 Atlas，并保留 AI Key 运行时注入。

- [x] 补三个 Node 22 镜像、构建排除规则及 Redis 数据卷，MongoDB 使用外部 Atlas。
- [x] 配置 Nginx，保留 Next assistant/ai route handler，关闭流式缓冲；Yjs 转发剥离公开路径前缀。
- [x] 配置内部 SERVER_API_URL、HTTPS CLIENT_URL、Secure Cookie 和 WSS 公开地址。
- [x] 配置 Certbot IP 证书只读挂载、80 到 443 跳转及短证书续期说明。
- [x] Node、Redis 和 Nginx 基础镜像同步为 ECS 可访问的 `m.daocloud.io/docker.io/library/` 前缀。
- [x] 增加生产环境模板、无密钥输出的预检与部署脚本。
- [x] 更新 ECS 手册，说明首次安装、更新、Key 注入、备份与验证边界。
- [x] 运行 Cookie 回归、配置校验、后端/前端构建与 Yjs 测试；Docker 不可用时记录远程待验收项。

验证结果：2026-09-08 的 backend build、frontend standalone build、frontend type-check、Cookie 测试 1/1、Yjs 测试 6/6、静态配置检查和 Bash 语法检查通过；2026-09-09 ECS 已运行五容器 + Atlas 和 HTTPS。后续仍需持续验证 Certbot 自动续期。

设计修正依据：现有 `/api/assistant` 和 `/api/ai` 有 Next route handler；HTTPS 生产环境必须启用 Secure Cookie 和 WSS；依赖 Atlas `$vectorSearch`，不能使用本地 MongoDB；Docker bridge 不发布端口并不隔离宿主机管理员，且 backend 需要外网访问 Atlas 和 AI。
