import { test } from 'node:test'
import assert = require('node:assert/strict')
import { ConfigService } from '@nestjs/config'
import { AiProviderCapacityService } from '../src/modules/ai/ai-provider-capacity.service'

class AtomicRedisFake {
  private readonly windows = new Map<string, { rpm: number; tpm: number; active: number }>()
  async eval(_script: string, _keyCount: number, _rpmKey: string, _tpmKey: string, key: string, rpm: string, tpm: string, concurrency: string, tokens: string) {
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
