import assert = require('node:assert/strict')
import { test } from 'node:test'
import { RagRetrievalService } from '../src/modules/ai/rag/rag-retrieval.service'

test('Query rewrite 的规范问题和关键词进入各自检索链路', async () => {
  let keywordInput: any
  let vectorInput: any
  const service = new RagRetrievalService(
    {
      searchKeywordChunks: async (input: any) => { keywordInput = input; return [] },
      searchChunks: async (input: any) => { vectorInput = input; return [] },
    } as any,
    {} as any,
    { chatTask: async () => ({ content: '{"query":"React diff algorithm","keywords":["React","Diff"]}' }) } as any,
  )

  await service.retrieve('React Diff 是什么', '507f1f77bcf86cd799439012', undefined, {
    intent: 'user_history',
    tools: ['keyword', 'chunk_vector'],
    reasoningMode: 'off',
    graphHops: 0,
  })

  assert.equal(vectorInput.query, 'React diff algorithm')
  assert.deepEqual(keywordInput.keywords, ['React', 'Diff'])
})

test('候选去重保留最高分和图谱路径', async () => {
  const shared = { chunkId: 'chunk-1', noteId: 'note-1', title: 'React', headingPath: ['Diff'], content: 'Diff evidence' }
  const service = new RagRetrievalService(
    {
      searchKeywordChunks: async () => [],
      searchChunks: async () => [{ ...shared, score: 0.9 }],
    } as any,
    { expandGraphEvidence: async () => [{ ...shared, noteTitle: 'React', score: 0.35, graphPath: ['seed', 'neighbor'] }] } as any,
    {
      chatTask: async () => ({ content: '{"query":"React Diff","keywords":[]}' }),
      rerank: async () => { throw new Error('rerank unavailable') },
    } as any,
  )

  const result = await service.retrieve('React Diff 区别', '507f1f77bcf86cd799439012', '507f1f77bcf86cd799439013', {
    intent: 'compare', tools: ['chunk_vector', 'graph_expand', 'rerank'], reasoningMode: 'deep', graphHops: 1,
  })

  assert.equal(result.evidence[0].score, 0.9)
  assert.deepEqual(result.evidence[0].graphPath, ['seed', 'neighbor'])
})

test('无 knowledgeBaseId 且计划含 graph_expand 时自动反查自有库并并入扩图候选', async () => {
  let autoSeeds: any = null
  const service = new RagRetrievalService(
    {
      searchKeywordChunks: async () => [],
      searchChunks: async () => [{ chunkId: 'chunk-seed', noteId: 'note-1', title: 'Seed', headingPath: [], content: 'seed evidence', score: 0.9 }],
    } as any,
    {
      expandGraphEvidenceAuto: async (_userId: string, seeds: any[]) => {
        autoSeeds = seeds
        return { evidence: [{ chunkId: 'chunk-neighbor', noteId: 'note-1', noteTitle: 'Neighbor', headingPath: ['H'], content: 'neighbor evidence', graphPath: ['a', 'b'] }], attemptedKbs: 1 }
      },
    } as any,
    { chatTask: async () => ({ content: '{"query":"q","keywords":[]}' }) } as any,
  )

  const result = await service.retrieve('对比 x 和 y 的区别', '507f1f77bcf86cd799439012', undefined, {
    intent: 'compare', tools: ['chunk_vector', 'graph_expand'], reasoningMode: 'deep', graphHops: 1,
  })

  assert.deepEqual(autoSeeds, [{ chunkId: 'chunk-seed', noteId: 'note-1' }], '种子应来自 chunk_vector 候选')
  const graphHit = result.evidence.find((item: any) => item.chunkId === 'chunk-neighbor')
  assert.ok(graphHit, '自动扩图证据应进入候选')
  assert.equal(graphHit.source, 'graph_expand')
  assert.deepEqual(graphHit.graphPath, ['a', 'b'])
  assert.equal(result.warnings.some((warning: string) => warning.includes('跳过图谱扩展')), false, '有库可扩时不得提示跳过')
})

test('无 knowledgeBaseId 且无自有库可扩时提示跳过、普通候选不受影响', async () => {
  const service = new RagRetrievalService(
    {
      searchKeywordChunks: async () => [],
      searchChunks: async () => [{ chunkId: 'chunk-seed', noteId: 'note-1', title: 'Seed', headingPath: [], content: 'seed evidence', score: 0.9 }],
    } as any,
    { expandGraphEvidenceAuto: async () => ({ evidence: [], attemptedKbs: 0 }) } as any,
    { chatTask: async () => ({ content: '{"query":"q","keywords":[]}' }) } as any,
  )

  const result = await service.retrieve('对比 x 和 y 的区别', '507f1f77bcf86cd799439012', undefined, {
    intent: 'compare', tools: ['chunk_vector', 'graph_expand'], reasoningMode: 'deep', graphHops: 1,
  })

  assert.equal(result.warnings.includes('未找到可用的知识库图谱，已跳过图谱扩展'), true)
  assert.equal(result.evidence.some((item: any) => item.chunkId === 'chunk-seed'), true, '普通检索候选不受影响')
})
