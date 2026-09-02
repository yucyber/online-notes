import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantContextService } from '../src/modules/assistant/assistant-context.service'

test('按固定顺序组装分区并省略空认知节', async () => {
  const messages = {
    list: async (_u: string, _c: string, opts?: any) => opts?.afterSeq === 8
      ? [
          { id: 'm9', seq: 9, role: 'user', route: 'rag', content: '继续', status: 'completed', citations: [], warnings: [], createdAt: '' },
          { id: 'm10', seq: 10, role: 'assistant', route: 'rag', content: '好的', status: 'completed', citations: [], warnings: [], createdAt: '' },
        ]
      : [
          // 历史召回数据：m2 须含问题的 CJK bigram（'全屏'/'尺寸'）才能命中 recallHistorical。
          { id: 'm2', seq: 2, role: 'assistant', route: 'rag', content: '结论：全屏尺寸定为 1280px', status: 'completed', citations: [], warnings: [], createdAt: '' },
        ],
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
    { list: async () => [] } as any,
    { getLatest: async () => null } as any,
  )
  const result = await service.assemble({
    userId: 'u1', conversationId: 'c1', question: '界面怎么改',
    memoryRecall: { recall: async () => [{ label: '已确认决策', text: '保留现有浮层，新增全屏工作台' }] } as any,
  })
  const labels = result.sections.map((s) => s.label)
  assert.ok(labels.includes('已确认认知'))
})
