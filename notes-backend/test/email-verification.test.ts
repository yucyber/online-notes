import { BadRequestException, Logger, ServiceUnavailableException, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { SendEmailCodeDto } from '../src/modules/auth/dto/email-verification.dto'
import { MailService } from '../src/modules/auth/mail.service'
import { CreateUserDto } from '../src/modules/users/dto'
import { createHmac } from 'node:crypto'
import Redis from 'ioredis'
import { EmailVerificationService } from '../src/modules/auth/email-verification.service'

Logger.overrideLogger(false)

const validationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
})

async function validate<T extends object>(metatype: new () => T, value: unknown) {
  return validationPipe.transform(value, {
    type: 'body',
    metatype,
  }) as Promise<T>
}

const smtpConfig = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'mailer@example.com',
  SMTP_PASSWORD: 'app-password',
  MAIL_FROM: 'Online Notes <mailer@example.com>',
}

test('发送验证码邮箱会去除首尾空白并转为小写', async () => {
  const dto = await validate(SendEmailCodeDto, { email: '  User@Example.COM  ' })

  assert.equal(dto.email, 'user@example.com')
})

test('注册邮箱会去除首尾空白并转为小写', async () => {
  const dto = await validate(CreateUserDto, {
    email: '  User@Example.COM  ',
    password: 'secret1',
    verificationCode: '012345',
  })

  assert.equal(dto.email, 'user@example.com')
})

test('注册验证码只接受 6 位数字', async () => {
  const valid = await validate(CreateUserDto, {
    email: 'user@example.com',
    password: 'secret1',
    verificationCode: '012345',
  })

  assert.equal(valid.verificationCode, '012345')

  for (const verificationCode of [undefined, '12345', '1234567', '12345a', '１２３４５６']) {
    await assert.rejects(
      validate(CreateUserDto, {
        email: 'user@example.com',
        password: 'secret1',
        verificationCode,
      }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException)
        const response = error.getResponse() as { message: string[] }
        assert.ok(response.message.includes('请输入6位数字验证码'))
        return true
      },
    )
  }
})

test('验证码邮件包含固定收件人、主题和正文', async () => {
  const sentMessages: Record<string, unknown>[] = []
  const transporter = {
    sendMail: async (message: Record<string, unknown>) => {
      sentMessages.push(message)
    },
  }
  const service = new MailService(new ConfigService(smtpConfig), transporter)

  await service.sendVerificationCode('user@example.com', '012345')

  assert.deepEqual(sentMessages, [{
    from: smtpConfig.MAIL_FROM,
    to: 'user@example.com',
    subject: '在线笔记注册验证码',
    text: '你的在线笔记注册验证码是：012345，10 分钟内有效。',
  }])
})

test('缺少 SMTP 配置时仅拒绝发送验证码', async () => {
  const service = new MailService(new ConfigService({}))

  await assert.rejects(
    service.sendVerificationCode('user@example.com', '012345'),
    ServiceUnavailableException,
  )
})

test('底层发送失败时只暴露统一服务不可用错误', async () => {
  const transporter = {
    sendMail: async () => {
      throw new Error('SMTP_PASSWORD=do-not-leak')
    },
  }
  const service = new MailService(new ConfigService(smtpConfig), transporter)

  await assert.rejects(
    service.sendVerificationCode('user@example.com', '012345'),
    (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException)
      assert.equal(error.message, '验证码邮件暂时无法发送，请稍后重试')
      assert.doesNotMatch(error.message, /do-not-leak/)
      return true
    },
  )
})

class EmailCodeRedisFake {
  readonly entries = new Map<string, { value: string; expiresAt: number }>()
  now = 0
  evalCalls = 0

  private entry(key: string) {
    const entry = this.entries.get(key)
    if (entry && entry.expiresAt <= this.now) this.entries.delete(key)
    return this.entries.get(key)
  }

  async get(key: string) {
    return this.entry(key)?.value ?? null
  }

  async set(key: string, value: string, mode: string, ttl: number, condition?: string) {
    assert.equal(mode, 'EX')
    assert.ok(Number.isInteger(ttl) && ttl > 0)
    assert.ok(condition === undefined || condition === 'NX')
    if (condition === 'NX' && this.entry(key)) return null
    this.entries.set(key, { value, expiresAt: this.now + ttl * 1000 })
    return 'OK'
  }

  async del(...keys: string[]) {
    return keys.reduce((count, key) => count + Number(this.entries.delete(key)), 0)
  }

  // fake 验证服务与 Redis 的调用契约；下方真实 Redis 用例执行 Lua，避免把 fake 的行为当作脚本证明。
  async eval(_script: string, keyCount: number, key: string, digest: string) {
    this.evalCalls++
    assert.equal(keyCount, 1)
    const entry = this.entry(key)
    if (!entry) return 0
    const state = JSON.parse(entry.value)
    if (state.digest === digest) {
      this.entries.delete(key)
      return 1
    }
    state.attempts++
    if (state.attempts >= 5) this.entries.delete(key)
    else entry.value = JSON.stringify(state)
    return 0
  }
}

const codeKey = (email: string) => `auth:email-code:${email}`
const cooldownKey = (email: string) => `auth:email-code-cooldown:${email}`
const jwtSecret = 'email-verification-test-secret'

function verificationFixture(redis: EmailCodeRedisFake | Redis = new EmailCodeRedisFake()) {
  const sent: { email: string; code: string }[] = []
  const mail = {
    fail: false,
    async sendVerificationCode(email: string, code: string) {
      if (this.fail) throw new ServiceUnavailableException('验证码邮件暂时无法发送，请稍后重试')
      sent.push({ email, code })
    },
  }
  const service = new EmailVerificationService(
    new ConfigService({ JWT_SECRET: jwtSecret }),
    redis as Redis,
    mail as unknown as MailService,
  )
  return { service, mail, sent }
}

function invalidCode(error: unknown) {
  assert.ok(error instanceof BadRequestException)
  assert.equal(error.message, '验证码无效或已过期')
  return true
}

function wrongCode(code: string) {
  return code === '000000' ? '000001' : '000000'
}

test('验证码恰好为 6 位数字，Redis 仅存邮箱绑定的 HMAC 与尝试次数，TTL 为 600 秒', async () => {
  const redis = new EmailCodeRedisFake()
  const { service, sent } = verificationFixture(redis)
  await service.sendCode('  User@Example.COM  ')
  assert.equal(sent[0].email, 'user@example.com')
  assert.match(sent[0].code, /^\d{6}$/)
  const raw = await redis.get(codeKey('user@example.com'))
  assert.deepEqual(JSON.parse(raw!), {
    digest: createHmac('sha256', jwtSecret).update(`user@example.com:${sent[0].code}`).digest('hex'),
    attempts: 0,
  })
  assert.ok(!raw!.includes(JSON.stringify(sent[0].code)))
  assert.ok(!raw!.includes(jwtSecret))
  assert.equal(redis.entries.get(codeKey('user@example.com'))?.expiresAt, 600_000)
  assert.equal(redis.entries.get(cooldownKey('user@example.com'))?.expiresAt, 60_000)
})

test('同邮箱归一后共享 60 秒冷却，冷却结束可重新发送', async () => {
  const redis = new EmailCodeRedisFake()
  const { service, sent } = verificationFixture(redis)
  await service.sendCode('user@example.com')
  redis.now = 59_999
  await assert.rejects(service.sendCode(' USER@Example.COM '), (error: any) => {
    assert.equal(error.getStatus(), 429)
    assert.match(error.message, /稍后重试/)
    return true
  })
  assert.equal(sent.length, 1)
  redis.now = 60_000
  await service.sendCode(' USER@Example.COM ')
  assert.equal(sent.length, 2)
})

test('错误 4 次后仍可用正确验证码，失败不会延长原 TTL', async () => {
  const redis = new EmailCodeRedisFake()
  const { service, sent } = verificationFixture(redis)
  await service.sendCode('user@example.com')
  for (let attempt = 1; attempt <= 4; attempt++) {
    redis.now += 125
    await assert.rejects(service.consumeCode(' USER@EXAMPLE.COM ', wrongCode(sent[0].code)), invalidCode)
    assert.equal(JSON.parse((await redis.get(codeKey('user@example.com')))!).attempts, attempt)
    assert.equal(redis.entries.get(codeKey('user@example.com'))?.expiresAt, 600_000)
  }
  await service.consumeCode(' USER@EXAMPLE.COM ', sent[0].code)
  assert.equal(await redis.get(codeKey('user@example.com')), null)
  assert.equal(redis.evalCalls, 5)
})

test('第 5 次错误立即使验证码失效', async () => {
  const redis = new EmailCodeRedisFake()
  const { service, sent } = verificationFixture(redis)
  await service.sendCode('user@example.com')
  for (let attempt = 0; attempt < 5; attempt++) {
    await assert.rejects(service.consumeCode('user@example.com', wrongCode(sent[0].code)), invalidCode)
  }
  assert.equal(await redis.get(codeKey('user@example.com')), null)
  await assert.rejects(service.consumeCode('user@example.com', sent[0].code), invalidCode)
})

test('成功消费后不能重复使用，缺失和过期验证码均拒绝', async () => {
  const redis = new EmailCodeRedisFake()
  const { service, sent } = verificationFixture(redis)
  await assert.rejects(service.consumeCode('user@example.com', '123456'), invalidCode)
  await service.sendCode('user@example.com')
  await service.consumeCode('user@example.com', sent[0].code)
  await assert.rejects(service.consumeCode('user@example.com', sent[0].code), invalidCode)
  redis.now = 60_000
  await service.sendCode('user@example.com')
  redis.now = 660_000
  await assert.rejects(service.consumeCode('user@example.com', sent[1].code), invalidCode)
})

test('邮件发送失败清理验证码和冷却，允许立即重试', async () => {
  const redis = new EmailCodeRedisFake()
  const { service, mail, sent } = verificationFixture(redis)
  mail.fail = true
  await assert.rejects(service.sendCode(' User@Example.COM '), ServiceUnavailableException)
  assert.equal(await redis.get(codeKey('user@example.com')), null)
  assert.equal(await redis.get(cooldownKey('user@example.com')), null)
  mail.fail = false
  await service.sendCode('user@example.com')
  assert.equal(sent.length, 1)
})

test('并发发送只发出一封邮件，并发成功消费只有一次', async () => {
  const redis = new EmailCodeRedisFake()
  const { service, sent } = verificationFixture(redis)
  const sends = await Promise.allSettled([service.sendCode('user@example.com'), service.sendCode('user@example.com')])
  assert.equal(sends.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(sent.length, 1)
  const consumes = await Promise.allSettled(Array.from({ length: 10 }, () => service.consumeCode('user@example.com', sent[0].code)))
  assert.equal(consumes.filter(result => result.status === 'fulfilled').length, 1)
  consumes.filter(result => result.status === 'rejected').forEach(result => invalidCode(result.reason))
})

test('真实 Redis Lua 保留毫秒 TTL、限制 5 次失败并保证一次消费', async () => {
  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    connectTimeout: 1000,
    retryStrategy: () => null,
  })
  const email = `email-code-test-${process.pid}-${Date.now()}@example.com`
  try {
    const { service, sent } = verificationFixture(redis)
    await service.sendCode(email)
    assert.ok(await redis.pttl(codeKey(email)) > 599_000)
    assert.ok(await redis.pttl(cooldownKey(email)) > 59_000)
    await redis.pexpire(codeKey(email), 123_456)
    for (let attempt = 1; attempt <= 4; attempt++) {
      const before = await redis.pttl(codeKey(email))
      await assert.rejects(service.consumeCode(email, wrongCode(sent[0].code)), invalidCode)
      const after = await redis.pttl(codeKey(email))
      assert.ok(after > 0 && after <= before && before - after < 1000)
      assert.equal(JSON.parse((await redis.get(codeKey(email)))!).attempts, attempt)
    }
    const outcomes = await Promise.allSettled(Array.from({ length: 10 }, () => service.consumeCode(email, sent[0].code)))
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
    outcomes.filter(result => result.status === 'rejected').forEach(result => invalidCode(result.reason))
    await redis.del(cooldownKey(email))
    await service.sendCode(email)
    for (let attempt = 0; attempt < 5; attempt++) {
      await assert.rejects(service.consumeCode(email, wrongCode(sent[1].code)), invalidCode)
    }
    assert.equal(await redis.get(codeKey(email)), null)
    await assert.rejects(service.consumeCode(email, sent[1].code), invalidCode)
    // 摘要长度异常不能触发比较异常，更不能绕过统一失败响应。
    await redis.set(codeKey(email), JSON.stringify({ digest: 'short', attempts: 0 }), 'EX', 600)
    await assert.rejects(service.consumeCode(email, sent[1].code), invalidCode)
  } finally {
    await redis.del(codeKey(email), cooldownKey(email))
    await redis.quit()
  }
})
