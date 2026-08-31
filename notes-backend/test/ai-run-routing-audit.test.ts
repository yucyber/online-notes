import assert = require('node:assert/strict')
import { test } from 'node:test'

import { AiRunService } from '../src/modules/ai/ai-run.service'

function createModel() {
  const created: any[] = []
  const updates: any[] = []
  return {
    created,
    updates,
    model: {
      create: async (payload: any) => {
        created.push(payload)
        return { toObject: () => payload }
      },
      findOneAndUpdate: (filter: any, update: any) => ({
        exec: async () => {
          updates.push({ filter, update })
          return { toObject: () => ({ ...created[0], ...update.$set }) }
        },
      }),
    },
  }
}

test('AiRunService records routing and fallback metadata without request content', async () => {
  const { model, created, updates } = createModel()
  const service = new AiRunService(model as any)

  await service.start({
    runId: 'run-1',
    graphName: 'knowledge_graph',
    task: 'knowledge_graph',
    reasoningMode: 'off',
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-14B',
  })
  await service.succeed('run-1', {
    task: 'knowledge_graph',
    reasoningMode: 'off',
    provider: 'siliconflow',
    model: 'deepseek-ai/DeepSeek-V4-Flash',
    durationMs: 120,
    retryCount: 0,
    fallbackUsed: true,
    fallbackType: 'quality',
    fallbackReason: 'invalid_output',
    finishReason: 'stop',
    contentChars: 42,
    reasoningChars: 0,
    validationResult: 'valid',
  })

  assert.equal(created[0].task, 'knowledge_graph')
  assert.equal(created[0].reasoningMode, 'off')
  assert.equal(updates[0].update.$set.fallbackType, 'quality')
  assert.equal(updates[0].update.$set.fallbackReason, 'invalid_output')
  assert.equal(updates[0].update.$set.model, 'deepseek-ai/DeepSeek-V4-Flash')
  const stored = JSON.stringify({ created, updates })
  assert.doesNotMatch(stored, /apiKey|prompt|完整正文|hidden reasoning/)

  const forbidden = new Set(['prompt', 'content', 'reasoning', 'apiKey'])
  const visit = (value: any) => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key), false, `stored audit data contains forbidden field: ${key}`)
      visit(child)
    }
  }
  visit({ created, updates })
})
