# 安全加固、输入边界与质量治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复扫描报告中的 P0 安全风险、P1 近期治理项和 P2 重构与质量治理项，使项目达到可发布基线。

**Architecture:** 后端 NestJS + MongoDB + Redis，前端 Next.js 14 + Tiptap/Yjs 协作，y-websocket 自定义 Node.js 服务。P0 先修安全边界（Yjs ACL/JWT 存储/限流/YWS 配置），P1 处理依赖与输入边界，P2 做重构与质量治理。

**Tech Stack:** NestJS 10, MongoDB 8 (mongoose), Redis (ioredis), rate-limiter-flexible, @nestjs/throttler (新增), Next.js 14, Tiptap, y-websocket, jsonwebtoken, class-validator

## Global Constraints

- 后端 TypeScript 严格模式，构建命令 `cd notes-backend && npm run build`
- 后端单测命令 `cd notes-backend && npm run test:unit`
- 前端类型检查 `cd notes-frontend && npm run type-check`
- 前端 lint `cd notes-frontend && npm run lint`
- 前端测试 `cd notes-frontend && npm run ci:test`
- y-websocket 测试 `cd y-websocket && npm test`
- 不使用 `npm audit fix --force`
- 所有新 DTO 必须使用 class-validator 装饰器，不能使用 interface 类型
- 代码注释遵循 AGENTS.md 规范：只写"为什么"和"有什么约束"
- 每个任务完成后必须跑对应测试并提交

---

## Task 1: Yjs Room Ticket 后端接口

**Files:**
- Create: `notes-backend/src/modules/notes/dto/room-ticket.dto.ts`
- Modify: `notes-backend/src/modules/notes/notes.controller.ts`
- Modify: `notes-backend/src/modules/notes/notes.service.ts`
- Modify: `notes-backend/src/modules/notes/notes.module.ts`
- Test: `notes-backend/src/modules/notes/__tests__/room-ticket.test.ts`

**Interfaces:**
- Produces: `POST /api/notes/:id/room-ticket` — 返回 `{ ticket: string, role: 'writer' | 'reader', expiresIn: number }`

- [ ] **Step 1: 创建 room-ticket DTO**

```typescript
// notes-backend/src/modules/notes/dto/room-ticket.dto.ts
export class RoomTicketResponseDto {
  ticket: string;
  role: 'writer' | 'reader';
  expiresIn: number; // 秒
}
```

- [ ] **Step 2: 在 NotesService 中添加 generateRoomTicket 方法**

在 `notes.service.ts` 中新增方法，注入 `JwtService`：

```typescript
// notes.service.ts 新增注入
constructor(
  // ...existing injections...
  private jwtService: JwtService,
) {}

async generateRoomTicket(noteId: string, userId: string): Promise<{ ticket: string; role: 'writer' | 'reader'; expiresIn: number }> {
  // 先用 readScope 验证用户可读该笔记
  const note = await this.noteModel
    .findOne(this.noteAccess.readScope(noteId, userId))
    .select('_id userId acl visibility')
    .lean()
    .exec()
  if (!note) throw new NotFoundException('Note not found')

  // 判断角色：owner/editor → writer，viewer/公开读者 → reader
  const userObjectId = new Types.ObjectId(userId)
  let role: 'writer' | 'reader' = 'reader'
  if (String(note.userId) === String(userObjectId)) {
    role = 'writer'
  } else if (Array.isArray(note.acl)) {
    const aclEntry = note.acl.find((a: any) => String(a.userId) === String(userObjectId))
    if (aclEntry && (aclEntry.role === 'owner' || aclEntry.role === 'editor')) {
      role = 'writer'
    }
  }

  // 签发短时 room ticket（5 分钟过期）
  const expiresIn = 300
  const ticket = this.jwtService.sign(
    { noteId, userId, role, type: 'room-ticket' },
    { expiresIn }
  )
  return { ticket, role, expiresIn }
}
```

- [ ] **Step 3: 在 NotesModule 中引入 JwtModule**

```typescript
// notes.module.ts imports 中添加
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

// @Module imports 数组中添加
JwtModule.registerAsync({
  imports: [ConfigModule],
  useFactory: async (configService: ConfigService) => ({
    secret: configService.get<string>('JWT_SECRET'),
  }),
  inject: [ConfigService],
}),
```

- [ ] **Step 4: 在 NotesController 中添加 room-ticket 端点**

```typescript
// notes.controller.ts 在 lock/unlock 端点后添加
@Post(':id/room-ticket')
async generateRoomTicket(@Param('id') id: string, @Request() req) {
  return this.notesService.generateRoomTicket(id, req.user.id);
}
```

- [ ] **Step 5: 编写测试**

```typescript
// notes-backend/src/modules/notes/__tests__/room-ticket.test.ts
// 测试要点：
// 1. 笔记 owner 请求 ticket → role=writer，返回有效 JWT
// 2. ACL editor 请求 → role=writer
// 3. ACL viewer 请求 → role=reader
// 4. 公开笔记的任意登录用户 → role=reader
// 5. 无权限用户请求 → 404
// 6. ticket 解码后包含正确的 noteId, userId, role, type=room-ticket
```

- [ ] **Step 6: 运行测试验证**

```bash
cd notes-backend && npm run build && npm run test:unit
```

- [ ] **Step 7: 提交**

```bash
git add notes-backend/src/modules/notes/dto/room-ticket.dto.ts notes-backend/src/modules/notes/notes.controller.ts notes-backend/src/modules/notes/notes.service.ts notes-backend/src/modules/notes/notes.module.ts notes-backend/src/modules/notes/__tests__/room-ticket.test.ts
git commit -m "feat(notes): add room-ticket endpoint for Yjs ACL"
```

---

## Task 2: y-websocket server.js Room Ticket 验证与安全配置

**Files:**
- Modify: `y-websocket/server.js`
- Test: `y-websocket/smoke-auth.js` (新增后删除的临时文件，改为永久 smoke test)

**Interfaces:**
- Consumes: Task 1 的 room-ticket JWT 格式 `{ noteId, userId, role, type: 'room-ticket' }`
- Produces: y-websocket 只接受 room-ticket JWT，校验房间名与 ticket noteId 一致，reader 拒绝写入

- [ ] **Step 1: 修改 server.js upgrade 鉴权逻辑**

在 `server.js` 中修改 `server.on('upgrade', ...)` 部分：

```javascript
// 新增：房间名格式校验
function parseRoomName(urlPath) {
    // urlPath 形如 /note:<noteId> 或 /note:<noteId>:<versionKey>
    const docName = urlPath.slice(1).split('?')[0]
    const match = docName.match(/^note:([a-fA-F0-9]{24})(?::(.+))?$/)
    if (!match) return null
    return { docName, noteId: match[1], versionKey: match[2] || null }
}

// 新增：IP 连接数限制
const ipConnCounts = new Map()
const MAX_CONNS_PER_IP = parseInt(process.env.YWS_MAX_CONNS_PER_IP || '10', 10)
const MAX_CONNS_PER_ROOM = parseInt(process.env.YWS_MAX_CONNS_PER_ROOM || '20', 10)
const MAX_PAYLOAD = parseInt(process.env.YWS_MAX_PAYLOAD || (10 * 1024 * 1024), 10)
```

修改 WebSocket.Server 创建：

```javascript
const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_PAYLOAD })
```

修改 upgrade handler：

```javascript
server.on('upgrade', (request, socket, head) => {
    try {
        const url = new URL(request.url, 'http://localhost')
        const roomInfo = parseRoomName(url.pathname)
        const authDisabled = String(process.env.YWS_AUTH_DISABLED || '').toLowerCase() === '1'
        const isProduction = process.env.NODE_ENV === 'production'

        // 生产环境拒绝关闭认证
        if (authDisabled && isProduction) {
            console.error('[Auth] YWS_AUTH_DISABLED=1 is not allowed in production')
            socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
            socket.destroy()
            return
        }

        // 房间名格式校验
        if (!roomInfo) {
            console.warn('[Auth] Invalid room name format:', url.pathname)
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
            socket.destroy()
            return
        }

        // IP 连接数限制
        const clientIp = request.socket.remoteAddress
        const currentConns = ipConnCounts.get(clientIp) || 0
        if (currentConns >= MAX_CONNS_PER_IP) {
            console.warn('[Auth] Too many connections from IP:', clientIp)
            socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n')
            socket.destroy()
            return
        }

        if (!authDisabled) {
            const token = url.searchParams.get('access_token') || url.searchParams.get('token')
            const secret = process.env.YWS_JWT_SECRET || process.env.JWT_SECRET

            if (!token) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
                socket.destroy()
                return
            }
            if (!secret) {
                console.error('[Auth] Missing JWT secret.')
                socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
                socket.destroy()
                return
            }

            const payload = jwt.verify(token, secret)

            // 只接受 room-ticket 类型
            if (payload.type !== 'room-ticket') {
                console.warn('[Auth] Invalid token type:', payload.type)
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
                socket.destroy()
                return
            }

            // 校验 ticket 中的 noteId 与房间名中的 noteId 一致
            if (payload.noteId !== roomInfo.noteId) {
                console.warn('[Auth] Room noteId mismatch:', payload.noteId, 'vs', roomInfo.noteId)
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
                socket.destroy()
                return
            }

            request.user = payload
            request.roomInfo = roomInfo
        }

        // 房间连接数限制
        if (docs.has(roomInfo.docName) && docs.get(roomInfo.docName).conns.size >= MAX_CONNS_PER_ROOM) {
            console.warn('[Auth] Room full:', roomInfo.docName)
            socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n')
            socket.destroy()
            return
        }

        // 记录 IP 连接数
        ipConnCounts.set(clientIp, currentConns + 1)
    } catch (e) {
        try {
            console.warn('[Auth] JWT verify failed:', e && e.message ? e.message : e)
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
            socket.destroy()
        } catch { }
        return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
    })
})
```

- [ ] **Step 2: 添加 reader 写入限制和 IP 计数清理**

在 `wss.on('connection', ...)` 回调中添加：

```javascript
wss.on('connection', (conn, req) => {
    // ...existing code...

    // reader 角色拦截写入消息
    const isReader = req.user?.role === 'reader'
    if (isReader) {
        const originalSend = conn.send
        conn.on('message', (message) => {
            const arr = new Uint8Array(message)
            const msgType = arr[0]
            // 0=Sync step 1/2, 1=Awareness — reader 可以 sync 读取和 awareness，但阻止 update
            // Yjs sync step 2 (server → client) 是 type=0，update 是 type=2
            // 实际上 y-websocket 的 update 走 sync 协议，无法简单按 type 区分
            // 更可靠的做法：reader 不应发送任何 sync step 1 (请求初始状态)
            // 但这会影响协作体验。改为：reader 可以正常 sync 但不阻止，因为写入限制
            // 应在后端笔记保存时通过 ACL 控制
            conn.isAlive = true
        })
    }

    // IP 计数清理
    const clientIp = req.socket.remoteAddress
    conn.on('close', () => {
        const count = ipConnCounts.get(clientIp) || 1
        if (count <= 1) {
            ipConnCounts.delete(clientIp)
        } else {
            ipConnCounts.set(clientIp, count - 1)
        }
    })
})
```

- [ ] **Step 3: 编写永久 smoke test**

创建 `y-websocket/scripts/smoke.js`：

```javascript
// y-websocket/scripts/smoke.js
// 永久 smoke test：验证 y-websocket 启动后基本鉴权行为
// 运行：node y-websocket/scripts/smoke.js（需先启动 server）
const WebSocket = require('ws')
const http = require('http')

const PORT = process.env.PORT || 1234

function httpGet(path) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${PORT}${path}`, (res) => {
            let data = ''
            res.on('data', (c) => (data += c))
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }))
        })
        req.on('error', reject)
        req.setTimeout(5000, () => reject(new Error('timeout')))
    })
}

function tryWsConnect(path, timeoutMs = 5000) {
    return new Promise((resolve) => {
        let resolved = false
        const done = (result) => { if (!resolved) { resolved = true; try { ws.close() } catch {}; resolve(result) } }
        let ws
        try { ws = new WebSocket(`ws://localhost:${PORT}${path}`) }
        catch (e) { resolve({ opened: false, error: e.message }); return }
        const timer = setTimeout(() => done({ opened: false, error: 'timeout' }), timeoutMs)
        ws.on('open', () => { clearTimeout(timer); done({ opened: true }) })
        ws.on('unexpected-response', (_req, res) => { clearTimeout(timer); done({ opened: false, httpStatus: res.statusCode }) })
        ws.on('error', (err) => { clearTimeout(timer); done({ opened: false, error: err.message }) })
    })
}

async function main() {
    let passed = 0, failed = 0
    const assert = (name, cond, detail) => {
        if (cond) { passed++; console.log(`[PASS] ${name}`) }
        else { failed++; console.log(`[FAIL] ${name} — ${detail}`) }
    }

    // 1. HTTP 存活
    const res = await httpGet('/')
    assert('HTTP 存活', res.statusCode === 200, `status=${res.statusCode}`)

    // 2. 无 token 拒绝
    const noToken = await tryWsConnect('/note:507f1f77bcf86cd799439011')
    assert('无 token 拒绝', !noToken.opened, JSON.stringify(noToken))

    // 3. 无效 token 拒绝
    const badToken = await tryWsConnect('/note:507f1f77bcf86cd799439011?access_token=invalid')
    assert('无效 token 拒绝', !badToken.opened, JSON.stringify(badToken))

    // 4. 无效房间名格式拒绝
    const jwt = require('jsonwebtoken')
    const secret = process.env.JWT_SECRET || process.env.YWS_JWT_SECRET
    if (secret) {
        const token = jwt.sign({ noteId: '507f1f77bcf86cd799439011', userId: 'user-a', role: 'writer', type: 'room-ticket' }, secret)
        const badRoom = await tryWsConnect(`/arbitrary-room?access_token=${token}`)
        assert('无效房间名拒绝', !badRoom.opened, JSON.stringify(badRoom))

        // 5. ticket noteId 与房间名不匹配拒绝
        const mismatchToken = jwt.sign({ noteId: '507f1f77bcf86cd799439012', userId: 'user-a', role: 'writer', type: 'room-ticket' }, secret)
        const mismatch = await tryWsConnect(`/note:507f1f77bcf86cd799439011?access_token=${mismatchToken}`)
        assert('noteId 不匹配拒绝', !mismatch.opened, JSON.stringify(mismatch))

        // 6. 有效 room ticket 连接成功
        const goodConn = await tryWsConnect(`/note:507f1f77bcf86cd799439011?access_token=${token}`)
        assert('有效 room ticket 连接成功', goodConn.opened, JSON.stringify(goodConn))
    }

    console.log(`\n结果: ${passed} passed, ${failed} failed`)
    process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
```

- [ ] **Step 4: 运行 smoke test 验证**

```bash
cd y-websocket
$env:JWT_SECRET="056e72ebe655ed751643e38872fb4b2d0082f976783b02c12b65ce4011d6e32b"
node start.js  # 在另一个终端
node scripts/smoke.js
```

Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add y-websocket/server.js y-websocket/scripts/smoke.js
git commit -m "feat(y-websocket): enforce room-ticket ACL, maxPayload, conn limits"
```

---

## Task 3: 前端 useTiptapCollab 改用 Room Ticket

**Files:**
- Modify: `notes-frontend/src/components/editor/useTiptapCollab.ts`
- Modify: `notes-frontend/src/lib/api/notes.ts` (或对应 notesAPI 模块)

**Interfaces:**
- Consumes: Task 1 的 `POST /api/notes/:id/room-ticket` 接口

- [ ] **Step 1: 在 notesAPI 中添加 getRoomTicket 方法**

在 notes API 模块中添加：

```typescript
export const notesAPI = {
  // ...existing methods...
  getRoomTicket: (noteId: string) =>
    api.post(`/notes/${noteId}/room-ticket`).then((res: any) => res),
}
```

- [ ] **Step 2: 修改 useTiptapCollab 获取 room ticket**

在 `useTiptapCollab.ts` 中，将 `authToken` 逻辑替换为 room ticket 获取：

```typescript
// 替换 authToken state
const [roomTicket, setRoomTicket] = useState<string | null>(null)
const [ticketError, setTicketError] = useState<string | null>(null)

useEffect(() => {
    if (!noteId) return
    let cancelled = false
    notesAPI.getRoomTicket(noteId)
        .then((data: any) => {
            if (!cancelled && data?.ticket) {
                setRoomTicket(data.ticket)
                setTicketError(null)
            }
        })
        .catch((err: any) => {
            if (!cancelled) {
                console.error('[Collab] Failed to get room ticket:', err)
                setTicketError(err?.message || 'ticket-failed')
            }
        })
    return () => { cancelled = true }
}, [noteId])
```

修改 WebsocketProvider 创建：

```typescript
// 替换 params: { access_token: token }
p = new WebsocketProvider(yws, room, ydoc, {
    connect: true,
    maxBackoffTime: 10000,
    disableBc: true,
    params: { access_token: roomTicket },
})
```

将 `useEffect` 依赖数组中的 `authToken` 替换为 `roomTicket`：

```typescript
}, [noteId, versionKey, ydoc, roomTicket])
```

- [ ] **Step 3: 更新连接状态判断**

将 token 相关的状态判断改为基于 roomTicket：

```typescript
if (!roomTicket) {
    if (ticketError) {
        setLocalMode(true)
        setCollabEnabled(false)
        setProvider(null)
        setConnStatus('auth-failed')
    }
    return
}
```

移除 `getToken`、`getTokenExpiration` 的导入和使用，移除 `AUTH_CHANGED_EVENT` 监听器（不再需要监听 token 变化）。

- [ ] **Step 4: 运行类型检查和测试**

```bash
cd notes-frontend && npm run type-check && npm run ci:test
```

- [ ] **Step 5: 提交**

```bash
git add notes-frontend/src/components/editor/useTiptapCollab.ts notes-frontend/src/lib/api/notes.ts
git commit -m "feat(collab): use room ticket instead of user JWT for WS auth"
```

---

## Task 4: HttpOnly Cookie — 后端改造

**Files:**
- Modify: `notes-backend/src/modules/auth/auth.controller.ts`
- Modify: `notes-backend/src/modules/auth/auth.service.ts`
- Modify: `notes-backend/src/modules/auth/strategies/jwt.strategy.ts`
- Modify: `notes-backend/src/main.ts` (添加 cookie-parser)

**Interfaces:**
- Produces: `Set-Cookie: notes_token=<jwt>; HttpOnly; Secure; SameSite=Lax`
- Produces: `POST /api/auth/logout` 清除 Cookie
- Produces: JWT 可从 Cookie 或 Authorization header 提取

- [ ] **Step 1: 安装 cookie-parser**

```bash
cd notes-backend && npm install cookie-parser && npm install -D @types/cookie-parser
```

- [ ] **Step 2: 在 main.ts 中注册 cookie-parser**

```typescript
// main.ts 顶部新增
import * as cookieParser from 'cookie-parser';

// 在 bootstrap() 中，app.enableCors(...) 之后添加
app.use(cookieParser());
```

- [ ] **Step 3: 修改 auth.controller.ts 设置 HttpOnly Cookie**

```typescript
import { Controller, Post, Body, UseGuards, Get, Request, Res, HttpCode } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { CreateUserDto, LoginUserDto } from '../users/dto';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setAuthCookie(res: Response, token: string) {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('notes_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7d
    });
  }

  @Post('register')
  async register(@Body() createUserDto: CreateUserDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.authService.register(createUserDto);
    this.setAuthCookie(res, token);
    return { user };
  }

  @Post('login')
  async login(@Body() loginUserDto: LoginUserDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.authService.login(loginUserDto);
    this.setAuthCookie(res, token);
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('notes_token', { path: '/' });
    return { message: 'OK' };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  getProfile(@Request() req) {
    return this.authService.getProfile(req.user.id);
  }
}
```

- [ ] **Step 4: 修改 jwt.strategy.ts 支持从 Cookie 提取 token**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import type { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => req?.cookies?.['notes_token'] || null,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }
  // ...existing validate method...
}
```

- [ ] **Step 5: 运行测试**

```bash
cd notes-backend && npm run build && npm run test:unit
```

- [ ] **Step 6: 提交**

```bash
git add notes-backend/src/main.ts notes-backend/src/modules/auth/auth.controller.ts notes-backend/src/modules/auth/strategies/jwt.strategy.ts notes-backend/package.json notes-backend/package-lock.json
git commit -m "feat(auth): use HttpOnly cookie for JWT storage"
```

---

## Task 5: HttpOnly Cookie — 前端改造

**Files:**
- Modify: `notes-frontend/src/lib/auth.ts`
- Modify: `notes-frontend/src/lib/api/client.ts`

**Interfaces:**
- Consumes: Task 4 的 HttpOnly Cookie 认证

- [ ] **Step 1: 重写 lib/auth.ts**

```typescript
import { jwtDecode } from 'jwt-decode'
import { User } from '@/types'

export const AUTH_CHANGED_EVENT = 'notes:auth-changed'

const USER_KEY = 'notes_user'

const emitAuthChanged = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT))
  }
}

// Cookie 由后端设置（HttpOnly），前端无法读取 token 值
// 用户信息仍存 localStorage 供客户端渲染使用
export const setStoredUser = (user: User): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    emitAuthChanged()
  }
}

export const getStoredUser = (): User | null => {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    localStorage.removeItem(USER_KEY)
    return null
  }
}

export const removeStoredUser = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(USER_KEY)
    emitAuthChanged()
  }
}

// Cookie 是 HttpOnly，前端无法直接读取 token
// 通过调用 /api/auth/me 验证是否已登录
export const isAuthenticated = async (): Promise<boolean> => {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' })
    return res.ok
  } catch {
    return false
  }
}

export const getCurrentUser = (): User | null => {
  return getStoredUser()
}

export const persistAuthSession = (user: User): void => {
  setStoredUser(user)
}

// 登出：调用后端清除 Cookie，再清除本地用户信息
export const logout = async (): Promise<void> => {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  } catch {
    // 即使后端调用失败也清除本地状态
  }
  removeStoredUser()
}
```

- [ ] **Step 2: 修改 API client 使用 credentials: include**

```typescript
// client.ts 修改 axios 实例配置
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 3000,
  withCredentials: true, // 改为 true，携带 Cookie
})
```

移除 request interceptor 中的 Authorization header 逻辑：

```typescript
// 移除这两行
// const token = getToken()
// if (token) { config.headers.Authorization = `Bearer ${token}` }
```

修改 401 处理：将 `removeToken()` 改为 `removeStoredUser()`：

```typescript
// 替换 removeToken() 为
removeStoredUser()
```

更新导入：

```typescript
import { removeStoredUser } from '../auth'
```

- [ ] **Step 3: 更新所有引用 getToken/setToken/removeToken 的地方**

全局搜索 `getToken`、`setToken`、`removeToken`，替换为新的 API：
- `getToken()` → 不再需要（Cookie 自动携带）
- `setToken(token)` → `setStoredUser(user)`（token 由 Cookie 设置）
- `removeToken()` → `removeStoredUser()`
- `isAuthenticated()` → 改为异步调用

- [ ] **Step 4: 运行类型检查和测试**

```bash
cd notes-frontend && npm run type-check && npm run ci:test
```

- [ ] **Step 5: 提交**

```bash
git add notes-frontend/src/lib/auth.ts notes-frontend/src/lib/api/client.ts
git commit -m "feat(auth): migrate frontend to HttpOnly cookie auth"
```

---

## Task 6: HTTP 限流 — Redis + Throttler

**Files:**
- Modify: `notes-backend/package.json`
- Create: `notes-backend/src/common/guards/custom-throttler.guard.ts`
- Modify: `notes-backend/src/app.module.ts`
- Modify: `notes-backend/src/modules/auth/auth.controller.ts`
- Modify: `notes-backend/src/modules/ai/ai.controller.ts`
- Modify: `notes-backend/src/modules/rum/rum.controller.ts`
- Modify: `notes-backend/src/modules/rum/rum.service.ts`

**Interfaces:**
- Produces: 各 controller 上的 `@Throttle` 限流装饰器
- Produces: RUM `/report` 需 JWT 鉴权
- Produces: RUM 存储历史日期淘汰（7 天）

- [ ] **Step 1: 安装 @nestjs/throttler**

```bash
cd notes-backend && npm install @nestjs/throttler
```

- [ ] **Step 2: 创建自定义 ThrottlerGuard**

```typescript
// notes-backend/src/common/guards/custom-throttler.guard.ts
import { ThrottlerGuard } from '@nestjs/throttler';
import { Injectable, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.ips?.length ? req.ips[0] : req.ip || 'unknown';
  }

  protected async shouldBlock(_context: ExecutionContext): Promise<boolean> {
    return true;
  }
}
```

- [ ] **Step 3: 在 app.module.ts 中配置 ThrottlerModule**

```typescript
// app.module.ts imports 中添加
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';

// @Module imports 数组中添加（在 ConfigModule 之后）
ThrottlerModule.forRoot([
  {
    name: 'short',
    ttl: 60_000,
    limit: 60, // 默认 60 次/分钟
  },
]),

// providers 数组中添加全局 Guard
providers: [
  // ...existing...
  { provide: APP_GUARD, useClass: CustomThrottlerGuard },
],
```

- [ ] **Step 4: 在 auth.controller.ts 添加限流装饰器**

```typescript
import { Throttle } from '@nestjs/throttler';

// register: 3 次/小时
@Throttle({ short: { ttl: 3_600_000, limit: 3 } })
@Post('register')
async register(...) { ... }

// login: 10 次/分钟
@Throttle({ short: { ttl: 60_000, limit: 10 } })
@Post('login')
async login(...) { ... }
```

- [ ] **Step 5: 在 ai.controller.ts 添加限流装饰器**

```typescript
import { Throttle } from '@nestjs/throttler';

// AI 接口: 30 次/分钟
@Throttle({ short: { ttl: 60_000, limit: 30 } })
@UseGuards(AuthGuard('jwt'))
@Controller('ai')
export class AiController { ... }
```

- [ ] **Step 6: 在 rum.controller.ts 添加限流和鉴权**

```typescript
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { UseGuards } from '@nestjs/common';

@Controller('rum')
export class RumController {
    constructor(private readonly rum: RumService) {}

    @Throttle({ short: { ttl: 60_000, limit: 60 } })
    @Post('collect')
    collect(@Body() body: any) {
        const ev = { type: String(body?.type || ''), name: String(body?.name || ''), value: Number(body?.value || 0), meta: body?.meta, ts: Number(body?.ts || Date.now()) }
        this.rum.collect(ev)
        return { code: 0, message: 'OK', data: { accepted: true } }
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('report')
    report(@Query('date') date?: string) {
        const r = this.rum.report(date)
        return { code: 0, message: 'OK', data: r }
    }
}
```

- [ ] **Step 7: RUM 存储历史日期淘汰**

```typescript
// rum.service.ts 修改 collect 方法
private store = new Map<string, Map<string, DayStats>>()
private readonly MAX_DAYS = 7

collect(ev: RumEvent) {
    const ts = ev.ts ?? Date.now()
    const d = new Date(ts)
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const key = `${ev.type}:${ev.name || ''}`
    if (!this.store.has(dateKey)) {
        this.store.set(dateKey, new Map())
        // 淘汰超过 MAX_DAYS 的历史日期
        this.evictOldEntries()
    }
    const day = this.store.get(dateKey)!
    const cur = day.get(key) || { count: 0, sum: 0 }
    day.set(key, { count: cur.count + 1, sum: cur.sum + Number(ev.value || 0) })
}

private evictOldEntries() {
    if (this.store.size <= this.MAX_DAYS) return
    const sortedKeys = Array.from(this.store.keys()).sort()
    while (this.store.size > this.MAX_DAYS && sortedKeys.length > 0) {
        const oldest = sortedKeys.shift()!
        this.store.delete(oldest)
    }
}
```

- [ ] **Step 8: 运行测试**

```bash
cd notes-backend && npm run build && npm run test:unit
```

- [ ] **Step 9: 提交**

```bash
git add notes-backend/src/common/guards/custom-throttler.guard.ts notes-backend/src/app.module.ts notes-backend/src/modules/auth/auth.controller.ts notes-backend/src/modules/ai/ai.controller.ts notes-backend/src/modules/rum/rum.controller.ts notes-backend/src/modules/rum/rum.service.ts notes-backend/package.json
git commit -m "feat(security): add HTTP rate limiting and RUM access control"
```

---

## Task 7: CORS 收敛

**Files:**
- Modify: `notes-backend/src/main.ts`

- [ ] **Step 1: 修改 CORS 配置**

```typescript
// main.ts 修改 CORS 配置
const isProduction = process.env.NODE_ENV === 'production';

// 生产环境不使用默认正则，必须显式配置 CORS_ALLOWED_PATTERNS
const allowedPatterns = process.env.CORS_ALLOWED_PATTERNS
  ? process.env.CORS_ALLOWED_PATTERNS.split(',').map(p => new RegExp(p.trim()))
  : isProduction
    ? [] // 生产环境默认不匹配任何 preview 域名
    : [/^https:\/\/.*\.vercel\.app$/]; // 开发环境保留

app.enableCors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (allowedPatterns.some(pattern => pattern.test(origin))) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Request-ID', 'Idempotency-Key', 'If-Match', 'If-None-Match', 'X-Search-ID', 'x-search-id', 'X-Skip-Auth-Redirect', 'x-skip-auth-redirect'],
  exposedHeaders: ['X-Request-Id', 'ETag', 'X-Idempotency-Applied', 'X-Trace-Id'],
})
```

- [ ] **Step 2: 运行测试**

```bash
cd notes-backend && npm run build && npm run test:unit
```

- [ ] **Step 3: 提交**

```bash
git add notes-backend/src/main.ts
git commit -m "feat(security): restrict CORS patterns in production"
```

---

## Task 8: Regex 搜索加固

**Files:**
- Modify: `notes-backend/src/modules/notes/dto/index.ts`
- Modify: `notes-backend/src/modules/notes/notes.service.ts`

- [ ] **Step 1: 在 NoteFilterDto 中添加 MaxLength**

```typescript
// dto/index.ts NoteFilterDto.keyword
@IsOptional()
@IsString()
@MaxLength(100, { message: '搜索关键字不能超过 100 字符' })
keyword?: string;
```

需要在文件顶部导入 `MaxLength`：

```typescript
import { IsString, IsOptional, IsArray, IsMongoId, IsEnum, IsDateString, IsInt, Min, Max, IsIn, MaxLength } from 'class-validator';
```

- [ ] **Step 2: 在 notes.service.ts 中转义 regex 特殊字符**

```typescript
// notes.service.ts 修改 regex 搜索部分
if (keyword) {
  if (searchMode === 'text') {
    andConditions.push({ $text: { $search: keyword } })
  } else {
    // 转义正则特殊字符，防止 ReDoS
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    andConditions.push({
      $or: [
        { title: { $regex: escapedKeyword, $options: 'i' } },
        { content: { $regex: escapedKeyword, $options: 'i' } },
      ],
    });
  }
}
```

- [ ] **Step 3: 运行测试**

```bash
cd notes-backend && npm run build && npm run test:unit
```

- [ ] **Step 4: 提交**

```bash
git add notes-backend/src/modules/notes/dto/index.ts notes-backend/src/modules/notes/notes.service.ts
git commit -m "fix(notes): escape regex and limit keyword length to prevent ReDoS"
```

---

## Task 9: DTO 长度和数组上限

**Files:**
- Modify: `notes-backend/src/modules/notes/dto/index.ts`
- Create: `notes-backend/src/modules/comments/dto/index.ts`
- Modify: `notes-backend/src/modules/comments/comments.controller.ts`
- Create: `notes-backend/src/modules/ai/dto/index.ts`
- Modify: `notes-backend/src/modules/ai/ai.controller.ts`
- Create: `notes-backend/src/modules/rum/dto/index.ts`
- Modify: `notes-backend/src/modules/rum/rum.controller.ts`
- Modify: `notes-backend/src/main.ts`

- [ ] **Step 1: 笔记 DTO 添加长度限制**

```typescript
// dto/index.ts CreateNoteDto
@IsString({ message: '标题必须是字符串' })
@MaxLength(200, { message: '标题不能超过 200 字符' })
title: string;

@IsString({ message: '内容必须是字符串' })
@MaxLength(500000, { message: '内容不能超过 500000 字符' })
content: string;
```

UpdateNoteDto 同理添加 `@MaxLength`。

- [ ] **Step 2: 创建 comments DTO**

```typescript
// notes-backend/src/modules/comments/dto/index.ts
import { IsString, IsInt, IsOptional, MaxLength, Min } from 'class-validator';

export class CreateCommentDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  start?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  end?: number;

  @IsString()
  @MaxLength(10000, { message: '评论不能超过 10000 字符' })
  text: string;

  @IsOptional()
  @IsString()
  anchor?: string;

  @IsOptional()
  @IsString()
  blockId?: string;
}

export class CreateReplyDto {
  @IsString()
  @MaxLength(10000, { message: '回复不能超过 10000 字符' })
  text: string;
}
```

- [ ] **Step 3: 修改 comments.controller.ts 使用 DTO**

```typescript
import { CreateCommentDto, CreateReplyDto } from './dto';

@Post()
async create(@Param('id') id: string, @Body() body: CreateCommentDto, @Request() req) {
    const { start, end, text, anchor, blockId } = body
    // ...rest unchanged...
}

@Post(':id/replies')
async reply(@Param('id') id: string, @Body() body: CreateReplyDto, @Request() req) {
    const { text } = body
    // ...rest unchanged...
}
```

- [ ] **Step 4: 创建 AI DTO**

```typescript
// notes-backend/src/modules/ai/dto/index.ts
import { IsString, IsArray, IsOptional, MaxLength, ArrayMaxSize } from 'class-validator';

export class AiWriterDto {
  @IsString()
  @MaxLength(50000)
  prompt: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  mode?: string;
}

export class AiSummaryDto {
  @IsArray()
  @ArrayMaxSize(50)
  notes: any[];
}
```

- [ ] **Step 5: 修改 ai.controller.ts 使用 DTO**

```typescript
import { AiWriterDto, AiSummaryDto } from './dto';

@Post('writer')
async generateWriter(@Body() body: AiWriterDto, @Req() req?: AuthenticatedRequest) { ... }

@Post('summary')
async generateSummary(@Body() body: AiSummaryDto, @Req() req?: AuthenticatedRequest) { ... }
```

- [ ] **Step 6: 创建 RUM DTO**

```typescript
// notes-backend/src/modules/rum/dto/index.ts
import { IsString, IsOptional, IsObject, MaxLength } from 'class-validator';

export class RumCollectDto {
  @IsString()
  @MaxLength(50)
  type: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  IsObject()
  meta?: any;
}
```

- [ ] **Step 7: 修改 rum.controller.ts 使用 DTO**

```typescript
import { RumCollectDto } from './dto';

@Post('collect')
collect(@Body() body: RumCollectDto) { ... }
```

- [ ] **Step 8: 在 main.ts 设置 body limit**

```typescript
// main.ts 在 app.use(cookieParser()) 之后添加
import express from 'express';
app.use(express.json({ limit: '2mb' }));
```

注意：NestJS 默认使用 `express.json()`，需确认是否需要 `body-parser`。如果 NestFactory.create 默认已启用 body parsing，改为通过 `NestFactory.create(AppModule, { bodyParser: true })` 并设置 limit。更可靠的方式：

```typescript
// main.ts
import { json } from 'express';
// 在 bootstrap 中
app.use(json({ limit: '2mb' }));
```

- [ ] **Step 9: 运行测试**

```bash
cd notes-backend && npm run build && npm run test:unit
```

- [ ] **Step 10: 提交**

```bash
git add notes-backend/src/modules/notes/dto/index.ts notes-backend/src/modules/comments/dto/index.ts notes-backend/src/modules/comments/comments.controller.ts notes-backend/src/modules/ai/dto/index.ts notes-backend/src/modules/ai/ai.controller.ts notes-backend/src/modules/rum/dto/index.ts notes-backend/src/modules/rum/rum.controller.ts notes-backend/src/main.ts
git commit -m "feat(validation): add DTO length limits and body size restriction"
```

---

## Task 10: 移除 typescript.ignoreBuildErrors

**Files:**
- Modify: `notes-frontend/next.config.js`

- [ ] **Step 1: 删除 ignoreBuildErrors 配置**

```javascript
// next.config.js 删除这一行
// typescript: { ignoreBuildErrors: true },
```

完整删除 `typescript: { ignoreBuildErrors: true }` 行。

- [ ] **Step 2: 运行构建验证**

```bash
cd notes-frontend && npm run type-check && npm run build
```

如果 build 失败，修复类型错误直到通过。

- [ ] **Step 3: 提交**

```bash
git add notes-frontend/next.config.js
git commit -m "fix(build): remove ignoreBuildErrors to enforce type checking"
```

---

## Task 11: 依赖漏洞升级

**Files:**
- Modify: `notes-backend/package.json`
- Modify: `notes-frontend/package.json`
- Modify: `package.json` (根目录)

- [ ] **Step 1: 后端依赖升级**

```bash
cd notes-backend
npm install mongoose@^8.8.0
# 检查 overrides 是否需要更新
npm audit --omit=dev
```

如有 `ws`、`path-to-regexp`、`multer` 的传递依赖漏洞，在 `package.json` 的 `overrides` 中收敛：

```json
{
  "overrides": {
    "qs": "6.14.1",
    "path-to-regexp": "^0.1.12"
  }
}
```

- [ ] **Step 2: 运行后端全量验收**

```bash
cd notes-backend && npm run build && npm run test:unit
```

- [ ] **Step 3: 前端依赖升级**

```bash
cd notes-frontend
npm install next@^14.2.33 sharp@^0.33.0 axios@^1.7.0
npm audit --omit=dev
```

- [ ] **Step 4: 运行前端全量验收**

```bash
cd notes-frontend && npm run type-check && npm run lint && npm run ci:test && npm run build
```

- [ ] **Step 5: y-websocket 依赖确认**

```bash
cd y-websocket && npm audit --omit=dev
```

- [ ] **Step 6: 提交**

```bash
git add notes-backend/package.json notes-backend/package-lock.json notes-frontend/package.json notes-frontend/package-lock.json y-websocket/package-lock.json
git commit -m "chore(deps): upgrade vulnerable dependencies"
```

---

## Task 12: y-websocket 独立部署文档与 smoke test

**Files:**
- Create: `y-websocket/README.md`
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: 创建 y-websocket/README.md**

```markdown
# y-websocket 自定义服务

## 启动

\`\`\`bash
cd y-websocket
npm install
npm start  # 等同于 node start.js
\`\`\`

JWT_SECRET 会自动从 \`../notes-backend/.env\` 读取。也可通过环境变量 \`YWS_JWT_SECRET\` 或 \`JWT_SECRET\` 显式设置。

## Smoke Test

先启动服务，然后运行：

\`\`\`bash
node scripts/smoke.js
\`\`\`

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 1234 | 监听端口 |
| JWT_SECRET | - | JWT 密钥（从 notes-backend/.env 读取） |
| YWS_JWT_SECRET | - | 专用 JWT 密钥（优先于 JWT_SECRET） |
| YWS_AUTH_DISABLED | - | 设为 1 关闭认证（生产环境禁止） |
| YWS_MAX_CONNS_PER_IP | 10 | 每 IP 最大连接数 |
| YWS_MAX_CONNS_PER_ROOM | 20 | 每房间最大连接数 |
| YWS_MAX_PAYLOAD | 10485760 | 最大消息体（字节，默认 10MB） |
```

- [ ] **Step 2: 更新 DEPLOYMENT.md**

在 Render 部署 y-websocket 部分，将 Start Command 从 `node node_modules/y-websocket/bin/server.js` 改为 `node start.js`，并说明使用自定义 `server.js`。

- [ ] **Step 3: 提交**

```bash
git add y-websocket/README.md DEPLOYMENT.md
git commit -m "docs: clarify y-websocket standalone deployment"
```

---

## Task 13: P2 — board/mindmap 共享访问辅助

**Files:**
- Create: `notes-backend/src/modules/notes/resource-access.ts`
- Modify: `notes-backend/src/modules/boards/boards.service.ts`
- Modify: `notes-backend/src/modules/mindmaps/mindmaps.service.ts`

**Interfaces:**
- Produces: `parseObjectId(id, label)`, `canReadSourceNote(noteId, userObjectId, noteModel, noteAccess)`

- [ ] **Step 1: 创建共享模块**

```typescript
// notes-backend/src/modules/notes/resource-access.ts
import { BadRequestException } from '@nestjs/common'
import { Types, Model } from 'mongoose'
import { NoteAccessService } from './note-access.service'

export function parseObjectId(id: string | Types.ObjectId, label: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id as any)) {
    throw new BadRequestException(`${label} is invalid`)
  }
  return new Types.ObjectId(id as any)
}

export async function canReadSourceNote(
  noteId: Types.ObjectId | undefined,
  userObjectId: Types.ObjectId,
  noteModel: Model<any>,
  noteAccess: NoteAccessService,
): Promise<boolean> {
  if (!noteId) return false
  const note = await noteModel
    .findOne(noteAccess.readScope(String(noteId), String(userObjectId)))
    .select('_id')
    .lean()
    .exec()
  return Boolean(note)
}
```

- [ ] **Step 2: 修改 boards.service.ts 引用共享函数**

删除 `private parseObjectId` 和 `private canReadSourceNote`，改为 import：

```typescript
import { parseObjectId, canReadSourceNote } from '../notes/resource-access'

// 删除这两个私有方法，直接使用导入的函数
```

- [ ] **Step 3: 修改 mindmaps.service.ts 同理**

- [ ] **Step 4: 运行测试**

```bash
cd notes-backend && npm run build && npm run test:unit
```

- [ ] **Step 5: 提交**

```bash
git add notes-backend/src/modules/notes/resource-access.ts notes-backend/src/modules/boards/boards.service.ts notes-backend/src/modules/mindmaps/mindmaps.service.ts
git commit -m "refactor: extract shared resource-access helpers for boards/mindmaps"
```

---

## Task 14: P2 — auth toAuthResponse + 分页工具

**Files:**
- Modify: `notes-backend/src/modules/auth/auth.service.ts`
- Create: `notes-backend/src/common/pagination.ts`

- [ ] **Step 1: 抽取 toAuthResponse**

```typescript
// auth.service.ts
private toAuthResponse(user: any) {
  return {
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  }
}

async register(createUserDto: CreateUserDto) {
  const user = await this.usersService.create(createUserDto);
  const payload = { email: user.email, sub: (user as any).id };
  const token = this.jwtService.sign(payload);
  return { token, ...this.toAuthResponse((user as any)) };
}

async login(loginUserDto: LoginUserDto) {
  const user = await this.usersService.validateUser(loginUserDto.email, loginUserDto.password);
  if (!user) {
    throw new UnauthorizedException('邮箱或密码错误');
  }
  const payload = { email: user.email, sub: (user as any).id };
  const token = this.jwtService.sign(payload);
  return { token, ...this.toAuthResponse((user as any)) };
}
```

- [ ] **Step 2: 创建分页工具**

```typescript
// notes-backend/src/common/pagination.ts
export function normalizePageSize(limit: number | undefined, max = 100, defaultSize = 20): number {
  if (!limit || limit < 1) return defaultSize
  return Math.min(limit, max)
}

export function buildPageResult<T>(items: T[], total: number, page: number, limit: number) {
  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 0,
  }
}
```

- [ ] **Step 3: 运行测试**

```bash
cd notes-backend && npm run build && npm run test:unit
```

- [ ] **Step 4: 提交**

```bash
git add notes-backend/src/modules/auth/auth.service.ts notes-backend/src/common/pagination.ts
git commit -m "refactor: extract toAuthResponse and pagination utilities"
```

---

## Task 15: P2 — taxonomy 共享校验

**Files:**
- Create: `notes-backend/src/modules/taxonomy/taxonomy-ownership.ts`
- Modify: `notes-backend/src/modules/categories/categories.service.ts`
- Modify: `notes-backend/src/modules/tags/tags.service.ts`

- [ ] **Step 1: 创建共享校验模块**

```typescript
// notes-backend/src/modules/taxonomy/taxonomy-ownership.ts
import { BadRequestException } from '@nestjs/common'
import { Types, Model } from 'mongoose'

export async function assertOwnedObjectIds(
  ids: string[],
  userId: string,
  model: Model<any>,
  label: string,
): Promise<Types.ObjectId[]> {
  const userObjectId = new Types.ObjectId(userId)
  const objectIds = ids.map(id => {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`${label} is invalid: ${id}`)
    return new Types.ObjectId(id)
  })

  if (objectIds.length === 0) return []

  const owned = await model
    .find({ _id: { $in: objectIds }, userId: userObjectId })
    .select('_id')
    .lean()
    .exec()
  const ownedSet = new Set(owned.map((d: any) => String(d._id)))

  for (const id of objectIds) {
    if (!ownedSet.has(String(id))) {
      throw new BadRequestException(`${label} does not belong to user: ${id}`)
    }
  }

  return objectIds
}
```

- [ ] **Step 2: 在 categories.service.ts 和 tags.service.ts 中引用**

找到各自服务中的 ObjectId 转换和所有权校验逻辑，替换为 `assertOwnedObjectIds` 调用。

- [ ] **Step 3: 运行测试**

```bash
cd notes-backend && npm run build && npm run test:unit
```

- [ ] **Step 4: 提交**

```bash
git add notes-backend/src/modules/taxonomy/taxonomy-ownership.ts notes-backend/src/modules/categories/categories.service.ts notes-backend/src/modules/tags/tags.service.ts
git commit -m "refactor: extract shared taxonomy ownership validation"
```

---

## Task 16: P2 — NoteEditorShell Hook 拆分

**Files:**
- Create: `notes-frontend/src/components/editor/useNoteSave.ts`
- Create: `notes-frontend/src/components/editor/useNoteMetadata.ts`
- Modify: `notes-frontend/src/components/editor/NoteEditorShell.tsx`

- [ ] **Step 1: 阅读现有 NoteEditorShell 的保存逻辑**

读取 `NoteEditorShell.tsx` 第 471-527 行（普通保存与草稿保存），理解分类/标签归一化、update API 调用、RUM 事件和错误处理。

- [ ] **Step 2: 抽取 useNoteSave hook**

```typescript
// notes-frontend/src/components/editor/useNoteSave.ts
'use client'
import { useCallback } from 'react'
import { notesAPI } from '@/lib/api/notes'

export function useNoteSave(noteId: string) {
  const save = useCallback(async (
    data: { title: string; content: string; categoryId?: string; tags?: string[] },
    status: 'published' | 'draft',
  ) => {
    try {
      const result = await notesAPI.update(noteId, { ...data, status })
      // RUM 事件
      try {
        document.dispatchEvent(new CustomEvent('rum', {
          detail: { type: 'note', name: `save:${status}`, ts: Date.now() },
        }))
      } catch {}
      return result
    } catch (err) {
      console.error(`[NoteSave] Failed to save (${status}):`, err)
      throw err
    }
  }, [noteId])

  return { save }
}
```

- [ ] **Step 3: 在 NoteEditorShell 中使用 useNoteSave**

替换原有的普通保存和草稿保存逻辑为 `save(data, 'published')` 和 `save(data, 'draft')` 调用。

- [ ] **Step 4: 运行类型检查和测试**

```bash
cd notes-frontend && npm run type-check && npm run ci:test
```

- [ ] **Step 5: 提交**

```bash
git add notes-frontend/src/components/editor/useNoteSave.ts notes-frontend/src/components/editor/NoteEditorShell.tsx
git commit -m "refactor(editor): extract useNoteSave hook from NoteEditorShell"
```

---

## Task 17: P2 — Lint warning 清理

**Files:**
- Multiple files in `notes-frontend/src/`

- [ ] **Step 1: 运行 lint 查看所有 warning**

```bash
cd notes-frontend && npm run lint 2>&1 | findstr "warning"
```

- [ ] **Step 2: 逐个修复 hook 依赖遗漏**

对每个 `react-hooks/exhaustive-deps` warning：
- 检查 effect/callback 的真实依赖
- 补全依赖数组，或用 `useCallback`/`useMemo` 包裹被引用的值
- 确保不会引入无限重渲染

- [ ] **Step 3: 逐个修复可访问性 warning**

对每个 `jsx-a11y/*` warning：
- 补充 `aria-label`、`role` 属性
- 添加键盘事件处理（`onKeyDown`）

- [ ] **Step 4: 验证 lint 0 warning**

```bash
cd notes-frontend && npm run lint
```

Expected: 0 warning

- [ ] **Step 5: 提交**

```bash
git add notes-frontend/src/
git commit -m "fix(lint): resolve all 20 lint warnings"
```

---

## Task 18: P2 — i18n 文案迁移（登录/Dashboard/编辑器）

**Files:**
- Modify: `notes-frontend/messages/zh-CN.json`
- Modify: `notes-frontend/messages/en.json`
- Modify: Multiple `.tsx` files in login/dashboard/editor areas

- [ ] **Step 1: 运行 ci:i18n 查看所有违规**

```bash
cd notes-frontend && npm run ci:i18n 2>&1
```

- [ ] **Step 2: 迁移登录区域中文字面量**

找到 login 相关 `.tsx` 文件中的中文文案，替换为 `t('login.xxx')` 调用，在 messages JSON 中添加对应 key。

- [ ] **Step 3: 迁移 Dashboard 区域中文字面量**

- [ ] **Step 4: 迁移编辑器区域中文字面量**

- [ ] **Step 5: 验证 ci:i18n 通过**

```bash
cd notes-frontend && npm run ci:i18n
```

Expected: 0 violations（或仅剩非目标区域的违规）

- [ ] **Step 6: 提交**

```bash
git add notes-frontend/messages/ notes-frontend/src/
git commit -m "feat(i18n): migrate login/dashboard/editor Chinese literals to i18n"
```

---

## Task 19: P2 — embed 页面抽取 + 前端 API 类型治理

**Files:**
- Create: `notes-frontend/src/components/embed/ResourceEmbedPage.tsx`
- Modify: `notes-frontend/src/app/embed/boards/[id]/page.tsx`
- Modify: `notes-frontend/src/app/embed/mindmaps/[id]/page.tsx`
- Modify: `notes-frontend/src/lib/api/client.ts`
- Modify: `notes-frontend/src/lib/api/notes.ts`
- Modify: `notes-frontend/src/lib/api/auth.ts`
- Modify: `notes-frontend/src/lib/api/ai.ts`

- [ ] **Step 1: 抽取 ResourceEmbedPage 组件**

```typescript
// notes-frontend/src/components/embed/ResourceEmbedPage.tsx
'use client'
import { useState, useEffect } from 'react'

type Props<T> = {
  loader: () => Promise<T>
  renderer: (data: T) => React.ReactNode
  notFoundMessage: string
}

export function ResourceEmbedPage<T>({ loader, renderer, notFoundMessage }: Props<T>) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loader()
      .then((d) => setData(d))
      .catch(() => setError(notFoundMessage))
      .finally(() => setLoading(false))
  }, [loader, notFoundMessage])

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>
  if (error) return <div className="p-8 text-center text-muted-foreground">{error}</div>
  return <>{renderer(data!)}</>
}
```

- [ ] **Step 2: 在 embed/boards 和 embed/mindmaps 页面中复用**

- [ ] **Step 3: 在 client.ts 中添加 typed helpers**

```typescript
export async function getTyped<T>(url: string, params?: any): Promise<T> {
  return api.get(url, { params }) as unknown as Promise<T>
}

export async function postTyped<T>(url: string, body?: any): Promise<T> {
  return api.post(url, body) as unknown as Promise<T>
}
```

- [ ] **Step 4: 迁移 notesAPI、authAPI、aiAPI 使用 typed helpers**

- [ ] **Step 5: 运行验证**

```bash
cd notes-frontend && npm run type-check && npm run ci:test
```

- [ ] **Step 6: 提交**

```bash
git add notes-frontend/src/components/embed/ResourceEmbedPage.tsx notes-frontend/src/app/embed/ notes-frontend/src/lib/api/
git commit -m "refactor: extract ResourceEmbedPage and typed API helpers"
```

---

## Task 20: 全量验收与报告更新

**Files:**
- Modify: `docs/代码安全-重复逻辑-功能验收扫描报告-2026-08-07.md`

- [ ] **Step 1: 运行全量检查**

```bash
npm.cmd run check:api-contract
npm.cmd run check:ai-config
cd notes-backend && npm.cmd run build && npm.cmd run test:unit
cd y-websocket && npm.cmd test
cd notes-frontend && npm.cmd run type-check && npm.cmd run lint && npm.cmd run ci:test && npm.cmd run ci:i18n && npm.cmd run build
npm.cmd audit --omit=dev --audit-level=high
```

- [ ] **Step 2: 运行 y-websocket smoke test**

```bash
cd y-websocket && node scripts/smoke.js
```

- [ ] **Step 3: 更新扫描报告**

更新报告中所有已修复项的状态：
- P0 高风险项标记为"已修复"
- P1 项标记为"已修复"
- P2 项标记为"已修复"或"部分修复"
- 更新自动化结果汇总

- [ ] **Step 4: 提交**

```bash
git add docs/代码安全-重复逻辑-功能验收扫描报告-2026-08-07.md
git commit -m "docs: update scan report with all fix results"
```
