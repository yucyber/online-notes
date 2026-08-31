import assert = require('node:assert/strict')
import { test } from 'node:test'
import { QueryPlannerService } from '../src/modules/ai/rag/query-planner.service'

test('普通解释只走向量与 rerank，不默认扩图或 deep', async () => {
  const planner = new QueryPlannerService({ chatTask: async () => { throw new Error('should not call AI') } } as any)
  assert.deepEqual(await planner.plan('React Diff 是什么'), {
    intent: 'explain', tools: ['chunk_vector', 'rerank'], reasoningMode: 'off', graphHops: 0,
  })
})

test('比较和用户经历遵循受限工具与深度边界', async () => {
  const planner = new QueryPlannerService({} as any)
  assert.deepEqual(await planner.plan('React Diff 和虚拟 DOM 有什么区别'), {
    intent: 'compare', tools: ['chunk_vector', 'graph_expand', 'rerank'], reasoningMode: 'deep', graphHops: 1,
  })
  assert.deepEqual(await planner.plan('我当时踩了什么坑'), {
    intent: 'user_history', tools: ['keyword', 'chunk_vector', 'rerank'], reasoningMode: 'off', graphHops: 0,
  })
})

test('低置信度 planner 失败或返回非法工具时安全降级', async () => {
  const planner = new QueryPlannerService({ chatTask: async () => ({ content: '{"tools":["delete_notes","graph_expand"],"reasoningMode":"deep"}' }) } as any)
  assert.deepEqual(await planner.plan('?'), {
    intent: 'organize', tools: ['keyword', 'chunk_vector', 'rerank'], reasoningMode: 'deep', graphHops: 0,
  })
})
