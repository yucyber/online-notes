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
