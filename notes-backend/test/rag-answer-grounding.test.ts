import assert = require('node:assert/strict')
import { test } from 'node:test'
import { RagAnswerService } from '../src/modules/ai/rag/rag-answer.service'

test('RAG answer 只映射本次允许的 evidence ID，并剔除伪造引用', async () => {
  const service = new RagAnswerService(
    { plan: async () => ({ intent: 'explain', tools: ['chunk_vector', 'rerank'], reasoningMode: 'off', graphHops: 0 }) } as any,
    { retrieve: async () => ({ evidence: [{ noteId: 'note-1', noteTitle: 'React', chunkId: 'chunk-1', headingPath: ['前端'], content: 'Diff', excerpt: 'Diff', score: .9 }], warnings: [], rerankApplied: true, candidateCount: 1 }) } as any,
    { chatTask: async () => ({ content: '这是答案 [E1] [E999] [E1]', attempt: {} }) } as any,
    undefined,
  )
  const result = await service.answer('React Diff 是什么', undefined, { userId: '507f1f77bcf86cd799439012' })
  assert.equal(result.citations.length, 1)
  assert.equal(result.citations[0].chunkId, 'chunk-1')
  assert.equal(result.citations[0].evidenceId, 'E1')
  assert.equal(result.answer.includes('[E999]'), false)
  assert.equal(result.warnings.includes('已忽略无效引用'), true)
})

test('有证据但回答未引用时返回可验证性提示', async () => {
  const service = new RagAnswerService(
    { plan: async () => ({ intent: 'explain', tools: ['chunk_vector'], reasoningMode: 'off', graphHops: 0 }) } as any,
    { retrieve: async () => ({ evidence: [{ noteId: 'note-1', noteTitle: 'React', chunkId: 'chunk-1', headingPath: [], content: 'Diff', excerpt: 'Diff', score: .9 }], warnings: [], rerankApplied: false, candidateCount: 1 }) } as any,
    { chatTask: async () => ({ content: '这是没有引用的回答', attempt: {} }) } as any,
    undefined,
  )

  const result = await service.answer('React Diff 是什么', undefined, { userId: '507f1f77bcf86cd799439012' })

  assert.equal(result.warnings.includes('回答未附带可验证引用'), true)
})

test('没有证据时明确拒绝编造笔记事实', async () => {
  const service = new RagAnswerService(
    { plan: async () => ({ intent: 'user_history', tools: ['keyword'], reasoningMode: 'off', graphHops: 0 }) } as any,
    { retrieve: async () => ({ evidence: [], warnings: [], rerankApplied: false, candidateCount: 0 }) } as any,
    { chatTask: async () => { throw new Error('must not call model') } } as any,
    undefined,
  )
  const result = await service.answer('我踩了什么坑', undefined, { userId: '507f1f77bcf86cd799439012' })
  assert.equal(result.answer, '笔记中未找到相关记录。')
})
