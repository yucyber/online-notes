import { Inject, Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'

export type AiCapacityProvider = 'siliconflow' | 'bai' | 'ar'

export interface AiCapacityLease {
  provider: AiCapacityProvider
  granted: boolean
  retryAfterMs: number
  reservedTokens: number
  activeKey: string
  tpmKey?: string
  reservationId?: string
  reservedAt?: number
}

export class AiCapacityDeferredError extends Error {
  constructor(readonly provider: AiCapacityProvider, readonly retryAfterMs: number) {
    super(`${provider} capacity is temporarily unavailable`)
  }
}

const DEFAULTS: Record<AiCapacityProvider, { concurrency: number; rpm: number; tpm: number }> = {
  siliconflow: { concurrency: 2, rpm: 30, tpm: 60_000 },
  bai: { concurrency: 1, rpm: 10, tpm: 30_000 },
  ar: { concurrency: 1, rpm: 5, tpm: 20_000 },
}

const RESERVE_SCRIPT = `
local cutoff = tonumber(ARGV[6]) - 60000
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', cutoff)
local rpm = redis.call('ZCARD', KEYS[1])
local tokenMembers = redis.call('ZRANGE', KEYS[2], 0, -1)
local tpm = 0
for _, member in ipairs(tokenMembers) do
  local separator = string.find(member, ':')
  tpm = tpm + tonumber(string.sub(member, 1, separator - 1))
end
local active = tonumber(redis.call('GET', KEYS[3]) or '0')
if rpm + 1 > tonumber(ARGV[1]) or tpm + tonumber(ARGV[4]) > tonumber(ARGV[2]) or active + 1 > tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retryAt = oldest[2] and tonumber(oldest[2]) + 60000 or tonumber(ARGV[6]) + 1000
  return {0, math.max(1, retryAt - tonumber(ARGV[6]))}
end
redis.call('ZADD', KEYS[1], ARGV[6], ARGV[5])
redis.call('ZADD', KEYS[2], ARGV[6], ARGV[4] .. ':' .. ARGV[5])
redis.call('PEXPIRE', KEYS[1], 61000); redis.call('PEXPIRE', KEYS[2], 61000)
redis.call('INCR', KEYS[3]); redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[7]))
return {1, 0}
`

const RECONCILE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1] .. ':' .. ARGV[2])
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4] .. ':' .. ARGV[2])
return 1
`

const RELEASE_SCRIPT = `
local active = tonumber(redis.call('GET', KEYS[1]) or '0')
if active <= 1 then return redis.call('DEL', KEYS[1]) end
return redis.call('DECR', KEYS[1])
`

@Injectable()
export class AiProviderCapacityService {
  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  estimateTokens(messages: Array<{ content: string }>, maxTokens: number) {
    const inputChars = messages.reduce((sum, message) => sum + String(message.content || '').length, 0)
    return Math.ceil(inputChars / 4) + Math.max(0, maxTokens)
  }

  async reserve(provider: AiCapacityProvider, tokens: number): Promise<AiCapacityLease> {
    if (!this.redis) return { provider, granted: true, retryAfterMs: 0, reservedTokens: tokens, activeKey: '' }
    const limits = this.limits(provider)
    const now = Date.now()
    const reservationId = `${process.pid}-${now}-${Math.random().toString(36).slice(2)}`
    const namespace = String(this.config.get('AI_CAPACITY_KEY_PREFIX') || 'ai:capacity')
    const prefix = `${namespace}:${provider}`
    const activeKey = `${prefix}:active`
    const tpmKey = `${prefix}:tpm`
    const result = await (this.redis as any).eval(
      RESERVE_SCRIPT, 3, `${prefix}:rpm`, tpmKey, activeKey,
      String(limits.rpm), String(limits.tpm), String(limits.concurrency), String(tokens), reservationId, String(now), '180000',
    ) as [number, number]
    return {
      provider, granted: Number(result[0]) === 1, retryAfterMs: Math.max(1, Number(result[1]) || 1000),
      reservedTokens: tokens, activeKey, tpmKey, reservationId, reservedAt: now,
    }
  }

  async release(lease: AiCapacityLease) {
    if (!lease.granted || !lease.activeKey || !this.redis) return
    await (this.redis as any).eval(RELEASE_SCRIPT, 1, lease.activeKey)
  }

  async reconcile(lease: AiCapacityLease, usage?: { promptTokens?: number; completionTokens?: number }) {
    if (!usage) return
    const actual = Math.max(0, Number(usage.promptTokens || 0) + Number(usage.completionTokens || 0))
    if (actual <= 0) return
    if (this.redis && lease.tpmKey && lease.reservationId && lease.reservedAt) {
      await (this.redis as any).eval(
        RECONCILE_SCRIPT, 1, lease.tpmKey, String(lease.reservedTokens), lease.reservationId,
        String(lease.reservedAt), String(actual),
      )
    }
    lease.reservedTokens = actual
  }

  private limits(provider: AiCapacityProvider) {
    const prefix = provider === 'siliconflow' ? 'SILICONFLOW' : provider === 'bai' ? 'BAI' : 'AR'
    const defaults = DEFAULTS[provider]
    return {
      concurrency: Math.max(1, Number(this.config.get(`${prefix}_AI_MAX_CONCURRENCY`) || defaults.concurrency)),
      rpm: Math.max(1, Number(this.config.get(`${prefix}_AI_RPM`) || defaults.rpm)),
      tpm: Math.max(1, Number(this.config.get(`${prefix}_AI_TPM`) || defaults.tpm)),
    }
  }
}
