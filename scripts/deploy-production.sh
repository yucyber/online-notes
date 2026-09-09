#!/usr/bin/env bash
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[[ -f .env.production ]] || { echo 'Copy .env.production.example to .env.production first.' >&2; exit 1; }
# 不 source 环境文件：配置是数据，不能执行其中的 shell 代码。
value() { sed -n "s/^$1=//p" .env.production | tr -d '\r'; }
host="$(value PUBLIC_HOST)"
jwt="$(value JWT_SECRET)"
password="$(value BULL_BOARD_PASSWORD)"
username="$(value BULL_BOARD_USERNAME)"
[[ "$host" =~ ^[a-zA-Z0-9.-]+$ && "$host" != *YOUR_* && "$host" != *CHANGE_ME* ]] || { echo 'Invalid PUBLIC_HOST' >&2; exit 1; }
[[ "$jwt" =~ ^[a-fA-F0-9]{64,}$ ]] || { echo 'JWT_SECRET needs at least 64 random hexadecimal characters' >&2; exit 1; }
[[ "$password" =~ ^[a-fA-F0-9]{32,}$ ]] || { echo 'BULL_BOARD_PASSWORD needs at least 32 random hexadecimal characters' >&2; exit 1; }
[[ "$username" =~ ^[a-zA-Z0-9_-]{3,64}$ ]] || { echo 'Invalid BULL_BOARD_USERNAME' >&2; exit 1; }
unset jwt password
chmod 600 .env.production
compose=(docker compose --env-file .env.production -f docker-compose.production.yml)
trap 'echo "Deployment failed. Inspect: docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=100 <service>" >&2' ERR
"${compose[@]}" config --quiet
# 先完成所有镜像构建，再更新已有容器；绝不删除 Redis volume。
"${compose[@]}" build
"${compose[@]}" up -d --wait --wait-timeout 300
# Nginx 缓存上游地址，容器更新后重新加载以解析新 IP。
"${compose[@]}" exec -T nginx nginx -t
"${compose[@]}" exec -T nginx nginx -s reload
"${compose[@]}" exec -T nginx wget -q --no-check-certificate -O /dev/null https://127.0.0.1/api/health
"${compose[@]}" exec -T nginx wget -q --no-check-certificate -O /dev/null https://127.0.0.1/login
"${compose[@]}" ps
echo "Services ready: https://$host — complete the browser acceptance checklist."
