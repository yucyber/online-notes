import assert = require('node:assert/strict')
import { test } from 'node:test'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Types } from 'mongoose'

import { AiController } from '../src/modules/ai/ai.controller'
import { AiRunService } from '../src/modules/ai/ai-run.service'

const USER_A = '507f1f77bcf86cd799439011'
const USER_B = '507f1f77bcf86cd799439012'

type Fixture = Record<string, any>

function createMemoryModel(fixtures: Fixture[]) {
  const matches = (value: Fixture, filter: Fixture) => Object.entries(filter).every(([key, expected]) => {
    const actual = value[key]
    if (expected instanceof Types.ObjectId) return String(actual) === expected.toString()
    if (expected && typeof expected === 'object' && ('$gte' in expected || '$lte' in expected)) {
      const timestamp = new Date(actual).getTime()
      if (expected.$gte && timestamp < new Date(expected.$gte).getTime()) return false
      if (expected.$lte && timestamp > new Date(expected.$lte).getTime()) return false
      return true
    }
    return actual === expected
  })

  const query = (items: Fixture[]) => {
    let result = [...items]
    const chain = {
      sort(sort: Fixture) {
        const [field, direction] = Object.entries(sort)[0] as [string, number]
        result.sort((left, right) => direction * (new Date(left[field]).getTime() - new Date(right[field]).getTime()))
        return chain
      },
      lean() {
        return chain
      },
      async exec() {
        return result.map((item) => ({ ...item }))
      },
    }
    return chain
  }

  return {
    find: (filter: Fixture) => query(fixtures.filter((item) => matches(item, filter))),
    findOne: (filter: Fixture) => {
      const item = fixtures.find((candidate) => matches(candidate, filter))
      return {
        lean() {
          return this
        },
        async exec() {
          return item ? { ...item } : null
        },
      }
    },
  }
}

function createController(fixtures: Fixture[]) {
  const runs = new AiRunService(createMemoryModel(fixtures) as any)
  return new AiController({} as any, runs)
}

function requestFor(userId: string) {
  return { user: { id: userId } } as any
}

function run(overrides: Fixture): Fixture {
  return {
    runId: 'run-default',
    graphName: 'WriterGraph',
    task: 'writer',
    reasoningMode: 'off',
    userId: new Types.ObjectId(USER_A),
    provider: 'siliconflow',
    model: 'model-a',
    durationMs: 100,
    retryCount: 0,
    fallbackUsed: false,
    status: 'succeeded',
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    finishedAt: new Date('2026-08-20T00:00:00.100Z'),
    ...overrides,
  }
}

test('performance summary isolates users, uses nearest-rank percentiles, and keeps legacy total duration', async () => {
  const controller = createController([
    run({
      runId: 'a-100',
      durationMs: 100,
      stages: [{ name: 'provider', durationMs: 80, status: 'succeeded' }],
      metrics: { inputChars: 10, content: 'secret body' },
      prompt: 'secret prompt',
      reasoning: 'secret reasoning',
      apiKey: 'secret key',
      providerResponse: { choices: ['secret response'] },
    }),
    run({ runId: 'a-200', durationMs: 200, fallbackUsed: true, status: 'failed', stages: [{ name: 'provider', durationMs: 150, status: 'failed' }] }),
    run({ runId: 'a-300', durationMs: 300, task: 'mindmap', stages: [{ name: 'validation', durationMs: 20, status: 'succeeded' }] }),
    run({ runId: 'a-900-legacy', durationMs: 900, task: 'mindmap', stages: undefined, metrics: undefined }),
    run({ runId: 'b-private', userId: new Types.ObjectId(USER_B), durationMs: 10, fallbackUsed: true }),
  ])

  const result = await (controller as any).getRunPerformance(
    {
      from: '2026-08-19T00:00:00.000Z',
      to: '2026-08-21T00:00:00.000Z',
      page: 1,
      size: 20,
    },
    requestFor(USER_A),
  )

  assert.equal(result.requestCount, 4)
  assert.equal(result.successRate, 0.75)
  assert.equal(result.fallbackRate, 0.25)
  assert.equal(result.p50Ms, 200)
  assert.equal(result.p95Ms, 900)
  assert.deepEqual(result.byTask.map((item: any) => item.task), ['mindmap', 'writer'])
  assert.deepEqual(result.byTask.find((item: any) => item.task === 'mindmap').stages, [
    { name: 'validation', requestCount: 1, p50Ms: 20, p95Ms: 20 },
  ])
  assert.equal(result.byTask.find((item: any) => item.task === 'mindmap').p95Ms, 900)
  assert.equal(result.recentRuns.total, 4)
  assert.equal(result.recentRuns.items.some((item: any) => item.runId === 'b-private'), false)
  assert.equal(result.recentRuns.items.find((item: any) => item.runId === 'a-900-legacy').durationMs, 900)
  assert.deepEqual(result.recentRuns.items.find((item: any) => item.runId === 'a-900-legacy').stages, [])
  assert.doesNotMatch(JSON.stringify(result), /secret prompt|secret body|secret reasoning|secret key|secret response/)
})

test('performance summary applies every filter and paginates recent runs without changing aggregate totals', async () => {
  const controller = createController([
    run({ runId: 'match-new', createdAt: new Date('2026-08-22T00:00:00.000Z'), provider: 'openai', model: 'gpt-5', task: 'writer', status: 'failed', fallbackUsed: true, durationMs: 500 }),
    run({ runId: 'match-old', createdAt: new Date('2026-08-21T00:00:00.000Z'), provider: 'openai', model: 'gpt-5', task: 'writer', status: 'failed', fallbackUsed: true, durationMs: 400 }),
    run({ runId: 'wrong-task', createdAt: new Date('2026-08-21T12:00:00.000Z'), provider: 'openai', model: 'gpt-5', task: 'mindmap', status: 'failed', fallbackUsed: true }),
    run({ runId: 'wrong-provider', provider: 'siliconflow', model: 'gpt-5', task: 'writer', status: 'failed', fallbackUsed: true }),
    run({ runId: 'wrong-model', provider: 'openai', model: 'gpt-4', task: 'writer', status: 'failed', fallbackUsed: true }),
    run({ runId: 'wrong-status', provider: 'openai', model: 'gpt-5', task: 'writer', status: 'succeeded', fallbackUsed: true }),
    run({ runId: 'wrong-fallback', provider: 'openai', model: 'gpt-5', task: 'writer', status: 'failed', fallbackUsed: false }),
    run({ runId: 'wrong-date', createdAt: new Date('2026-08-18T00:00:00.000Z'), provider: 'openai', model: 'gpt-5', task: 'writer', status: 'failed', fallbackUsed: true }),
  ])

  const result = await (controller as any).getRunPerformance(
    {
      from: '2026-08-20T00:00:00.000Z',
      to: '2026-08-23T00:00:00.000Z',
      task: 'writer',
      provider: 'openai',
      model: 'gpt-5',
      status: 'failed',
      fallbackUsed: true,
      page: 2,
      size: 1,
    },
    requestFor(USER_A),
  )

  assert.equal(result.requestCount, 2)
  assert.equal(result.p50Ms, 400)
  assert.equal(result.recentRuns.page, 2)
  assert.equal(result.recentRuns.size, 1)
  assert.equal(result.recentRuns.total, 2)
  assert.equal(result.recentRuns.totalPages, 2)
  assert.equal(result.recentRuns.items.length, 1)
  assert.equal(result.recentRuns.items[0].runId, 'match-old')
})

test('run detail is user-scoped, returns sanitized observability fields, and hides forged run ids', async () => {
  const controller = createController([
    run({
      runId: 'owned',
      stages: [{ name: 'provider', durationMs: 80, status: 'succeeded', prompt: 'stage secret' }],
      metrics: { inputChars: 12, outputChars: 34, content: 'metrics secret' },
      error: 'full provider response secret',
      prompt: 'prompt secret',
    }),
    run({ runId: 'private', userId: new Types.ObjectId(USER_B) }),
  ])

  const owned = await (controller as any).getRun('owned', requestFor(USER_A))
  assert.equal(owned.runId, 'owned')
  assert.deepEqual(owned.stages, [{ name: 'provider', durationMs: 80, status: 'succeeded' }])
  assert.deepEqual(owned.metrics, { inputChars: 12, outputChars: 34 })
  assert.equal('userId' in owned, false)
  assert.equal('error' in owned, false)
  assert.doesNotMatch(JSON.stringify(owned), /secret/)

  await assert.rejects(() => (controller as any).getRun('private', requestFor(USER_A)), NotFoundException)
  await assert.rejects(() => (controller as any).getRun('forged', requestFor(USER_A)), NotFoundException)
})

test('performance summary filters dirty historical stages without losing total duration', async () => {
  const controller = createController([
    run({
      runId: 'dirty-list',
      durationMs: 640,
      stages: [
        { name: 'provider', durationMs: 120, status: 'succeeded' },
        null,
        'legacy-stage',
        { name: 'validation', durationMs: 20, status: 'unknown' },
        { name: 'response', durationMs: -10, status: 'succeeded' },
      ],
    }),
  ])

  const result = await (controller as any).getRunPerformance(
    { from: '2026-08-19T00:00:00.000Z', to: '2026-08-21T00:00:00.000Z' },
    requestFor(USER_A),
  )

  assert.equal(result.requestCount, 1)
  assert.equal(result.p50Ms, 640)
  assert.equal(result.p95Ms, 640)
  assert.deepEqual(result.recentRuns.items[0].stages, [
    { name: 'provider', durationMs: 120, status: 'succeeded' },
  ])
  assert.deepEqual(result.byTask[0].stages, [
    { name: 'provider', requestCount: 1, p50Ms: 120, p95Ms: 120 },
  ])
})

test('run detail filters unknown historical stage names and keeps valid stages', async () => {
  const controller = createController([
    run({
      runId: 'dirty-detail',
      durationMs: 700,
      stages: [
        { name: 'provider', durationMs: 300, status: 'succeeded' },
        { name: 'legacy_provider_call', durationMs: 200, status: 'failed' },
        { name: 'validation', durationMs: '50', status: 'succeeded' },
      ],
    }),
  ])

  const result = await (controller as any).getRun('dirty-detail', requestFor(USER_A))

  assert.equal(result.durationMs, 700)
  assert.deepEqual(result.stages, [
    { name: 'provider', durationMs: 300, status: 'succeeded' },
  ])
})

test('performance query rejects invalid dates, windows over 90 days, and invalid pagination', async () => {
  const controller = createController([])
  const req = requestFor(USER_A)

  await assert.rejects(
    () => (controller as any).getRunPerformance({ from: 'invalid', page: 1, size: 20 }, req),
    BadRequestException,
  )
  await assert.rejects(
    () => (controller as any).getRunPerformance({ from: '2026-01-01', to: '2026-04-02', page: 1, size: 20 }, req),
    BadRequestException,
  )
  await assert.rejects(
    () => (controller as any).getRunPerformance({ page: 0, size: 20 }, req),
    BadRequestException,
  )
  await assert.rejects(
    () => (controller as any).getRunPerformance({ page: 1, size: 101 }, req),
    BadRequestException,
  )
})

test('performance query defaults to seven days and a page size of twenty', async () => {
  const now = Date.now()
  const recent = Array.from({ length: 21 }, (_, index) => run({
    runId: `recent-${index}`,
    createdAt: new Date(now - index * 60_000),
  }))
  const controller = createController([
    ...recent,
    run({ runId: 'older-than-seven-days', createdAt: new Date(now - 8 * 24 * 60 * 60 * 1000) }),
  ])

  const result = await (controller as any).getRunPerformance({}, requestFor(USER_A))

  assert.equal(result.requestCount, 21)
  assert.equal(result.recentRuns.page, 1)
  assert.equal(result.recentRuns.size, 20)
  assert.equal(result.recentRuns.total, 21)
  assert.equal(result.recentRuns.items.length, 20)
})
