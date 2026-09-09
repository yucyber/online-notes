# 邮箱验证码注册 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用 QQ SMTP 和 Redis 为所有新账号增加一次性邮箱验证码注册，同时保持已有账号登录不变。

**Architecture:** `MailService` 只负责 SMTP 发送，`EmailVerificationService` 负责验证码生成、摘要、限流与原子消费，`AuthService` 负责把验证码验证接入用户创建事务边界。前端注册页先请求验证码再提交注册，登录页移除会绕过验证的自动注册回退。

**Tech Stack:** NestJS 10、ioredis 5、nodemailer、class-validator、Node test runner、Next.js 16、React 18、React Hook Form、Zod、Jest/Testing Library、Docker Compose。

## Global Constraints

- 只有新账号注册强制邮箱验证码；已有账号登录、Cookie、数据和权限不变。
- 验证码为 6 位数字，有效期 10 分钟，60 秒发送冷却，最多失败 5 次，成功后立即失效。
- Redis 只保存验证码 HMAC 摘要，不保存明文；邮箱统一 trim 并转为小写。
- SMTP 授权码只存在 ECS `/opt/online-notes/.env.production`，不得进入 Git、响应或日志。
- 登录页不得通过失败回退自动创建账号。
- 复杂业务原因、权限边界和失败降级使用简洁中文注释；直观代码不添加复述型注释。

---

## File Structure

- Create `notes-backend/src/modules/auth/dto/email-verification.dto.ts`: 发送验证码与注册验证码字段验证。
- Create `notes-backend/src/modules/auth/mail.service.ts`: QQ SMTP transporter 和纯文本验证码邮件。
- Create `notes-backend/src/modules/auth/email-verification.service.ts`: Redis key、HMAC、冷却、失败次数与原子消费。
- Modify `notes-backend/src/modules/users/dto/index.ts`: `CreateUserDto` 增加验证码字段，并导出发送 DTO。
- Modify `notes-backend/src/modules/users/users.service.ts`: 创建用户前剥离非 schema 的验证码字段，增加无异常邮箱存在性查询。
- Modify `notes-backend/src/modules/auth/auth.service.ts`: 发送与消费验证码后创建用户。
- Modify `notes-backend/src/modules/auth/auth.controller.ts`: 暴露 `POST /auth/email-code`。
- Modify `notes-backend/src/modules/auth/auth.module.ts`: 注册两个新 service。
- Create `notes-backend/test/email-verification.test.ts`: 后端核心安全行为回归测试。
- Modify `notes-backend/test/users-profile.test.ts`: 更新 `AuthService` 构造与注册参数。
- Modify `notes-backend/package.json` and lockfile: 增加 `nodemailer` 与类型依赖。
- Modify `notes-frontend/src/types/index.ts`: 区分登录和注册请求类型。
- Modify `notes-frontend/src/lib/api/auth.ts` and `notes-frontend/src/lib/api.ts`: 发送验证码 API 与新注册类型。
- Modify `notes-frontend/src/app/(auth)/register/page.tsx`: 验证码控件、倒计时与提交。
- Modify `notes-frontend/src/app/(auth)/login/page.tsx`: 删除自动注册回退。
- Create `notes-frontend/__tests__/email-verification-registration.spec.tsx`: 注册交互与登录绕过回归测试。
- Modify `.env.production.example` and `docker-compose.production.yml`: 声明并注入 SMTP 配置。
- Modify `DEPLOYMENT.md`: 添加 QQ SMTP 配置、重建和验收命令。

---

### Task 1: 验证码 DTO 与邮件发送边界

**Files:**
- Create: `notes-backend/src/modules/auth/dto/email-verification.dto.ts`
- Modify: `notes-backend/src/modules/users/dto/index.ts`
- Create: `notes-backend/src/modules/auth/mail.service.ts`
- Modify: `notes-backend/src/modules/auth/auth.module.ts`
- Modify: `notes-backend/package.json`
- Modify: `notes-backend/package-lock.json`
- Test: `notes-backend/test/email-verification.test.ts`

**Interfaces:**
- Produces: `SendEmailCodeDto { email: string }`、`CreateUserDto.verificationCode: string`、`MailService.sendVerificationCode(email: string, code: string): Promise<void>`。

- [ ] **Step 1: 写失败测试**

在 `email-verification.test.ts` 用 `ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })` 断言邮箱会规范化、验证码只接受 `/^\d{6}$/`；用假的 transporter 断言邮件收件人、主题和正文包含验证码，并断言缺少 SMTP 配置时抛出 `ServiceUnavailableException`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix notes-backend run test:unit`

Expected: FAIL，提示 DTO 或 `MailService` 模块不存在。

- [ ] **Step 3: 实现最小 DTO 和 MailService**

DTO 使用 `@Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)`、`@IsEmail()`；验证码使用 `@Matches(/^\d{6}$/, { message: '请输入6位数字验证码' })`。`MailService` 通过 `ConfigService` 读取六个 SMTP 变量并创建：

```ts
createTransport({
  host,
  port: Number(port),
  secure: String(secure) === 'true',
  auth: { user, pass: password },
})
```

发送内容固定为“你的在线笔记注册验证码是：${code}，10 分钟内有效。”；捕获底层异常后只记录错误类型并抛出 `ServiceUnavailableException('验证码邮件暂时无法发送，请稍后重试')`。

- [ ] **Step 4: 运行测试与构建**

Run: `npm --prefix notes-backend run test:unit`

Run: `npm --prefix notes-backend run build`

Expected: PASS；TypeScript 无错误。

- [ ] **Step 5: 提交**

提交文件限定为本 Task，提交信息：`feat(auth): 增加验证码邮件发送服务`。

### Task 2: Redis 验证码生命周期

**Files:**
- Create: `notes-backend/src/modules/auth/email-verification.service.ts`
- Modify: `notes-backend/src/modules/auth/auth.module.ts`
- Test: `notes-backend/test/email-verification.test.ts`

**Interfaces:**
- Consumes: `MailService.sendVerificationCode(email, code)`、全局 `REDIS_CLIENT`、`JWT_SECRET`。
- Produces: `EmailVerificationService.sendCode(email: string): Promise<void>` 与 `consumeCode(email: string, code: string): Promise<void>`。

- [ ] **Step 1: 为安全行为写失败测试**

使用实现 `get/set/eval/del` 的内存 Redis fake 和 MailService spy，覆盖：生成恰好 6 位数字；Redis value 不含明文；TTL 为 600 秒；冷却 key 为 60 秒；同邮箱大小写/空格归一；错误 4 次仍可重试，第 5 次后失效；成功后第二次消费失败。

- [ ] **Step 2: 运行单测确认失败**

Run: `npm --prefix notes-backend run test:unit`

Expected: FAIL，提示 `EmailVerificationService` 不存在。

- [ ] **Step 3: 实现生成、摘要和发送冷却**

使用 `randomInt(0, 1_000_000).toString().padStart(6, '0')`，摘要为 `createHmac('sha256', jwtSecret).update(normalizedEmail + ':' + code).digest('hex')`。Redis key 固定：

```ts
auth:email-code:${normalizedEmail}
auth:email-code-cooldown:${normalizedEmail}
```

验证码 value 为 JSON `{ "digest": string, "attempts": number }`。先以 `SET key 1 EX 60 NX` 抢占冷却，再写 600 秒验证码并发邮件；发送失败时删除两类 key，允许用户重试。

- [ ] **Step 4: 用 Lua 实现原子消费**

`consumeCode` 计算候选摘要后通过单次 `EVAL`：key 不存在则失败；摘要一致则删除并成功；不一致则加一，达到 5 次删除，否则保留原 TTL 后写回。所有失败状态统一抛出 `BadRequestException('验证码无效或已过期')`。

- [ ] **Step 5: 运行测试与构建**

Run: `npm --prefix notes-backend run test:unit`

Run: `npm --prefix notes-backend run build`

Expected: 所有新增生命周期测试 PASS。

- [ ] **Step 6: 提交**

提交信息：`feat(auth): 增加 Redis 邮箱验证码校验`。

### Task 3: 将验证码接入注册 API

**Files:**
- Modify: `notes-backend/src/modules/users/users.service.ts`
- Modify: `notes-backend/src/modules/auth/auth.service.ts`
- Modify: `notes-backend/src/modules/auth/auth.controller.ts`
- Modify: `notes-backend/test/email-verification.test.ts`
- Modify: `notes-backend/test/users-profile.test.ts`

**Interfaces:**
- Consumes: `EmailVerificationService.sendCode/consumeCode`。
- Produces: `POST /api/auth/email-code` 和要求 `verificationCode` 的 `POST /api/auth/register`。

- [ ] **Step 1: 写注册集成失败测试**

断言 controller 将邮箱交给 `sendCode`；`AuthService.register` 先调用 `consumeCode` 再调用 `usersService.create({ email, password })`，不会把 `verificationCode` 保存到 MongoDB；验证码失败时不创建用户；登录方法不受影响。

- [ ] **Step 2: 运行单测确认失败**

Run: `npm --prefix notes-backend run test:unit`

Expected: FAIL，现有 register 未消费验证码且构造函数签名不匹配。

- [ ] **Step 3: 实现接口编排**

在 controller 添加：

```ts
@Throttle({ short: { ttl: 60_000, limit: 5 } })
@Post('email-code')
@HttpCode(200)
async sendEmailCode(@Body() dto: SendEmailCodeDto) {
  await this.authService.sendEmailCode(dto.email)
  return { message: '如果该邮箱可用于注册，验证码邮件将很快送达' }
}
```

`AuthService.register` 解构 `{ verificationCode, ...userInput }`，先消费验证码，再将 `userInput` 交给 `UsersService.create`。增加 `UsersService.existsByEmail(email): Promise<boolean>` 供发送阶段判断，发送接口对已注册邮箱直接返回相同通用结果。

- [ ] **Step 4: 运行后端完整测试与构建**

Run: `npm --prefix notes-backend run test:unit`

Run: `npm --prefix notes-backend run build`

Expected: PASS；现有 Cookie、profile 与登录测试不回归。

- [ ] **Step 5: 提交**

提交信息：`feat(auth): 强制注册校验邮箱验证码`。

### Task 4: 前端注册验证码交互与登录安全回归

**Files:**
- Modify: `notes-frontend/src/types/index.ts`
- Modify: `notes-frontend/src/lib/api/auth.ts`
- Modify: `notes-frontend/src/lib/api.ts`
- Modify: `notes-frontend/src/app/(auth)/register/page.tsx`
- Modify: `notes-frontend/src/app/(auth)/login/page.tsx`
- Create: `notes-frontend/__tests__/email-verification-registration.spec.tsx`

**Interfaces:**
- Produces: `RegisterCredentials extends LoginCredentials { verificationCode: string }` 和 `authAPI.sendEmailCode(email: string)`。

- [ ] **Step 1: 写前端失败测试**

mock `@/lib/api` 与 Next router，断言注册页有“验证码”输入和“获取验证码”按钮；邮箱非法时不请求；合法邮箱请求 `{ email }` 后显示 `60秒后重试`；提交请求包含 `verificationCode` 且不含 `confirmPassword`。登录页 401 时只显示错误且 `register` mock 从未调用。

- [ ] **Step 2: 运行目标测试确认失败**

Run: `npm --prefix notes-frontend test -- --runInBand __tests__/email-verification-registration.spec.tsx`

Expected: FAIL，找不到验证码控件或发送 API，登录仍触发注册回退。

- [ ] **Step 3: 实现 API 类型和注册交互**

`authAPI.sendEmailCode` 调用 `postTyped<{ message: string }>('/auth/email-code', { email })`。注册 schema 增加 `verificationCode: z.string().regex(/^\d{6}$/, '请输入6位数字验证码')`。按钮点击时先 `form.trigger('email')`，成功后设置 `remainingSeconds=60`；`useEffect` 每秒递减并在卸载时清除 timer。发送中、倒计时中或注册中禁用按钮。

- [ ] **Step 4: 删除登录自动注册回退**

移除 `register` import 及 catch 中的注册调用；保留 `auto=1` 的自动登录能力，但登录失败只显示“账号不存在或密码错误，请先确认账号已注册”，并保留页面现有注册链接。

- [ ] **Step 5: 运行前端验证**

Run: `npm --prefix notes-frontend test -- --runInBand __tests__/email-verification-registration.spec.tsx`

Run: `npm --prefix notes-frontend run type-check`

Run: `npm --prefix notes-frontend run build`

Expected: 新测试 PASS；类型检查和 production build PASS。

- [ ] **Step 6: 提交**

提交信息：`feat(frontend): 增加邮箱验证码注册流程`。

### Task 5: 生产配置与部署文档

**Files:**
- Modify: `.env.production.example`
- Modify: `docker-compose.production.yml`
- Modify: `DEPLOYMENT.md`
- Test: `scripts/check-production.mjs`

**Interfaces:**
- Consumes: backend 环境变量 `SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_USER/SMTP_PASSWORD/MAIL_FROM`。

- [ ] **Step 1: 扩展生产配置检查**

让 `scripts/check-production.mjs` 断言 Compose backend 显式声明六个 SMTP 变量，且示例 env 包含这些键但 `SMTP_PASSWORD` 为空占位；真实邮箱和授权码不得写入测试夹具。

- [ ] **Step 2: 运行检查确认失败**

Run: `node scripts/check-production.mjs`

Expected: FAIL，报告缺少 SMTP 配置。

- [ ] **Step 3: 更新示例和 Compose**

在 `.env.production.example` 增加：

```dotenv
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=
```

Compose backend 使用 `${SMTP_HOST:?SMTP_HOST required}` 等插值，其中 `SMTP_PASSWORD` 必填；`MAIL_FROM` 直接通过 `env_file` 读取，避免含空格和尖括号时 YAML 插值歧义。

- [ ] **Step 4: 写清服务器部署步骤**

`DEPLOYMENT.md` 说明把 QQ 邮箱与授权码写入 `/opt/online-notes/.env.production`、执行 `chmod 600`，再运行：

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build backend frontend nginx
docker compose --env-file .env.production -f docker-compose.production.yml ps -a
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=100 backend
```

- [ ] **Step 5: 验证配置**

Run: `node scripts/check-production.mjs`

Run: `docker compose --env-file .env.production.example -f docker-compose.production.yml config --quiet`

Expected: 静态检查 PASS；Compose 仅可能因示例必填秘密为空而按文档预期拒绝启动，不出现 YAML 格式错误。

- [ ] **Step 6: 提交**

提交信息：`docs(deploy): 补充 QQ SMTP 生产配置`。

### Task 6: 全量回归与 ECS 验收

**Files:**
- Modify only if verification reveals a defect: files owned by Tasks 1-5.

**Interfaces:**
- Produces: 可部署且经真实 QQ SMTP 验证的完整注册流程。

- [ ] **Step 1: 本地全量回归**

Run: `npm --prefix notes-backend run test:unit`

Run: `npm --prefix notes-backend run build`

Run: `npm --prefix notes-frontend run lint`

Run: `npm --prefix notes-frontend run type-check`

Run: `npm --prefix notes-frontend test -- --runInBand`

Run: `npm --prefix notes-frontend run build`

Run: `node scripts/check-production.mjs`

Expected: 全部退出码为 0；不降低既有测试覆盖阈值。

- [ ] **Step 2: 安全扫描工作区差异**

Run: `git diff --check`

Run: `git grep -n -E 'SMTP_PASSWORD=.+|授权码.{0,10}[A-Za-z0-9]{12,}' -- ':!docs/superpowers/plans/*' ':!docs/superpowers/specs/*'`

Expected: 无 whitespace error；无真实 SMTP 授权码。

- [ ] **Step 3: 用户在 ECS 写入秘密并部署**

由用户在服务器本地编辑 `/opt/online-notes/.env.production` 填写 QQ 邮箱和授权码，不经聊天发送秘密。上传新部署包后按 Task 5 命令重建服务。

- [ ] **Step 4: 真实验收**

访问 `https://47.97.243.59/register`，用一个未注册邮箱获取验证码并注册。确认：邮件送达；正确验证码成功；同一验证码再次注册失败；错误验证码不会创建账号；原有账号仍可登录；backend 日志不包含验证码和授权码。

- [ ] **Step 5: 最终提交（仅在验收修复产生改动时）**

提交信息按实际范围使用 `fix(auth): 修复邮箱验证码上线验收问题`，正文记录根因与关键改动。
