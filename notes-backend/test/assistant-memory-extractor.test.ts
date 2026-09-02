import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantMemoryExtractorService } from '../src/modules/assistant/assistant-memory-extractor.service'

class MemoryCandidateModel {
  docs: any[] = []
  async insertMany(items: any[]) { this.docs.push(...items); return items }
  async findOne(filter: any) { return this.docs.find((d) => Object.entries(filter).every(([k, v]) => String(d[k]) === String(v))) ?? null }
}

// transcript 每行以 [m:<id>] 前缀暴露消息 id，模型只能引用这些 id——测试从真实 prompt 里解析回填。
function transcriptLineIds(prompt: string): string[] {
  return [...String(prompt).matchAll(/\[m:([^\]]+)\]/g)].map((m) => m[1])
}

test('提取合法候选并跳过重复证据', async () => {
  const model = new MemoryCandidateModel()
  const messages = {
    listBefore: async () => [
      { id: 'um1', seq: 1, role: 'user', route: 'rag', content: '我决定保留现有浮层', status: 'completed', citations: [], warnings: [], createdAt: '' },
      { id: 'am1', seq: 2, role: 'assistant', route: 'rag', content: '好的，已记录', status: 'completed', citations: [{ evidenceId: 'E1', noteId: 'n1', noteTitle: 't', chunkId: 'c1', headingPath: [], excerpt: 'x' }], warnings: [], createdAt: '' },
    ],
  }
  const gateway = {
    chatTask: async () => ({ content: JSON.stringify({ candidates: [{ kind: 'decision', subject: '界面形态', statement: '保留现有浮层', confidence: 0.9, messageIds: ['um1'] }] }) }),
  }
  const service = new AssistantMemoryExtractorService(model as any, gateway as any, messages as any)
  const first = await service.extract('u1', 'c1')
  assert.equal(first.created, 1)
  const second = await service.extract('u1', 'c1')
  assert.equal(second.created, 0)
  assert.equal(second.skipped, 1)
})

test('仅来自助手建议且无笔记证据的候选强制为 hypothesis', async () => {
  const model = new MemoryCandidateModel()
  const messages = {
    listBefore: async () => [
      { id: 'am1', seq: 2, role: 'assistant', route: 'pet', content: '我建议你用大侧栏', status: 'completed', citations: [], warnings: [], createdAt: '' },
    ],
  }
  const gateway = {
    chatTask: async () => ({ content: JSON.stringify({ candidates: [{ kind: 'decision', subject: '布局', statement: '用大侧栏', confidence: 0.6, messageIds: ['am1'] }] }) }),
  }
  const service = new AssistantMemoryExtractorService(model as any, gateway as any, messages as any)
  await service.extract('u1', 'c1')
  assert.equal(model.docs[0].kind, 'hypothesis')
})

test('会话临时或关闭记忆时不提取', async () => {
  const model = new MemoryCandidateModel()
  const conversations = { getSettings: async () => ({ memoryEnabled: false, temporary: true }) }
  const service = new AssistantMemoryExtractorService(model as any, {} as any, {} as any, conversations as any)
  const result = await service.extract('u1', 'c1')
  assert.equal(result.created, 0)
  assert.equal(result.skipped, 0)
})

test('仅关闭 memoryEnabled 或仅临时会话都跳过提取', async () => {
  // R1-4：两个开关各自单独命中即短路，不依赖另一个开关的值。
  for (const settings of [{ memoryEnabled: false, temporary: false }, { memoryEnabled: true, temporary: true }]) {
    const model = new MemoryCandidateModel()
    const conversations = { getSettings: async () => settings }
    const service = new AssistantMemoryExtractorService(model as any, {} as any, {} as any, conversations as any)
    assert.deepEqual(await service.extract('u1', 'c1'), { created: 0, skipped: 0 })
    assert.equal(model.docs.length, 0)
  }
})

test('getSettings 失败时按允许提取降级', async () => {
  const model = new MemoryCandidateModel()
  const conversations = { getSettings: async () => { throw new Error('conversation not found') } }
  const messages = {
    listBefore: async () => [
      { id: 'um1', seq: 1, role: 'user', route: 'rag', content: '结论是什么', status: 'completed', citations: [], warnings: [], createdAt: '' },
    ],
  }
  const gateway = {
    chatTask: async () => ({ content: JSON.stringify({ candidates: [{ kind: 'fact', subject: '主题', statement: '结论 X', confidence: 0.8, messageIds: ['um1'] }] }) }),
  }
  const service = new AssistantMemoryExtractorService(model as any, gateway as any, messages as any, conversations as any)
  const result = await service.extract('u1', 'c1')
  assert.equal(result.created, 1)
})

test('transcript 暴露消息 id：模型引用真实 id 时消息证据与 note_chunk 证据都落库', async () => {
  // R1-1 回归：旧实现 transcript 只有 role/content，模型无从产出可反查的 messageIds，
  // evidence 恒空。此测试让 gateway 只引用 transcript 里真实出现的 [m:<id>]，并覆盖
  // assistant 带 citations 消息 → note_chunk 证据分支（R1-4）。
  const model = new MemoryCandidateModel()
  const messages = {
    listBefore: async () => [
      { id: 'um1', seq: 1, role: 'user', route: 'rag', content: '请按这篇笔记整理', status: 'completed', citations: [], warnings: [], createdAt: '' },
      { id: 'am1', seq: 2, role: 'assistant', route: 'rag', content: '已整理如下', status: 'completed', citations: [{ evidenceId: 'E1', noteId: 'n1', noteTitle: '整理稿', chunkId: 'c1', headingPath: [], excerpt: '片段' }], warnings: [], createdAt: '' },
    ],
  }
  const gateway = {
    chatTask: async (opts: any) => {
      const lines = String(opts.prompt).split('\n')
      const userLine = lines.find((l: string) => /\[m:[^\]]+\] user:/.test(l))
      const assistantLine = lines.find((l: string) => /\[m:[^\]]+\] assistant:/.test(l))
      const idOf = (line?: string) => (line ? /\[m:([^\]]+)\]/.exec(line)?.[1] : undefined)
      const userId = idOf(userLine)
      const assistantId = idOf(assistantLine)
      // transcript 未暴露 id（回归态）时模型无法指认任何消息 → 不产出候选，断言 created 会红。
      const candidates = userId && assistantId
        ? [
            { kind: 'decision', subject: '整理方式', statement: '用户要求按笔记整理', confidence: 0.9, messageIds: [userId] },
            { kind: 'decision', subject: '整理结论', statement: '助手已按稿完成整理', confidence: 0.8, messageIds: [assistantId] },
          ]
        : []
      return { content: JSON.stringify({ candidates }) }
    },
  }
  const service = new AssistantMemoryExtractorService(model as any, gateway as any, messages as any)
  const result = await service.extract('u1', 'c1')
  assert.equal(result.created, 2)
  assert.equal(result.skipped, 0)
  const userDoc = model.docs.find((d) => d.subject === '整理方式')
  const noteDoc = model.docs.find((d) => d.subject === '整理结论')
  assert.ok(userDoc, '引用用户消息的候选应落库')
  assert.ok(noteDoc, '引用带 citations 的助手消息的候选应落库')
  assert.deepEqual(userDoc.evidence[0], { type: 'message', messageId: 'um1', excerpt: '请按这篇笔记整理' })
  assert.equal(noteDoc.evidence[0].type, 'note_chunk')
  assert.equal(noteDoc.evidence[0].noteId, 'n1')
  assert.equal(noteDoc.evidence[0].chunkId, 'c1')
  // 助手建议有 note_chunk 笔记证据支撑时不得降级为 hypothesis（与"无笔记证据才降级"规则区分）。
  assert.equal(noteDoc.kind, 'decision')
})

test('长会话（>200 条）提取最新一轮而非卡在最旧窗口', async () => {
  // R1-3 回归：旧实现 messages.list 升序封顶 200（= 最旧 200 条）再取尾部，>200 条时窗口卡死在旧消息；
  // 提取必须走 listBefore 按最近窗口取。mock 忠实复刻两个方法的真实差异语义。
  const all = Array.from({ length: 250 }, (_, i) => {
    const seq = i + 1
    const role = seq % 2 === 1 ? 'user' : 'assistant'
    return { id: `m${seq}`, seq, role, route: 'rag', content: `第 ${seq} 条内容`, status: 'completed', citations: [], warnings: [], createdAt: '' }
  })
  const messages = {
    list: async () => all.slice(0, 200),
    listBefore: async (_u: string, _c: string, opts?: { limit?: number }) => all.slice(-(opts?.limit ?? 200)),
  }
  const model = new MemoryCandidateModel()
  let prompt = ''
  const gateway = {
    chatTask: async (opts: any) => {
      prompt = String(opts.prompt)
      const lastUserLine = [...prompt.split('\n')].reverse().find((l: string) => /\[m:[^\]]+\] user:/.test(l))
      const userId = lastUserLine ? /\[m:([^\]]+)\]/.exec(lastUserLine)?.[1] : undefined
      return { content: JSON.stringify({ candidates: userId ? [{ kind: 'fact', subject: '最新主题', statement: '最近一轮的结论', confidence: 0.8, messageIds: [userId] }] : [] }) }
    },
  }
  const service = new AssistantMemoryExtractorService(model as any, gateway as any, messages as any)
  const result = await service.extract('u1', 'c1')
  assert.equal(result.created, 1)
  assert.equal(model.docs[0].evidence[0].messageId, 'm249', '证据应指向最新一轮的用户消息')
  assert.ok(prompt.includes('第 249 条内容'), 'transcript 应含最新消息内容')
  assert.ok(transcriptLineIds(prompt).includes('m249'), '最新轮次的 id 应出现在 transcript')
  assert.equal(prompt.includes('第 1 条内容'), false, '不得从最旧 200 条里取窗口')
})
