import { test } from 'node:test'
import assert = require('node:assert/strict')
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// 架构守卫（2026-09-10）：
// 后端曾存在 src/ws/jwt-ws.adapter.ts —— 它依赖 verifyClient 做鉴权，但仓库里没有任何
// @WebSocketGateway，NestJS 永远不会调用 WsAdapter.create()，因此该适配器是不可达死代码
// （真实后端 /ws 探测为 HTTP 404，见 docs/metrics/raw/m7-ws-protection.json S0）。
// 更危险的是：一旦有人"顺手加个空网关"把它挂上，由于 ws 在 noServer 模式下不会调用
// verifyClient，会得到一个未鉴权且全体用户共享限流桶的端点。
// 协作 WebSocket 由独立的 y-websocket 服务承载（票据经 POST /api/notes/:id/room-ticket 签发）。
// 本测试用于防止"写了但没接上"的通道被再次引入。

const backendRoot = resolve(__dirname, '..')
const srcDir = join(backendRoot, 'src')

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) return collectTsFiles(fullPath)
    return entry.endsWith('.ts') ? [fullPath] : []
  })
}

test('未挂载的 WebSocket 适配器及其目录已下线', () => {
  assert.equal(
    existsSync(join(srcDir, 'ws', 'jwt-ws.adapter.ts')),
    false,
    'src/ws/jwt-ws.adapter.ts 不应重新出现：它没有网关驱动，永远不可达',
  )
  assert.equal(existsSync(join(srcDir, 'ws')), false, 'src/ws 目录应已随适配器一并删除')
})

test('src 下不得出现网关声明或 WebSocket 适配器接线', () => {
  const files = collectTsFiles(srcDir)
  assert.ok(files.length > 50, `扫描到的源文件过少（${files.length}），疑似路径错误`)

  const offenders = files.filter((file) => {
    const text = readFileSync(file, 'utf8')
    return text.includes('@WebSocketGateway') || text.includes('useWebSocketAdapter')
  })

  assert.deepEqual(
    offenders.map((file) => file.replace(backendRoot, '')),
    [],
    '接入 WebSocket 网关前必须先补齐 upgrade 阶段的鉴权（参考 y-websocket/room-auth.js），否则会开出一个未鉴权端点',
  )
})

test('已下线 WebSocket 的直接依赖不再声明，且 package-lock 与 package.json 同步', () => {
  const pkg = JSON.parse(readFileSync(join(backendRoot, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(join(backendRoot, 'package-lock.json'), 'utf8'))

  for (const dep of ['@nestjs/platform-ws', '@nestjs/websockets', 'rate-limiter-flexible']) {
    assert.equal(pkg.dependencies?.[dep], undefined, `${dep} 不应再作为后端直接依赖`)
  }

  // 复刻 npm ci 的同步校验：package.json 的每个直接依赖都必须在 lock 根部有相同的版本范围，
  // 否则 Dockerfile 里的 `npm ci --omit=dev` 会直接失败。
  const lockRootDeps = lock.packages[''].dependencies as Record<string, string>
  for (const [name, spec] of Object.entries(pkg.dependencies as Record<string, string>)) {
    assert.equal(lockRootDeps[name], spec, `${name} 在 package-lock.json 中不同步，请运行 npm install`)
  }
})

test('协作 WebSocket 的票据绑定校验仍然存在（跨笔记读防护）', () => {
  const ywsRoot = resolve(backendRoot, '..', 'y-websocket')
  if (!existsSync(ywsRoot)) return // 独立部署 notes-backend 时跳过

  const roomAuth = join(ywsRoot, 'room-auth.js')
  assert.equal(existsSync(roomAuth), true, 'y-websocket/room-auth.js 缺失：票据与房间绑定校验被移除')

  const serverSource = readFileSync(join(ywsRoot, 'server.js'), 'utf8')
  assert.ok(
    serverSource.includes("require('./room-auth')"),
    'server.js 必须继续使用 room-auth 校验 upgrade 请求',
  )
  assert.ok(
    serverSource.includes('authorizeUpgrade'),
    'server.js 必须在 upgrade 阶段调用 authorizeUpgrade',
  )
})
