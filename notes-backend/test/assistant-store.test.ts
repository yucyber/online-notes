import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantMessagesService } from '../src/modules/assistant/assistant-messages.service'

// 最小内存模型：支持 findOne/find/create/findOneAndUpdate；findOne 支持 .sort().select().lean().exec()、find 支持 .sort().limit().lean().exec()；过滤器支持 $gt 运算符。updateOne 未实现（本任务测试未覆盖更新路径）。
function matches(d: any, filter: any): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$gt' in v) return Number(d[k]) > (v as { $gt: number }).$gt
    return String(d[k]) === String(v)
  })
}
class MemoryModel {
  docs: any[] = []
  constructor(private readonly seed: any[] = []) { this.docs = seed.map((d) => ({ ...d, _id: d._id || `id-${Math.random()}` })) }
  findOne(filter: any) {
    const doc = this.docs.find((d) => matches(d, filter)) ?? null
    const exec = async () => doc
    return {
      sort: () => ({ select: () => ({ lean: () => ({ exec }) }) }),
      lean: () => ({ exec }),
    }
  }
  find(filter: any) {
    const result = this.docs.filter((d) => matches(d, filter))
    const execAll = async () => [...result].sort((a, b) => a.seq - b.seq)
    return {
      sort: () => ({ limit: (n: number) => ({ lean: () => ({ exec: async () => (await execAll()).slice(0, n) }) }) }),
      lean: () => ({ exec: execAll }),
    }
  }
  async create(data: any) { const doc = { ...data, _id: data._id || `id-${this.docs.length + 1}` }; this.docs.push(doc); return doc }
  async findOneAndUpdate(filter: any, update: any) {
    const doc = this.docs.find((d) => matches(d, filter))
    if (!doc) return null
    const sets = update.$set || {}
    Object.assign(doc, sets)
    return { ...doc }
  }
}

test('消息按 seq 升序返回并支持 afterSeq 游标', async () => {
  const model = new MemoryModel([
    { _id: 'm1', conversationId: 'cccccccccccccccccccccccc', userId: 'aaaaaaaaaaaaaaaaaaaaaaaa', seq: 1, role: 'user', route: 'pet', content: 'hi', status: 'completed' },
    { _id: 'm2', conversationId: 'cccccccccccccccccccccccc', userId: 'aaaaaaaaaaaaaaaaaaaaaaaa', seq: 2, role: 'assistant', route: 'pet', content: 'hello', status: 'completed' },
  ])
  const service = new AssistantMessagesService(model as any)
  const all = await service.list('aaaaaaaaaaaaaaaaaaaaaaaa', 'cccccccccccccccccccccccc')
  assert.deepEqual(all.map((m) => m.seq), [1, 2])
  const after = await service.list('aaaaaaaaaaaaaaaaaaaaaaaa', 'cccccccccccccccccccccccc', { afterSeq: 1 })
  assert.deepEqual(after.map((m) => m.seq), [2])
})

test('getByRequestId 按用户与 requestId 精确查询', async () => {
  const model = new MemoryModel([{ _id: 'm1', conversationId: 'cccccccccccccccccccccccc', userId: 'aaaaaaaaaaaaaaaaaaaaaaaa', seq: 1, role: 'user', route: 'rag', content: 'q', status: 'completed', requestId: 'req-1' }])
  const service = new AssistantMessagesService(model as any)
  assert.ok(await service.getByRequestId('aaaaaaaaaaaaaaaaaaaaaaaa', 'req-1'))
  assert.equal(await service.getByRequestId('bbbbbbbbbbbbbbbbbbbbbbbb', 'req-1'), null)
})
