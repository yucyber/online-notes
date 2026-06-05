import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AggregateSummaryGraph } from '../src/modules/ai/graphs/aggregate-summary.graph'
import { AiService } from '../src/modules/ai/ai.service'

test('AggregateSummaryGraph chunks selected notes before final synthesis', async () => {
  const calls: any[] = []
  const gateway = {
    chat: async (options: any) => {
      calls.push(options)
      if (options.prompt.includes('Summarize this subset')) return `partial-${calls.length}`
      return 'final synthesis'
    },
  }
  const graph = new AggregateSummaryGraph(gateway as any, { maxChunkChars: 180 })

  const summary = await graph.run([
    { title: 'A', content: 'alpha '.repeat(40), updatedAt: '2026-06-01T00:00:00.000Z' },
    { title: 'B', content: 'beta '.repeat(40), updatedAt: '2026-06-02T00:00:00.000Z' },
  ])

  assert.equal(summary, 'final synthesis')
  assert.equal(calls.length, 3)
  assert.match(calls[0].prompt, /Summarize this subset/)
  assert.match(calls[1].prompt, /Summarize this subset/)
  assert.match(calls[2].prompt, /partial-1/)
  assert.match(calls[2].prompt, /partial-2/)
  assert.doesNotMatch(calls[2].prompt, /alpha alpha alpha/)
})

test('AiService delegates aggregate summaries to AggregateSummaryGraph while preserving response shape', async () => {
  const notes = [{ title: 'Roadmap', content: 'AI plan' }]
  const graph = {
    run: async (input: any[]) => {
      assert.deepEqual(input, notes)
      return 'graph summary'
    },
  }
  const gateway = {
    describeChatRoute: () => ({ provider: 'mimo', model: 'mimo-v2.5-pro' }),
  }
  const service = new AiService(gateway as any, undefined, graph as any)

  const result = await service.generateAggregateSummary(notes)

  assert.deepEqual(result, { summary: 'graph summary' })
})
