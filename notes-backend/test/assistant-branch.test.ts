// notes-backend/test/assistant-branch.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NotFoundException } from '@nestjs/common'
import { AssistantConversationsService } from '../src/modules/assistant/assistant-conversations.service'
import { AssistantMessagesService } from '../src/modules/assistant/assistant-messages.service'

// 会话内存模型：findOne/create/deleteOne 覆盖 branch 的读写路径（deleteOne 同步改 docs 并返回可 exec 对象）。
class ConvModel {
  docs: any[]
  created: any = null
  deleteCalls = 0
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  private match(filter: any) {
    return (d: any) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))
  }
  async findOne(filter: any) { return this.docs.find(this.match(filter)) ?? null }
  async create(data: any) {
    const doc = { _id: `c${this.docs.length + 1}`, ...data }
    this.docs.push(doc)
    this.created = doc
    return doc
  }
  deleteOne(filter: any) {
    const index = this.docs.findIndex(this.match(filter))
    if (index >= 0) { this.docs.splice(index, 1); this.deleteCalls += 1 }
    return { exec: async () => ({ deletedCount: index >= 0 ? 1 : 0 }) }
  }
}

// 消息内存模型：find 返回 sort→lean 链（find 非 async，async 返回 Promise 链不上 .sort，同 assistant-search.test.ts 约定）。
// 过滤支持等值与 $lte（copyPrefix 按 seq ≤ throughSeq 且 status='completed' 取前缀）；sort 按数字字段方向排。
// createFailAt = 第 N 次 create 抛错（测 branch 回滚），0 = 不抛。
class MsgModel {
  docs: any[]
  creates: any[] = []
  createFailAt = 0
  constructor(seed: any[] = []) { this.docs = seed.map((d) => ({ ...d })) }
  find(filter: any) {
    return {
      sort: (spec: any) => ({
        lean: async () => {
          let rows = this.docs.filter((d) => Object.entries(filter).every(([k, v]) => {
            const o = v as any
            if (typeof v === 'object' && o?.$lte) return Number(d[k]) <= Number(o.$lte)
            return String(d[k]) === String(v)
          }))
          const entry = spec ? Object.entries(spec as Record<string, number>)[0] : undefined
          if (entry) {
            const [field, dir] = entry
            rows = [...rows].sort((a, b) => (Number(a[field]) - Number(b[field])) * dir)
          }
          return rows
        },
      }),
    }
  }
  async create(data: any) {
    this.creates.push(data)
    if (this.createFailAt && this.creates.length >= this.createFailAt) throw new Error('db down')
    return { _id: `m${this.creates.length}`, ...data }
  }
}

const msg = (over: any) => ({
  role: 'user', route: 'rag', content: 'x', status: 'completed', citations: [], warnings: [],
  createdAt: '2026-09-01T00:00:00.000Z', ...over,
})

test('branch 只复制 completed 前缀并重排 seq、落库溯源与计数', async () => {
  const conv = new ConvModel([{ _id: 'c1', userId: 'u1', title: 'P3 设计', status: 'active' }])
  const msgs = new MsgModel([
    { _id: 'm1', conversationId: 'c1', userId: 'u1', seq: 1, ...msg({ content: 'q1' }) },
    { _id: 'm2', conversationId: 'c1', userId: 'u1', seq: 2, ...msg({ role: 'assistant', content: 'a1', createdAt: '2026-09-01T00:01:00.000Z' }) },
    // 在 throughSeq 范围内但非终态：pending/failed 必须被排除（不复制幽灵占位、失败不伪装成成功）。
    { _id: 'm3', conversationId: 'c1', userId: 'u1', seq: 3, ...msg({ role: 'user', content: 'q-pending', status: 'pending' }) },
    { _id: 'm4', conversationId: 'c1', userId: 'u1', seq: 4, ...msg({ role: 'assistant', content: 'a-failed', status: 'failed' }) },
  ])
  const conversations = new AssistantConversationsService(conv as any)
  const messages = new AssistantMessagesService(msgs as any)
  const result = await conversations.branch('u1', 'c1', 4, messages as any)
  assert.equal(result.id, 'c2')
  assert.equal(result.parentConversationId, 'c1')
  assert.equal(result.forkedFromSeq, 4)
  // 新会话落库字段：标题 + 分支、active、溯源、计数 = 复制的 completed 条数、lastMessageAt = 最后一条前缀 createdAt。
  const created = conv.created
  assert.ok(created.title.includes('分支'))
  assert.equal(created.status, 'active')
  assert.equal(String(created.parentConversationId), 'c1')
  assert.equal(created.forkedFromSeq, 4)
  assert.equal(created.messageCount, 2)
  assert.equal(new Date(created.lastMessageAt).toISOString(), '2026-09-01T00:01:00.000Z')
  // 只复制 seq ≤ throughSeq 且 completed 的消息（m3/m4 被排除），且 seq 从 1 连续重排。
  assert.deepEqual(msgs.creates.map((c) => ({ seq: c.seq, role: c.role, content: c.content, status: c.status })),
    [
      { seq: 1, role: 'user', content: 'q1', status: 'completed' },
      { seq: 2, role: 'assistant', content: 'a1', status: 'completed' },
    ])
})

test('branch 跨用户负路径抛 NotFound 且不建新会话', async () => {
  const conv = new ConvModel([{ _id: 'c1', userId: 'u1', title: 'P3 设计', status: 'active' }])
  const msgs = new MsgModel()
  const conversations = new AssistantConversationsService(conv as any)
  const messages = new AssistantMessagesService(msgs as any)
  await assert.rejects(() => conversations.branch('u2', 'c1', 2, messages as any), NotFoundException)
  assert.equal(conv.docs.length, 1)
})

test('copyPrefix 独立：升序、仅 completed、createdAt 保留、缺失字段兜底', async () => {
  // m9 属他人会话/超出范围应被排除；m3 缺 citations/warnings/createdAt 验证默认兜底。
  const msgs = new MsgModel([
    { _id: 'm2', conversationId: 'c1', userId: 'u1', seq: 2, ...msg({ role: 'assistant', content: 'a1', createdAt: '2026-09-01T00:00:02.000Z' }) },
    { _id: 'm1', conversationId: 'c1', userId: 'u1', seq: 1, ...msg({ content: 'q1', createdAt: '2026-09-01T00:00:01.000Z' }) },
    { _id: 'm3', conversationId: 'c1', userId: 'u1', seq: 3, role: 'user', route: 'pet', content: 'q3', status: 'completed', createdAt: '2026-09-01T00:00:03.000Z' },
    { _id: 'm9', conversationId: 'c9', userId: 'u9', seq: 1, ...msg({ content: 'other' }) },
  ])
  const service = new AssistantMessagesService(msgs as any)
  const prefix = await service.copyPrefix('u1', 'c1', 3)
  // 按 seq 升序；m9（他人会话）不进入副本。
  assert.deepEqual(prefix.map((p) => ({ role: p.role, content: p.content })), [
    { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q3' },
  ])
  prefix.forEach((p) => assert.equal(p.status, 'completed'))
  assert.equal(prefix[0].createdAt.toISOString(), '2026-09-01T00:00:01.000Z')
  assert.deepEqual(prefix[2].citations, [])
  assert.deepEqual(prefix[2].warnings, [])
})

test('branch 复制中途失败时回滚删除新会话并保留原错误', async () => {
  const conv = new ConvModel([{ _id: 'c1', userId: 'u1', title: 'P3 设计', status: 'active' }])
  const msgs = new MsgModel([
    { _id: 'm1', conversationId: 'c1', userId: 'u1', seq: 1, ...msg({ content: 'q1' }) },
    { _id: 'm2', conversationId: 'c1', userId: 'u1', seq: 2, ...msg({ role: 'assistant', content: 'a1' }) },
  ])
  msgs.createFailAt = 2
  const conversations = new AssistantConversationsService(conv as any)
  const messages = new AssistantMessagesService(msgs as any)
  await assert.rejects(() => conversations.branch('u1', 'c1', 2, messages as any), /db down/)
  // 刚创建的空壳会话被删除，不残留孤儿会话。
  assert.equal(conv.docs.some((d) => d._id === 'c2'), false)
  assert.ok(conv.deleteCalls >= 1)
})
