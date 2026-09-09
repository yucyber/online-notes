import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac, randomBytes, randomInt } from 'node:crypto'
import Redis from 'ioredis'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { MailService } from './mail.service'

// 比较、计数和删除在同一次 EVAL 内完成，防止并发请求重复消费或覆盖失败次数。
// 摘要先校验长度再完整比较；失败写回沿用毫秒 TTL，不能因重试延长有效期。
const CONSUME_CODE_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then return 0 end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  redis.call('DEL', KEYS[1])
  return 0
end
local state = cjson.decode(value)
local candidate = ARGV[1]
local matches = false
if type(state.digest) == 'string' and #state.digest == 64 and #candidate == 64 then
  local difference = 0
  for i = 1, 64 do
    difference = bit.bor(difference, bit.bxor(string.byte(state.digest, i), string.byte(candidate, i)))
  end
  matches = difference == 0
end
if matches then
  redis.call('DEL', KEYS[1])
  return 1
end
state.attempts = state.attempts + 1
if state.attempts >= 5 then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ttl)
end
return 0
`

// SMTP 可能跨越冷却窗口；旧请求失败只能清理自己仍拥有的 key，不能误删后续请求。
const CLEANUP_FAILED_SEND_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value and cjson.decode(value).owner == ARGV[1] then
  redis.call('DEL', KEYS[1])
end
if redis.call('GET', KEYS[2]) == ARGV[1] then
  redis.call('DEL', KEYS[2])
end
return 0
`

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly mailService: MailService,
  ) {}

  async sendCode(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase()
    const key = `auth:email-code:${normalizedEmail}`
    const cooldownKey = `auth:email-code-cooldown:${normalizedEmail}`
    const owner = randomBytes(32).toString('hex')
    const acquired = await this.redis.set(cooldownKey, owner, 'EX', 60, 'NX')
    if (acquired !== 'OK') {
      throw new HttpException('验证码发送过于频繁，请稍后重试', HttpStatus.TOO_MANY_REQUESTS)
    }

    try {
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
      const digest = this.digest(normalizedEmail, code)
      await this.redis.set(key, JSON.stringify({ digest, attempts: 0, owner }), 'EX', 600)
      await this.mailService.sendVerificationCode(normalizedEmail, code)
    } catch (error) {
      await this.redis.eval(CLEANUP_FAILED_SEND_SCRIPT, 2, key, cooldownKey, owner)
      throw error
    }
  }

  async consumeCode(email: string, code: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase()
    const digest = this.digest(normalizedEmail, code)
    const result = await this.redis.eval(CONSUME_CODE_SCRIPT, 1, `auth:email-code:${normalizedEmail}`, digest)
    if (result !== 1) throw new BadRequestException('验证码无效或已过期')
  }

  private digest(normalizedEmail: string, code: string): string {
    const jwtSecret = this.configService.getOrThrow<string>('JWT_SECRET')
    return createHmac('sha256', jwtSecret).update(normalizedEmail + ':' + code).digest('hex')
  }
}
