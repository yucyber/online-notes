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
