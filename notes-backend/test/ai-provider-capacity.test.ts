import { test } from 'node:test'
import assert = require('node:assert/strict')
import { ConfigService } from '@nestjs/config'
import { AiProviderCapacityService } from '../src/modules/ai/ai-provider-capacity.service'
import Redis from 'ioredis'

class AtomicRedisFake {
  private readonly windows = new Map<string, { rpm: number; tpm: number; active: number }>()
  async eval(_script: string, keyCount: number, _rpmKey: string, _tpmKey?: string, key?: string, rpm?: string, tpm?: string, concurrency?: string, tokens?: string) {
    if (keyCount === 1) {
      const state = this.windows.get(_rpmKey)
      if (state) state.active = Math.max(0, state.active - 1)
      return 1
    }
    key = key!
    const state = this.windows.get(key) || { rpm: 0, tpm: 0, active: 0 }
    if (state.rpm + 1 > Number(rpm) || state.tpm + Number(tokens) > Number(tpm) || state.active + 1 > Number(concurrency)) return [0, 1000]
    state.rpm += 1
    state.tpm += Number(tokens)
    state.active += 1
    this.windows.set(key, state)
    return [1, 0]
  }
  async decr(key: string) {
    const state = this.windows.get(key)
    if (state) state.active = Math.max(0, state.active - 1)
  }
}

test('多个实例共享 provider 并发与 Redis 原子 RPM/TPM 预算', async () => {
  const redis = new AtomicRedisFake()
  const config = new ConfigService({ SILICONFLOW_AI_MAX_CONCURRENCY: '1', SILICONFLOW_AI_RPM: '2', SILICONFLOW_AI_TPM: '100' })
  const first = new AiProviderCapacityService(config, redis as any)
  const second = new AiProviderCapacityService(config, redis as any)

  const lease = await first.reserve('siliconflow', 60)
  const denied = await second.reserve('siliconflow', 40)
  assert.equal(lease.granted, true)
  assert.equal(denied.granted, false)
  assert.ok(denied.retryAfterMs > 0)

  await first.release(lease)
  const next = await second.reserve('siliconflow', 40)
  assert.equal(next.granted, true)
  await second.release(next)

  const exhausted = await first.reserve('siliconflow', 1)
  assert.equal(exhausted.granted, false)
})

test('token 预约包含输入估算和 maxTokens，usage 缺失时保留保守值', async () => {
  const redis = new AtomicRedisFake()
  const service = new AiProviderCapacityService(new ConfigService({ SILICONFLOW_AI_TPM: '10000' }), redis as any)
  assert.equal(service.estimateTokens([{ content: '12345678' }], 100), 102)
  const lease = await service.reserve('siliconflow', 102)
  await service.reconcile(lease, undefined)
  assert.equal(lease.reservedTokens, 102)
})

test('Redis 暂时不可用时容量预约失败且不退化为进程内计数', async () => {
  const redis = { eval: async () => { throw new Error('redis unavailable') } }
  const service = new AiProviderCapacityService(new ConfigService({}), redis as any)
  await assert.rejects(() => service.reserve('siliconflow', 100), /redis unavailable/)
})

test('真实 Redis Lua 在两个实例间原子限制并发、RPM 和 TPM', async () => {
  const prefix = `test:ai-capacity:${process.pid}:${Date.now()}`
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
  const config = new ConfigService({
    AI_CAPACITY_KEY_PREFIX: prefix,
    AR_AI_MAX_CONCURRENCY: '1', AR_AI_RPM: '2', AR_AI_TPM: '100',
  })
  const first = new AiProviderCapacityService(config, redis)
  const second = new AiProviderCapacityService(config, redis)
  try {
    const lease = await first.reserve('ar', 60)
    assert.equal(lease.granted, true)
    assert.equal((await second.reserve('ar', 40)).granted, false)
    await first.release(lease)
    const next = await second.reserve('ar', 40)
    assert.equal(next.granted, true)
    await second.release(next)
    assert.equal((await first.reserve('ar', 1)).granted, false)
  } finally {
    const keys = await redis.keys(`${prefix}:*`)
    if (keys.length) await redis.del(...keys)
    await redis.quit()
  }
})

test('20 个并发预约的 active 数不超过配置', async () => {
  const redis = new AtomicRedisFake()
  const config = new ConfigService({ SILICONFLOW_AI_MAX_CONCURRENCY: '2', SILICONFLOW_AI_RPM: '30', SILICONFLOW_AI_TPM: '10000' })
  const instances = Array.from({ length: 20 }, () => new AiProviderCapacityService(config, redis as any))
  const leases = await Promise.all(instances.map((instance) => instance.reserve('siliconflow', 100)))
  assert.equal(leases.filter((lease) => lease.granted).length, 2)
  await Promise.all(leases.map((lease, index) => instances[index].release(lease)))
})
