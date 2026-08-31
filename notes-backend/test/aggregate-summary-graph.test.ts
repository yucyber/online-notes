import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AggregateSummaryGraph } from '../src/modules/ai/graphs/aggregate-summary.graph'
import { AiService } from '../src/modules/ai/ai.service'

test('AggregateSummaryGraph chunks selected notes before final synthesis', async () => {
  const calls: any[] = []
  const gateway = {
    chatTask: async (options: any) => {
      calls.push(options)
      if (options.prompt.includes('Summarize this subset')) return { content: `partial-${calls.length}`, attempt: {} }
      return { content: 'final synthesis', attempt: {} }
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
  calls.forEach(call => assert.equal(call.task, 'aggregate_summary'))
})

test('AiService delegates aggregate summaries to AggregateSummaryGraph while preserving response shape', async () => {
  const notes = [{ title: 'Roadmap', content: 'AI plan' }]
  const graph = {
    run: async (input: any[], context: any) => {
      assert.deepEqual(input, notes)
      assert.deepEqual(context, { userId: 'user-1' })
      return 'graph summary'
    },
  }
  const service = new AiService({} as any, {} as any, undefined, graph as any)
  const result = await service.generateAggregateSummary(notes, { userId: 'user-1' })

  assert.deepEqual(result, { summary: 'graph summary' })
})
