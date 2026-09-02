import { test } from 'node:test'
import assert = require('node:assert/strict')
import { BadRequestException } from '@nestjs/common'
import { AssistantController } from '../src/modules/assistant/assistant.controller'
import { AssistantConversationsService } from '../src/modules/assistant/assistant-conversations.service'
import { AssistantMessagesService } from '../src/modules/assistant/assistant-messages.service'

// 最小内存模型：find 返回 .sort().limit().lean() 链对象（lean 直接 resolve 数组，实现按方案 A 不带 .exec()）。
// find 必须是非 async：async 方法返回 Promise，无法继续 .sort() 链式（与计划 1 assistant-store.test.ts 的 mock 风格一致）。
// 过滤器支持 $regex/$in/$ne/等值比较。
class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  find(filter: any) {
    return {
      sort: () => ({
        limit: (n: number) => ({
          lean: async () => this.docs.filter((d) => Object.entries(filter).every(([k, v]) => {
            // typeof 收窄后 v 为 object，需经 any 访问操作符字段（brief 原样写法在 ts-node 类型检查下报 TS2339）。
            const o = v as any
            if (typeof v === 'object' && o?.$regex) return new RegExp(o.$regex, 'i').test(String(d[k] || ''))
            if (typeof v === 'object' && o?.$in) return o.$in.some((x: any) => String(x) === String(d[k]))
            if (typeof v === 'object' && o?.$ne) return String(d[k]) !== String(o.$ne)
            return String(d[k]) === String(v)
          })).slice(0, n)
        }),
      }),
    }
  }
}

test('按用户与关键词命中消息并返回摘要', async () => {
  const model = new MemoryModel([
    { _id: 'm1', conversationId: 'c1', userId: 'u1', seq: 1, role: 'user', content: '蓝色海豚的项目结论是什么', updatedAt: '2026-09-01T00:00:00.000Z' },
    { _id: 'm2', conversationId: 'c2', userId: 'u2', seq: 1, role: 'user', content: '蓝色海豚', updatedAt: '2026-09-01T00:00:00.000Z' },
  ])
  const service = new AssistantMessagesService(model as any)
  const hits = await service.searchMessages('u1', '蓝色海豚')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].conversationId, 'c1')
  assert.ok(hits[0].snippet.includes('蓝色海豚'))
})

test('正则元字符被转义，不会误匹配', async () => {
  const model = new MemoryModel([{ _id: 'm1', conversationId: 'c1', userId: 'u1', seq: 1, role: 'user', content: 'a.b', updatedAt: '2026-09-01T00:00:00.000Z' }])
  const service = new AssistantMessagesService(model as any)
  const hits = await service.searchMessages('u1', 'a.b')
  assert.equal(hits.length, 1)
  const none = await service.searchMessages('u1', 'aXb')
  assert.equal(none.length, 0)
})

test('同一会话最多保留 3 条命中，其他会话不受影响', async () => {
  const model = new MemoryModel([
    { _id: 'm1', conversationId: 'c1', userId: 'u1', seq: 1, role: 'user', content: '蓝色海豚 A', updatedAt: '2026-09-01T00:00:00.000Z' },
    { _id: 'm2', conversationId: 'c1', userId: 'u1', seq: 2, role: 'assistant', content: '蓝色海豚 B', updatedAt: '2026-09-01T00:00:00.000Z' },
    { _id: 'm3', conversationId: 'c1', userId: 'u1', seq: 3, role: 'user', content: '蓝色海豚 C', updatedAt: '2026-09-01T00:00:00.000Z' },
    { _id: 'm4', conversationId: 'c1', userId: 'u1', seq: 4, role: 'user', content: '蓝色海豚 D', updatedAt: '2026-09-01T00:00:00.000Z' },
    { _id: 'm5', conversationId: 'c2', userId: 'u1', seq: 1, role: 'user', content: '蓝色海豚 E', updatedAt: '2026-09-01T00:00:00.000Z' },
  ])
  const service = new AssistantMessagesService(model as any)
  const hits = await service.searchMessages('u1', '蓝色海豚')
  assert.equal(hits.length, 4)
  assert.equal(hits.filter((h) => h.conversationId === 'c1').length, 3)
  assert.equal(hits.filter((h) => h.conversationId === 'c2').length, 1)
})

test('总命中上限 20 条', async () => {
  const seed = Array.from({ length: 21 }, (_, i) => ({
    _id: `m${i}`, conversationId: `c${Math.floor(i / 3)}`, userId: 'u1', seq: i + 1, role: 'user' as const, content: '蓝色海豚', updatedAt: '2026-09-01T00:00:00.000Z',
  }))
  const service = new AssistantMessagesService(new MemoryModel(seed) as any)
  const hits = await service.searchMessages('u1', '蓝色海豚')
  assert.equal(hits.length, 20)
})

test('结果包含 messageId/seq/role/updatedAt 字段', async () => {
  const model = new MemoryModel([{ _id: 'm1', conversationId: 'c1', userId: 'u1', seq: 7, role: 'assistant', content: '命中内容', updatedAt: '2026-09-02T00:00:00.000Z' }])
  const service = new AssistantMessagesService(model as any)
  const hits = await service.searchMessages('u1', '命中内容')
  assert.deepEqual(hits[0], { conversationId: 'c1', messageId: 'm1', seq: 7, role: 'assistant', snippet: '命中内容', updatedAt: '2026-09-02T00:00:00.000Z' })
})

test('空 query 直接返回空数组，不触达存储', async () => {
  const service = new AssistantMessagesService(new MemoryModel() as any)
  assert.deepEqual(await service.searchMessages('u1', ''), [])
  assert.deepEqual(await service.searchMessages('u1', '   '), [])
})

test('searchByTitle 命中标题并排除 deleted 会话', async () => {
  const model = new MemoryModel([
    { _id: 'c1', userId: 'u1', title: '蓝色海豚项目', status: 'active', updatedAt: '2026-09-01T00:00:00.000Z' },
    { _id: 'c2', userId: 'u1', title: '蓝色海豚旧版', status: 'deleted', updatedAt: '2026-09-01T00:00:00.000Z' },
    { _id: 'c3', userId: 'u2', title: '蓝色海豚他人', status: 'active', updatedAt: '2026-09-01T00:00:00.000Z' },
  ])
  const service = new AssistantConversationsService(model as any)
  const hits = await service.searchByTitle('u1', '蓝色海豚')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, 'c1')
  assert.equal(hits[0].title, '蓝色海豚项目')
  assert.equal(hits[0].updatedAt, '2026-09-01T00:00:00.000Z')
})

test('searchByTitle 空 query 返回空数组', async () => {
  const service = new AssistantConversationsService(new MemoryModel() as any)
  assert.deepEqual(await service.searchByTitle('u1', ''), [])
})

test('search 端点返回会话与消息命中', async () => {
  const conversations = { searchByTitle: async () => [{ id: 'c1', title: 't', updatedAt: 'x' }] }
  const messages = { searchMessages: async () => [{ conversationId: 'c1', messageId: 'm1', seq: 1, role: 'user', snippet: 's', updatedAt: 'x' }] }
  const controller = new AssistantController({} as any, messages as any, conversations as any)
  const result = await controller.search('蓝色海豚', { user: { id: 'u1' } } as any)
  assert.deepEqual(result, {
    conversations: [{ id: 'c1', title: 't', updatedAt: 'x' }],
    messages: [{ conversationId: 'c1', messageId: 'm1', seq: 1, role: 'user', snippet: 's', updatedAt: 'x' }],
  })
})

test('search 端点无认证用户时抛 BadRequest', async () => {
  const controller = new AssistantController({} as any, {} as any, {} as any)
  await assert.rejects(() => controller.search('q', undefined as any), BadRequestException)
})
