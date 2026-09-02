import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantConversationsService } from '../src/modules/assistant/assistant-conversations.service'
import { AssistantGenerationService } from '../src/modules/assistant/assistant-generation.service'

class MemoryModel {
  docs: any[]
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  private match(filter: any) {
    return (d: any) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))
  }
  async findOne(filter: any) { return this.docs.find(this.match(filter)) ?? null }
  updateOne(filter: any, update: any) {
    const doc = this.docs.find(this.match(filter))
    if (doc) Object.assign(doc, update.$set)
    // 服务按 Mongoose Query 惯例链 .exec()，mock 同步返回可 exec 对象（不能 async：async 方法返回 Promise，链不上 .exec）。
    return { exec: async () => ({ matchedCount: doc ? 1 : 0 }) }
  }
  // findOneAndUpdate 链式 mock：命中则原地应用 $set 并返回更新后 doc（服务总是传 { new: true }），未命中返回 null。
  findOneAndUpdate(filter: any, update: any) {
    const doc = this.docs.find(this.match(filter))
    if (!doc) return { lean: () => ({ exec: async () => null }) }
    const sets = update.$set || {}
    Object.assign(doc, sets)
    const updated = { ...doc }
    return { lean: () => ({ exec: async () => updated }) }
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

test('setStatus 恢复 active 时清除 deletedAt', async () => {
  const model = new MemoryModel([{ _id: 'c1', userId: 'u1', title: 't', status: 'archived', deletedAt: new Date() }])
  const service = new AssistantConversationsService(model as any)
  const result = await service.setStatus('u1', 'c1', 'active')
  assert.equal(result.status, 'active')
  assert.equal(model.docs[0].deletedAt, null)
})

test('rename 落库新标题', async () => {
  const model = new MemoryModel([{ _id: 'c1', userId: 'u1', title: '旧标题', status: 'active' }])
  const service = new AssistantConversationsService(model as any)
  await service.rename('u1', 'c1', '新标题')
  assert.equal(model.docs[0].title, '新标题')
})

test('cancelByConversation 无 activeRequest 时不取消', async () => {
  const conversations = { getActiveRequest: async () => null }
  const service = new AssistantGenerationService(conversations as any, {} as any, {} as any, {} as any, undefined as any)
  let cancelCalled = false
  service.cancel = async () => { cancelCalled = true; return { cancelled: true } }
  await service.cancelByConversation('u1', 'c1')
  assert.equal(cancelCalled, false)
})

test('renameIfDefault 仅当标题仍为默认"新对话"时更新', async () => {
  const model = new MemoryModel([{ _id: 'c1', userId: 'u1', title: '新对话', status: 'active' }])
  const service = new AssistantConversationsService(model as any)
  await service.renameIfDefault('u1', 'c1', '自动标题前缀')
  assert.equal(model.docs[0].title, '自动标题前缀')
})

test('renameIfDefault 标题已改或会话不存在时静默保留（不抛 NotFound）', async () => {
  // R=1 竞态回归：生成期间用户手动改名后，自动标题的条件更新不命中，不得覆盖也不抛错。
  const model = new MemoryModel([
    { _id: 'c1', userId: 'u1', title: '用户手动改的标题', status: 'active' },
    { _id: 'c2', userId: 'u1', title: '新对话', status: 'active' },
  ])
  const service = new AssistantConversationsService(model as any)
  await service.renameIfDefault('u1', 'c1', '自动标题')   // 标题已非默认 → 不更新
  await service.renameIfDefault('u1', 'missing', '自动标题') // 会话不存在 → 静默（尽力而为，与 .catch 兜底一致）
  assert.equal(model.docs[0].title, '用户手动改的标题')
  assert.equal(model.docs[1].title, '新对话')
})
