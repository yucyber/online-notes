import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NoteCacheService } from '../src/modules/notes/note-cache.service'

class FakeRedis {
  public getCalls: string[] = []
  public setCalls: any[][] = []
  public values = new Map<string, string>()
  public failGet = false
  public failSet = false
  public failIncr = false

  async get(key: string) {
    this.getCalls.push(key)
    if (this.failGet) throw new Error('redis get failed')
    return this.values.get(key) ?? null
  }

  async set(...args: any[]) {
    this.setCalls.push(args)
    if (this.failSet) throw new Error('redis set failed')
    return 'OK'
  }

  async incr(key: string) {
    if (this.failIncr) throw new Error('redis incr failed')
    const next = Number(this.values.get(key) || 0) + 1
    this.values.set(key, String(next))
    return next
  }
}

class TestNoteCacheService extends NoteCacheService {
  constructor(private readonly fakeRedis: FakeRedis) {
    super()
  }

  protected getClient() {
    return this.fakeRedis as any
  }
}

const payload = {
  userId: 'user-1',
  keyword: 'alpha',
  categoryId: undefined,
  tagIds: ['tag-1'],
  startDate: undefined,
  endDate: undefined,
  status: 'published',
  tagsMode: 'all',
  searchMode: 'text',
  cursor: undefined,
  page: 1,
  size: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc',
  ids: undefined,
}

test('NoteCacheService builds stable list keys scoped by user', () => {
  const svc = new TestNoteCacheService(new FakeRedis())
  const key = svc.buildListKey('user-1', payload)

  assert.equal(key, 'notes:list:0:user-1:441bb36f17a98725050890492f2410de856fe40c')
  assert.equal(key, svc.buildListKey('user-1', { ...payload }))
  assert.notEqual(key, svc.buildListKey('user-2', { ...payload, userId: 'user-2' }))
})

test('NoteCacheService returns parsed list cache hits', async () => {
  const redis = new FakeRedis()
  const svc = new TestNoteCacheService(redis)
  const response = { items: [{ title: 'Cached note' }], page: 1, size: 20, total: 1 }
  redis.values.set(svc.buildListKey('user-1', payload), JSON.stringify(response))

  const cached = await svc.getList<typeof response>('user-1', payload)

  assert.deepEqual(cached, response)
})

test('NoteCacheService returns null when cache read fails or contains invalid JSON', async () => {
  const redis = new FakeRedis()
  const svc = new TestNoteCacheService(redis)
  redis.values.set(svc.buildListKey('user-1', payload), '{bad json')

  assert.equal(await svc.getList('user-1', payload), null)

  redis.failGet = true
  assert.equal(await svc.getList('user-1', payload), null)
})

test('NoteCacheService writes list cache with the existing 300 second TTL', async () => {
  const redis = new FakeRedis()
  const svc = new TestNoteCacheService(redis)
  const response = { items: [], page: 1, size: 20, total: 0 }

  await svc.setList('user-1', payload, response)

  assert.equal(redis.setCalls.length, 1)
  assert.match(redis.setCalls[0][0], /^notes:list:0:user-1:[a-f0-9]{40}$/)
  assert.equal(redis.setCalls[0][1], JSON.stringify(response))
  assert.equal(redis.setCalls[0][2], 'EX')
  assert.equal(redis.setCalls[0][3], 300)
})

test('NoteCacheService ignores cache write failures', async () => {
  const redis = new FakeRedis()
  const svc = new TestNoteCacheService(redis)
  redis.failSet = true

  await assert.doesNotReject(() => svc.setList('user-1', payload, { items: [] }))
})

test('NoteCacheService advances the list revision to invalidate every user cache', async () => {
  const redis = new FakeRedis()
  const svc = new TestNoteCacheService(redis)

  assert.equal(await svc.getListRevision(), '0')
  await svc.invalidateLists()
  assert.equal(await svc.getListRevision(), '1')
})
