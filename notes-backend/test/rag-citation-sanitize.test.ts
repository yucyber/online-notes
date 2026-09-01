import { test } from 'node:test'
import assert = require('node:assert/strict')
import { createRagCitationSanitizer, sanitizeCitationText } from '../src/modules/ai/rag/rag-citation-sanitize'

const allowed = [
  { noteId: 'n1', noteTitle: 'React', chunkId: 'c1', headingPath: ['前端'], content: 'Diff', excerpt: 'Diff', score: 0.9, source: 'chunk_vector' as const },
]

test('同步版剔除伪造引用并保留有效引用', () => {
  const result = sanitizeCitationText('结论 [E1]，另见 [E999]', allowed)
  assert.equal(result.answer, '结论 [E1]，另见')
  assert.equal(result.citations.length, 1)
  assert.equal(result.invalidReferenceFound, true)
})

test('流式版跨 chunk 拆分也能识别完整标记', () => {
  const sanitizer = createRagCitationSanitizer(allowed)
  const out1 = sanitizer.push('结论 [E')
  const out2 = sanitizer.push('1]，错误 [E99')
  const out3 = sanitizer.push('9] 结束')
  assert.equal(out1, '结论 ')
  assert.equal(out2, '[E1]，错误 ')
  assert.equal(out3, ' 结束')
  assert.equal(sanitizer.flush(), '')
  assert.equal(sanitizer.citations[0].evidenceId, 'E1')
  assert.equal(sanitizer.invalidReferenceFound, true)
})

test('流式版在 `[` 与 `E` 被拆分时也缓冲左括号并识别标记', () => {
  const sanitizer = createRagCitationSanitizer(allowed)
  const out1 = sanitizer.push('结论 [')
  const out2 = sanitizer.push('E1] 更多')
  assert.equal(out1, '结论 ')
  assert.equal(out2, '[E1] 更多')
  assert.equal(sanitizer.flush(), '')
  assert.equal(sanitizer.citations.length, 1)
  assert.equal(sanitizer.citations[0].evidenceId, 'E1')
  assert.equal(sanitizer.invalidReferenceFound, false)
})

test('流结束时悬空的单个左括号由 flush 返回', () => {
  const sanitizer = createRagCitationSanitizer(allowed)
  assert.equal(sanitizer.push('说明见 ['), '说明见 ')
  assert.equal(sanitizer.flush(), '[')
  assert.equal(sanitizer.citations.length, 0)
  assert.equal(sanitizer.invalidReferenceFound, false)
})
