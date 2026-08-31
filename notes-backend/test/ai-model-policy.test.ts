import assert = require('node:assert/strict')
import { test } from 'node:test'

import { AI_TASKS, resolveAiModelPolicy } from '../src/modules/ai/ai-model-policy'

test('maps every AI task to one explicit policy', () => {
  assert.equal(AI_TASKS.length, 16)
  for (const task of AI_TASKS) {
    const policy = resolveAiModelPolicy(task)
    assert.ok(policy.primary)
    assert.ok(policy.maxTokens > 0)
  }
})

test('uses standard models without reasoning for summaries and knowledge graph', () => {
  for (const task of ['note_summary', 'aggregate_summary', 'knowledge_graph'] as const) {
    const policy = resolveAiModelPolicy(task)
    assert.equal(policy.tier, 'standard')
    assert.equal(policy.reasoningMode, 'off')
    assert.equal(policy.primary, 'siliconflow_standard')
  }
  assert.equal(resolveAiModelPolicy('note_summary').qualityFallback, 'local_summary')
  assert.equal(resolveAiModelPolicy('note_summary').providerFallback, 'bai_deepseek')
})

test('uses economy only for low-risk short tasks', () => {
  for (const task of ['query_rewrite', 'query_plan', 'search_hit_explanation', 'topic_name', 'pet_chat'] as const) {
    assert.equal(resolveAiModelPolicy(task).tier, 'economy')
    assert.equal(resolveAiModelPolicy(task).reasoningMode, 'off')
  }
})

test('reserves deep and AgentRouter quality fallback for high-risk tasks', () => {
  for (const task of ['destructive_reorganization', 'conflict_analysis', 'proposal_revision'] as const) {
    const policy = resolveAiModelPolicy(task)
    assert.equal(policy.tier, 'deep')
    assert.equal(policy.reasoningMode, 'deep')
    assert.equal(policy.primary, 'siliconflow_deep')
    assert.equal(policy.qualityFallback, 'ar_expert')
    assert.ok(policy.maxTokens >= 4096)
  }
})

test('does not route regular tasks to AgentRouter', () => {
  for (const task of AI_TASKS.filter(task => !['destructive_reorganization', 'conflict_analysis', 'proposal_revision', 'mermaid'].includes(task))) {
    assert.notEqual(resolveAiModelPolicy(task).qualityFallback, 'ar_expert')
  }
})
