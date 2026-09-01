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
