import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantConversationsService } from '../src/modules/assistant/assistant-conversations.service'

// mock 需与实现链同形：find → sort → lean → exec；测试用明文 id（'u1'/'c1'），
// 因此 userId 过滤须容忍非 ObjectId 字符串（toObjectId 对非法 hex 原样返回）。
// find 必须是非 async：async 方法返回 Promise，链不上 .sort（与 assistant-search/management 测试的 mock 风格一致）。
class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  find(filter: any) {
    const result = this.docs
      .filter((d) => Object.entries(filter).every(([k, v]) => {
        if (k === 'status' && typeof v === 'object' && v !== null && '$ne' in v) return d.status !== v.$ne
        return String(d[k]) === String(v)
      }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    return { sort: () => ({ lean: () => ({ exec: async () => result }) }) }
  }
}

test('list 只返回当前用户未删除会话并按 updatedAt 降序', async () => {
  const model = new MemoryModel([
    { _id: 'c1', userId: 'u1', title: 'A', status: 'active', updatedAt: '2026-09-01T10:00:00.000Z', messageCount: 2 },
    { _id: 'c2', userId: 'u1', title: 'B', status: 'deleted', updatedAt: '2026-09-01T11:00:00.000Z', messageCount: 1 },
    { _id: 'c3', userId: 'u2', title: 'C', status: 'active', updatedAt: '2026-09-01T12:00:00.000Z', messageCount: 0 },
  ])
  const service = new AssistantConversationsService(model as any)
  const items = await service.list('u1')
  assert.deepEqual(items.map((i) => i.id), ['c1'])
  assert.equal(items[0].title, 'A')
})

test('list 返回空数组当用户无会话', async () => {
  const model = new MemoryModel([])
  const service = new AssistantConversationsService(model as any)
  const items = await service.list('u1')
  assert.deepEqual(items, [])
})

// controller 端点：GET /api/assistant/conversations → { items }。
// 处理器取名 listConversations：构造参数属性已占用 conversations 名（TS2300 同名冲突）。
test('GET conversations 端点返回 items 且未认证抛 400', async () => {
  const { AssistantController } = await import('../src/modules/assistant/assistant.controller')
  const { BadRequestException } = await import('@nestjs/common')
  const list = async (userId: string) => (userId === 'u1' ? [{ id: 'c1', title: 'A', status: 'active', messageCount: 2, updatedAt: 'x' }] : [])
  const controller = new AssistantController({} as any, {} as any, { list } as any, {} as any)
  const result = await controller.listConversations({ user: { id: 'u1' } } as any)
  assert.deepEqual(result.items.map((i: any) => i.id), ['c1'])
  await assert.rejects(
    () => controller.listConversations({} as any),
    (err: any) => err instanceof BadRequestException,
  )
})
