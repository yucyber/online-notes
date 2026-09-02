import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantConversationsService } from '../src/modules/assistant/assistant-conversations.service'
import { AssistantGenerationService } from '../src/modules/assistant/assistant-generation.service'

class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  async findOne(filter: any) { return this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) ?? null }
  async updateOne(filter: any, update: any) {
    const doc = this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v)))
    if (doc) Object.assign(doc, update.$set)
  }
}

test('rename 只能改自己的会话', async () => {
  const model = new MemoryModel([{ _id: 'c1', userId: 'u1', title: '旧标题', status: 'active' }])
  const service = new AssistantConversationsService(model as any)
  const renamed = await service.rename('u1', 'c1', '新标题')
  assert.equal(renamed.title, '新标题')
  await assert.rejects(() => service.rename('u2', 'c1', 'x'), /not found/i)
})

test('setStatus 删除时写入 deletedAt', async () => {
  const model = new MemoryModel([{ _id: 'c1', userId: 'u1', title: 't', status: 'active' }])
  const service = new AssistantConversationsService(model as any)
  const result = await service.setStatus('u1', 'c1', 'deleted')
  assert.equal(result.status, 'deleted')
  assert.ok(model.docs[0].deletedAt)
})

test('activeRequest 读写', async () => {
  const model = new MemoryModel([{ _id: 'c1', userId: 'u1', title: 't', status: 'active' }])
  const service = new AssistantConversationsService(model as any)
  await service.setActiveRequest('u1', 'c1', 'req-1')
  assert.equal(await service.getActiveRequest('u1', 'c1'), 'req-1')
  await service.setActiveRequest('u1', 'c1', null)
  assert.equal(await service.getActiveRequest('u1', 'c1'), null)
})

test('cancelByConversation 取消该会话正在运行的生成', async () => {
  const conversations = { getActiveRequest: async () => 'req-9' }
  const service = new AssistantGenerationService(conversations as any, {} as any, {} as any, {} as any, undefined as any)
  let cancelled = ''
  // 用实例方法覆写观测 cancel 调用（cancel 内部依赖私有 cancelKeys/emitters）。
  service.cancel = async (requestId: string): Promise<any> => { cancelled = requestId }
  await service.cancelByConversation('u1', 'c1')
  assert.equal(cancelled, 'req-9')
})
