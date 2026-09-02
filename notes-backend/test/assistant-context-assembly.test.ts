import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantContextService } from '../src/modules/assistant/assistant-context.service'

test('按固定顺序组装分区并省略空认知节', async () => {
  const messages = {
    list: async () => [
      { id: 'm9', seq: 9, role: 'user', route: 'rag', content: '继续', status: 'completed', citations: [], warnings: [], createdAt: '' },
      { id: 'm10', seq: 10, role: 'assistant', route: 'rag', content: '好的', status: 'completed', citations: [], warnings: [], createdAt: '' },
    ],
    // listBefore 供历史召回：返回 throughSeq 之前最近的历史（mock 简化为固定一条含 bigram 的消息）。
    listBefore: async (_u: string, _c: string, opts?: any) => opts?.seqLte === 8
      ? [
          { id: 'm2', seq: 2, role: 'assistant', route: 'rag', content: '结论：全屏尺寸定为 1280px', status: 'completed', citations: [], warnings: [], createdAt: '' },
        ]
      : [],
  }
  const checkpoints = {
    getLatest: async () => ({ throughSeq: 8, summary: '讨论界面形态', decisions: ['保留浮层'], openQuestions: ['全屏尺寸'], referencedEntities: ['小助手'], sourceMessageIds: [], createdAt: '' }),
  }
  const service = new AssistantContextService(messages as any, checkpoints as any)
  const result = await service.assemble({ userId: 'u1', conversationId: 'c1', question: '全屏尺寸多少合适' })
  const labels = result.sections.map((s) => s.label)
  assert.deepEqual(labels, ['会话摘要', '近期对话', '历史对话召回'])
  const summary = result.sections[0]
  assert.ok(summary.content.includes('讨论界面形态'))
  assert.ok(summary.content.includes('保留浮层'))
  assert.equal(result.recentMessages.length, 2)
})

test('提供认知召回时加入已确认认知分区', async () => {
  const service = new AssistantContextService(
    { list: async () => [], listBefore: async () => [] } as any,
    { getLatest: async () => null } as any,
  )
  const result = await service.assemble({
    userId: 'u1', conversationId: 'c1', question: '界面怎么改',
    memoryRecall: { recall: async () => [{ label: '已确认决策', text: '保留现有浮层，新增全屏工作台' }] } as any,
  })
  const labels = result.sections.map((s) => s.label)
  assert.ok(labels.includes('已确认认知'))
})

test('近期对话过滤未落定消息：pending 占位与 failed 不进入上下文', async () => {
  // P3-1 回归：pending 占位（刚创建、空内容）若进近期对话会悬空成 "assistant: " 行；
  // failed/cancelled 部分内容也不代表已确认结论——只取 completed，与 checkpoint/分支口径一致。
  const messages = {
    list: async () => [
      { id: 'm9', seq: 9, role: 'user', route: 'rag', content: '继续', status: 'completed', citations: [], warnings: [], createdAt: '' },
      { id: 'm10', seq: 10, role: 'assistant', route: 'rag', content: '', status: 'pending', citations: [], warnings: [], createdAt: '' },
      { id: 'm11', seq: 11, role: 'assistant', route: 'rag', content: '好的', status: 'completed', citations: [], warnings: [], createdAt: '' },
    ],
    listBefore: async () => [],
  }
  const service = new AssistantContextService(messages as any, { getLatest: async () => ({ throughSeq: 8, summary: 's', decisions: [], openQuestions: [], referencedEntities: [], sourceMessageIds: [], createdAt: '' }) } as any)
  const result = await service.assemble({ userId: 'u1', conversationId: 'c1', question: '继续' })
  assert.deepEqual(result.recentMessages.map((m) => m.content), ['继续', '好的'])
  const recent = result.sections.find((s) => s.label === '近期对话')
  assert.ok(recent)
  assert.equal(recent!.content, 'user: 继续\nassistant: 好的')
})

test('listBefore 无命中时不加历史对话召回分区', async () => {
  // P2 回归：历史召回走 listBefore 扫 throughSeq 前最近段；无命中时整节省略。
  const messages = { list: async () => [], listBefore: async () => [] }
  const service = new AssistantContextService(messages as any, { getLatest: async () => ({ throughSeq: 8, summary: 's', decisions: [], openQuestions: [], referencedEntities: [], sourceMessageIds: [], createdAt: '' }) } as any)
  const result = await service.assemble({ userId: 'u1', conversationId: 'c1', question: '全屏尺寸多少合适' })
  const labels = result.sections.map((s) => s.label)
  assert.ok(!labels.includes('历史对话召回'))
})

test('英文与标点分词：React，diff 按词命中含 React 的历史消息', async () => {
  // P3-2/3 回归：非 CJK 段按空白与标点拆词（'React，diff' → React/diff，标点不粘连），
  // 否则整段含标点成为一个 token，正则匹配不到旧消息里的 'React'。
  const messages = {
    list: async () => [],
    listBefore: async () => [
      { id: 'm4', seq: 4, role: 'assistant', route: 'pet', content: '结论：用 React 重写前端面板', status: 'completed', citations: [], warnings: [], createdAt: '' },
    ],
  }
  const service = new AssistantContextService(messages as any, { getLatest: async () => ({ throughSeq: 8, summary: 's', decisions: [], openQuestions: [], referencedEntities: [], sourceMessageIds: [], createdAt: '' }) } as any)
  const result = await service.assemble({ userId: 'u1', conversationId: 'c1', question: 'React，diff 怎么对比' })
  const recall = result.sections.find((s) => s.label === '历史对话召回')
  assert.ok(recall, '应命中含 React 的历史消息')
  assert.ok(recall!.content.includes('React'))
})
