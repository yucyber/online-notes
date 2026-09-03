import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { AssistantConversationsService } from '../src/modules/assistant/assistant-conversations.service'

// 覆盖 create/ensure 所需调用链：findOne().sort().select().lean().exec() + create。
// 明文 id 在 create 内部会被 new Types.ObjectId(userId) 校验，故统一用 24 位 hex（HEX）。
const HEX = 'aaaaaaaaaaaaaaaaaaaaaaaa'

class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  findOne(filter: any) {
    const match = () => this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) ?? null
    return {
      sort: () => ({ select: () => ({ lean: () => ({ exec: async () => match() }) }) }),
    }
  }
  async create(data: any) {
    const doc: any = { _id: new Types.ObjectId().toHexString(), ...data }
    this.docs.push(doc)
    return doc
  }
}

test('create 总是新建 active 会话（即使已有 active 会话也不复用）', async () => {
  // 回归：发消息无 conversationId 时必须开启独立新会话，否则"新建会话"后的消息全部落入第一段会话，
  // 会话记录永远只有一段。
  const model = new MemoryModel([{ _id: 'c1', userId: HEX, title: '第一段', status: 'active' }])
  const service = new AssistantConversationsService(model as any)
  const first = await service.create(HEX)
  const second = await service.create(HEX)
  assert.equal(first.isNew, true)
  assert.equal(second.isNew, true)
  assert.notEqual(first.id, 'c1')
  assert.equal(model.docs.length, 3)
  // status/title 的 active/'新对话' 默认值由 schema 落库（内存 mock 不模拟 schema 默认，此处只断言 create 写入的显式字段）。
  assert.equal(String(model.docs[1].userId), HEX)
})

test('ensure 复用最近 active 会话；无 active（含仅 archived）时才新建', async () => {
  const service = new AssistantConversationsService(new MemoryModel([
    { _id: 'c1', userId: HEX, title: '旧会话', status: 'active', updatedAt: new Date() },
  ]) as any)
  const reused = await service.ensure(HEX)
  assert.equal(reused.id, 'c1')
  assert.equal(reused.isNew, false)

  const model2 = new MemoryModel([{ _id: 'c1', userId: HEX, title: '存档', status: 'archived' }])
  const service2 = new AssistantConversationsService(model2 as any)
  const created = await service2.ensure(HEX)
  assert.equal(created.isNew, true)
  assert.equal(model2.docs.length, 2)
})
