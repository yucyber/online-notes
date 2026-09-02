// notes-backend/test/assistant-branch.test.ts
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantConversationsService } from '../src/modules/assistant/assistant-conversations.service'
import { AssistantMessagesService } from '../src/modules/assistant/assistant-messages.service'

test('branch 复制前缀消息并记录来源', async () => {
  let created: any = null
  let copied: any = null
  const convModel = {
    docs: [{ _id: 'c1', userId: 'u1', title: 'P3 设计', status: 'active' }],
    async findOne(filter: any) { return this.docs.find((d: any) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) ?? null },
    async create(data: any) { const doc = { _id: 'c2', ...data }; this.docs.push(doc); created = doc; return doc },
  }
  const msgModel = {
    // find 不能是 async：async 方法返回 Promise，链不上 .sort()（与 assistant-search.test.ts MemoryModel 同约定）。
    find(filter: any) {
      return { sort: () => ({ lean: async () => ([
        { role: 'user', route: 'rag', content: 'q1', status: 'completed', citations: [], warnings: [], createdAt: '2026-09-01T00:00:00.000Z' },
        { role: 'assistant', route: 'rag', content: 'a1', status: 'completed', citations: [], warnings: [], createdAt: '2026-09-01T00:01:00.000Z' },
      ]) }) }
    },
    async create(data: any) { copied = data },
  }
  const conversations = new AssistantConversationsService(convModel as any)
  const messages = new AssistantMessagesService(msgModel as any)
  const result = await conversations.branch('u1', 'c1', 2, messages as any)
  assert.equal(result.parentConversationId, 'c1')
  assert.equal(result.forkedFromSeq, 2)
  assert.ok(created.title.includes('分支'))
  assert.ok(copied)
})
