import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AssistantMemoryCandidateSchema } from '../src/modules/assistant/schemas/assistant-memory-candidate.schema'
import { AssistantMemorySchema } from '../src/modules/assistant/schemas/assistant-memory.schema'

test('候选 schema 声明七种类型、状态与证据去重索引', () => {
  const kinds = AssistantMemoryCandidateSchema.path('kind').options.enum
  assert.deepEqual([...kinds].sort(), ['constraint', 'decision', 'fact', 'hypothesis', 'lesson', 'open_question', 'preference'])
  assert.equal(AssistantMemoryCandidateSchema.path('status').options.enum.includes('rejected'), true)
  const index = AssistantMemoryCandidateSchema.indexes()
  assert.ok(index.some(([fields]) => fields.evidenceKey === 1))
})

test('候选 schema 关键字段类型、scope 子文档与默认值', () => {
  assert.equal(AssistantMemoryCandidateSchema.path('userId').instance, 'ObjectId')
  assert.equal(AssistantMemoryCandidateSchema.path('conversationId').instance, 'ObjectId')
  const scope = AssistantMemoryCandidateSchema.path('scope.type')
  assert.equal(scope.instance, 'String')
  assert.deepEqual([...scope.options.enum].sort(), ['conversation', 'global', 'knowledge_base', 'note'])
  assert.equal(AssistantMemoryCandidateSchema.path('scope.id').instance, 'ObjectId')
  assert.equal(AssistantMemoryCandidateSchema.path('status').options.default, 'pending')
  assert.equal(AssistantMemoryCandidateSchema.path('confidence').options.min, 0)
  assert.equal(AssistantMemoryCandidateSchema.path('confidence').options.max, 1)
  assert.equal(AssistantMemoryCandidateSchema.path('evidence').instance, 'Array')
  assert.equal(AssistantMemoryCandidateSchema.path('rejectionReason').instance, 'String')
  assert.equal(AssistantMemoryCandidateSchema.options.collection, 'assistant_memory_candidates')
  assert.ok(AssistantMemoryCandidateSchema.options.timestamps)
})

test('候选 evidenceKey 唯一索引与用户状态复合索引', () => {
  const index = AssistantMemoryCandidateSchema.indexes()
  const unique = index.find(([fields]) => fields.evidenceKey === 1)
  assert.ok(unique)
  assert.equal(unique[1]?.unique, true)
  const compound = index.find(([fields]) => fields.userId === 1 && fields.status === 1 && fields.createdAt === -1)
  assert.ok(compound)
  assert.equal(compound[1]?.name, 'idx_assistant_mc_user_status')
})

test('长期记忆 schema 声明 superseded 状态与证据状态', () => {
  assert.equal(AssistantMemorySchema.path('status').options.enum.includes('superseded'), true)
  assert.equal(AssistantMemorySchema.path('evidenceStatus').options.default, 'ok')
  assert.equal(AssistantMemorySchema.path('scope.type').instance, 'String')
})

test('长期记忆 schema 关键字段类型、关系子文档与时间字段', () => {
  const kinds = AssistantMemorySchema.path('kind').options.enum
  assert.deepEqual([...kinds].sort(), ['constraint', 'decision', 'fact', 'hypothesis', 'lesson', 'open_question', 'preference'])
  assert.equal(AssistantMemorySchema.path('status').options.default, 'confirmed')
  assert.equal(AssistantMemorySchema.path('evidenceStatus').options.enum.includes('stale'), true)
  assert.equal(AssistantMemorySchema.path('scope.id').instance, 'ObjectId')
  const relation = AssistantMemorySchema.path('relation.type')
  assert.equal(relation.instance, 'String')
  assert.deepEqual([...relation.options.enum].sort(), ['contradicts', 'refines', 'supersedes', 'supports'])
  for (const field of ['validFrom', 'validTo', 'confirmedAt']) {
    assert.equal(AssistantMemorySchema.path(field).instance, 'Date')
  }
  assert.equal(AssistantMemorySchema.path('supersededById').instance, 'ObjectId')
  assert.equal(AssistantMemorySchema.path('candidateId').instance, 'ObjectId')
  assert.equal(AssistantMemorySchema.options.collection, 'assistant_memories')
  assert.ok(AssistantMemorySchema.options.timestamps)
})

test('长期记忆 schema 用户状态与用户范围主题复合索引', () => {
  const index = AssistantMemorySchema.indexes()
  const byStatus = index.find(([fields]) => fields.userId === 1 && fields.status === 1 && fields.updatedAt === -1)
  assert.ok(byStatus)
  assert.equal(byStatus[1]?.name, 'idx_assistant_mem_user_status')
  const byScopeSubject = index.find(([fields]) => fields.userId === 1 && fields.scope === 1 && fields.subject === 1)
  assert.ok(byScopeSubject)
  assert.equal(byScopeSubject[1]?.name, 'idx_assistant_mem_user_scope_subject')
})
