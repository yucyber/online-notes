import assert = require('node:assert/strict')
import { test } from 'node:test'

import { evaluateAiRouteSamples } from '../scripts/evaluate-ai-routes'

test('AI route evaluator reports rates and percentiles without sample content', async () => {
  const gateway = {
    describeTaskRoute: () => ({ provider: 'siliconflow', model: 'Qwen/Qwen3-14B' }),
    chatTask: async (sample: any) => ({
      content: sample.prompt.includes('empty') ? '' : 'private model response',
      attempt: {
        fallbackUsed: sample.prompt.includes('fallback'),
        durationMs: sample.prompt.includes('slow') ? 100 : 10,
      },
    }),
  }

  const report = await evaluateAiRouteSamples(gateway as any, [
    { task: 'note_summary', prompt: 'private-note-a' },
    { task: 'note_summary', prompt: 'private-note-fallback' },
    { task: 'note_summary', prompt: 'private-note-empty-slow' },
  ] as any)

  assert.equal(report.routes[0].samples, 3)
  assert.equal(report.routes[0].validRate, 2 / 3)
  assert.equal(report.routes[0].emptyContentRate, 1 / 3)
  assert.equal(report.routes[0].fallbackRate, 1 / 3)
  assert.equal(report.routes[0].p50Ms, 10)
  assert.equal(report.routes[0].p95Ms, 100)
  assert.doesNotMatch(JSON.stringify(report), /private-note|private model response/)
})
