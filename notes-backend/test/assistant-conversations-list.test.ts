import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantConversationsService } from '../src/modules/assistant/assistant-conversations.service'

// mock 需与实现链同形：find → sort → lean → exec；测试用明文 id（'u1'/'c1'），
// 因此 userId 过滤须容忍非 ObjectId 字符串（toObjectId 对非法 hex 原样返回）。
// find 必须是非 async（async 返回 Promise，链不上 .sort）；过滤/排序延迟到 exec 执行，
// sort 尊重服务传入的字段与方向（参照 assistant-search.test.ts）——服务漏写/写反 .sort 会让排序断言红。
class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  find(filter: any) {
    const match = () => this.docs.filter((d) => Object.entries(filter).every(([k, v]) => {
      if (typeof v === 'object' && v !== null && '$ne' in v) return String(d[k]) !== String(v.$ne)
      return String(d[k]) === String(v)
    }))
    return {
      sort: (sortSpec: any) => {
        const entry = sortSpec && typeof sortSpec === 'object' ? Object.entries(sortSpec as Record<string, number>)[0] : undefined
        return {
          lean: () => ({
            exec: async () => {
              let rows = match()
              if (entry) {
                const [field, dir] = entry
                rows = [...rows].sort((a, b) => (new Date(a[field] || 0).getTime() - new Date(b[field] || 0).getTime()) * dir)
              }
              return rows
            },
          }),
        }
      },
    }
  }
}

test('list 只返回当前用户未删除会话并按 updatedAt 降序', async () => {
  const model = new MemoryModel([
    { _id: 'c1', userId: 'u1', title: 'A', status: 'active', updatedAt: '2026-09-01T10:00:00.000Z', messageCount: 2 },
    { _id: 'c2', userId: 'u1', title: 'B', status: 'deleted', updatedAt: '2026-09-01T11:00:00.000Z', messageCount: 1 },
    { _id: 'c3', userId: 'u2', title: 'C', status: 'active', updatedAt: '2026-09-01T12:00:00.000Z', messageCount: 0 },
    { _id: 'c4', userId: 'u1', title: 'D', status: 'active', updatedAt: '2026-09-01T09:00:00.000Z', messageCount: 0 },
  ])
  const service = new AssistantConversationsService(model as any)
  const items = await service.list('u1')
  // 同一用户两条未删除会话（c1 10:00、c4 09:00）须按 updatedAt 降序：c1 在前（mock 尊重 .sort 方向）。
  assert.deepEqual(items.map((i) => i.id), ['c1', 'c4'])
  assert.equal(items[0].title, 'A')
})

test('list 包含 archived 会话（仅排除 deleted）', async () => {
  const model = new MemoryModel([
    { _id: 'c1', userId: 'u1', title: '存档', status: 'archived', updatedAt: '2026-09-01T10:00:00.000Z', messageCount: 3 },
  ])
  const service = new AssistantConversationsService(model as any)
  const items = await service.list('u1')
  assert.deepEqual(items.map((i) => i.id), ['c1'])
  assert.equal(items[0].status, 'archived')
})

test('list 返回空数组当用户无会话', async () => {
  const model = new MemoryModel([])
  const service = new AssistantConversationsService(model as any)
  const items = await service.list('u1')
  assert.deepEqual(items, [])
})

test('list 视图映射：缺省字段回退（空标题→新对话、messageCount→0、updatedAt→createdAt、无 lastMessageAt）', async () => {
  const model = new MemoryModel([
    { _id: 'c1', userId: 'u1', title: '', status: 'active', createdAt: '2026-09-02T00:00:00.000Z' },
  ])
  const service = new AssistantConversationsService(model as any)
  const items = await service.list('u1')
  assert.equal(items.length, 1)
  assert.equal(items[0].id, 'c1')
  assert.equal(items[0].title, '新对话')
  assert.equal(items[0].status, 'active')
  assert.equal(items[0].messageCount, 0)
  assert.equal(items[0].updatedAt, '2026-09-02T00:00:00.000Z')
  // lastMessageAt 缺省时值为 undefined（实现按可选字段置 undefined，调用方可不携带）。
  assert.equal(items[0].lastMessageAt, undefined)
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
