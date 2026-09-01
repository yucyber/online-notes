import { test } from 'node:test'
import assert = require('node:assert/strict')
import { formatSseEvent, parseSseEvent } from '../src/modules/assistant/assistant-stream-format'

test('delta 事件序列化为标准 SSE 块且可回读', () => {
  const block = formatSseEvent({ event: 'delta', data: { text: '你好' } })
  assert.equal(block, 'event: delta\ndata: {"text":"你好"}\n\n')
  const parsed = parseSseEvent(block)
  assert.deepEqual(parsed, { event: 'delta', data: { text: '你好' } })
})

test('complete 事件携带引用与警告', () => {
  const event = { event: 'complete' as const, data: { messageId: 'm1', route: 'rag' as const, citations: [{ evidenceId: 'E1', noteId: 'n1', noteTitle: 't', chunkId: 'c1', headingPath: [], excerpt: 'x' }], warnings: [], runId: 'r1' } }
  const parsed = parseSseEvent(formatSseEvent(event))
  assert.equal(parsed.event, 'complete')
  assert.equal((parsed as any).data.citations[0].evidenceId, 'E1')
})
