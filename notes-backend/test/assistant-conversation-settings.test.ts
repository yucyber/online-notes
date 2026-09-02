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
