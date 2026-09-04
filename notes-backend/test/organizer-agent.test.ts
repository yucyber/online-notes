import assert = require('node:assert/strict')
import { test } from 'node:test'
import { OrganizerAgentService } from '../src/modules/organizer/organizer-agent.service'

function makeService(overrides: {
  proposals?: any
  planning?: any
  userModel?: any
  config?: any
} = {}) {
  const proposals = {
    findAll: async () => [],
    ...(overrides.proposals || {}),
  }
  const planning = {
    createGlobalProposal: async () => ({ generated: false, reason: 'below_threshold', noteCount: 0 }),
    ...(overrides.planning || {}),
  }
  return new OrganizerAgentService(
    planning as any,
    proposals as any,
    overrides.userModel as any,
    overrides.config as any,
  ) as any
}

test('agent skips generation when a pending proposal already exists', async () => {
  const pending = { id: 'p1', status: 'pending' }
  let planningCalls = 0
  const service = makeService({
    proposals: { findAll: async () => [pending] },
    planning: { createGlobalProposal: async () => { planningCalls += 1; return { generated: true } } },
  })

  const result = await service.runForUser('u1')
  assert.equal(result.generated, false)
  assert.equal(result.reason, 'pending_exists')
  assert.equal(result.proposal, pending)
  assert.equal(planningCalls, 0)
})

test('agent delegates to global planning when no pending proposal exists', async () => {
  const proposal = { id: 'p2', status: 'pending', actions: [] }
  const service = makeService({
    proposals: { findAll: async () => [{ id: 'old', status: 'confirmed' }] },
    planning: { createGlobalProposal: async (userId: string) => ({ generated: true, proposal, noteCount: 7, userId }) },
  })

  const result = await service.runForUser('u1')
  assert.equal(result.generated, true)
  assert.equal(result.proposal, proposal)
  assert.equal(result.noteCount, 7)
})

test('agent scheduler stays disabled unless ORGANIZER_AGENT_ENABLED is true', async () => {
  const enabled = makeService({ config: { get: (key: string) => (key === 'ORGANIZER_AGENT_ENABLED' ? 'true' : undefined) } })
  const disabled = makeService({ config: { get: () => 'false' } })
  const missing = makeService({})

  assert.equal(enabled.isEnabled(), true)
  assert.equal(disabled.isEnabled(), false)
  assert.equal(missing.isEnabled(), false)

  let timerStarted = false
  const originalSetInterval = global.setInterval
  ;(global as any).setInterval = (() => { timerStarted = true; return { unref: () => undefined } }) as any
  try {
    enabled.onModuleInit()
    assert.equal(timerStarted, true)
    timerStarted = false
    disabled.onModuleInit()
    assert.equal(timerStarted, false)
    enabled.onModuleDestroy()
  } finally {
    ;(global as any).setInterval = originalSetInterval
  }
})

test('agent interval is clamped to at least one hour', () => {
  const service = makeService({
    config: { get: (key: string) => (key === 'ORGANIZER_AGENT_INTERVAL_MIN' ? '5' : undefined) },
  })
  assert.equal(service.intervalMinutes(), 60)

  const fallback = makeService({})
  assert.equal(fallback.intervalMinutes(), 1440)
})

test('agent runForAllUsers tolerates per-user failures', async () => {
  const users = [{ _id: 'u1' }, { _id: 'u2' }, { _id: 'u3' }]
  const generatedUsers: string[] = []
  const service = makeService({
    userModel: { find: () => ({ select: () => ({ lean: () => ({ exec: async () => users }) }) }) },
    proposals: {
      findAll: async (userId: string) => {
        if (userId === 'u2') throw new Error('db down')
        return []
      },
    },
    planning: {
      createGlobalProposal: async (userId: string) => {
        generatedUsers.push(userId)
        return { generated: userId !== 'u1' }
      },
    },
  })

  const result = await service.runForAllUsers()
  assert.equal(result.users, 3)
  // u1 规划结果为未生成，u3 生成成功；u2 抛错被吞掉。
  assert.equal(result.generated, 1)
  assert.deepEqual(generatedUsers.sort(), ['u1', 'u3'])
})
