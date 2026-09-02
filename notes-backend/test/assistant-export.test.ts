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

test('时间统一归一化为 ISO 8601（本地化串输入 → UTC ISO 输出，无效日期回退原值）', () => {
  const lines = buildExportLines(
    { id: 'c1', title: 't', createdAt: 'Tue Sep 01 2026 10:00:00 GMT+0800 (中国标准时间)' },
    [
      { seq: 1, role: 'user', route: 'rag', content: 'q', status: 'completed', citations: [], createdAt: 'not-a-date' },
    ],
  )
  const conv = JSON.parse(lines[0])
  assert.equal(conv.createdAt, '2026-09-01T02:00:00.000Z')
  const msg = JSON.parse(lines[1])
  assert.equal(msg.createdAt, 'not-a-date') // 无效日期回退原值，不抛错
})
