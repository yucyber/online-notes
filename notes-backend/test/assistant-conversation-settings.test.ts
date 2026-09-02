import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantConversationsService } from '../src/modules/assistant/assistant-conversations.service'

class ConvModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  async findOne(filter: any) { return this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) ?? null }
  async findOneAndUpdate(filter: any, update: any, _opts: any) {
    const doc = this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v)))
    if (doc) Object.assign(doc, update.$set)
    return doc ?? null
  }
}

test('会话设置读写且默认开启记忆', async () => {
  const model = new ConvModel([{ _id: 'c1', userId: 'u1', title: 't', status: 'active' }])
  const service = new AssistantConversationsService(model as any)
  assert.deepEqual(await service.getSettings('u1', 'c1'), { memoryEnabled: true, temporary: false })
  await service.updateSettings('u1', 'c1', { memoryEnabled: false, temporary: true })
  assert.deepEqual(await service.getSettings('u1', 'c1'), { memoryEnabled: false, temporary: true })
  await assert.rejects(() => service.getSettings('u2', 'c1'), /not found/i)
})

test('设置更新只改显式传入字段，未传开关保持原值', async () => {
  // R1-4：PATCH settings 是部分更新——只传 memoryEnabled 时 temporary 不被重置回默认。
  const model = new ConvModel([{ _id: 'c1', userId: 'u1', title: 't', status: 'active' }])
  const service = new AssistantConversationsService(model as any)
  await service.updateSettings('u1', 'c1', { memoryEnabled: false })
  assert.deepEqual(await service.getSettings('u1', 'c1'), { memoryEnabled: false, temporary: false })
  await service.updateSettings('u1', 'c1', { temporary: true })
  assert.deepEqual(await service.getSettings('u1', 'c1'), { memoryEnabled: false, temporary: true })
})
