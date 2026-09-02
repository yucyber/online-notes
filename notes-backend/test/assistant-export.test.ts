import { test } from 'node:test'
import assert = require('node:assert/strict')
import { buildExportLines } from '../src/modules/assistant/assistant-export'

test('导出按会话、消息、引用顺序生成 JSONL 行', () => {
  const lines = buildExportLines(
    { id: 'c1', title: 'P3 设计', createdAt: '2026-09-01T00:00:00.000Z' },
    [
      { seq: 1, role: 'user', route: 'rag', content: '结论？', status: 'completed', citations: [], createdAt: '2026-09-01T00:00:00.000Z' },
      { seq: 2, role: 'assistant', route: 'rag', content: '统一入口 [E1]', status: 'completed', citations: [{ evidenceId: 'E1', noteId: 'n1', noteTitle: 't', chunkId: 'c1', headingPath: [], excerpt: 'x' }], createdAt: '2026-09-01T00:01:00.000Z' },
    ],
  )
  assert.equal(lines.length, 4)
  assert.ok(lines[0].startsWith('{"type":"conversation"'))
  assert.ok(lines[1].startsWith('{"type":"message"'))
  assert.ok(lines[2].startsWith('{"type":"message"'))
  assert.ok(lines[3].startsWith('{"type":"citation"'))
  assert.ok(lines[3].includes('"messageSeq":2'))
})
