import { test } from 'node:test'
import assert = require('node:assert/strict')
import { createMemoryCitationSanitizer } from '../src/modules/ai/rag/rag-citation-sanitize'
import { RagStreamService } from '../src/modules/ai/rag/rag-stream.service'

test('M 标记清洗保留有效引用并剔除伪造', () => {
  const sanitizer = createMemoryCitationSanitizer([{ id: 'M1', label: '已确认认知', text: '保留浮层' }])
  const out = sanitizer.push('按你确认的结论 [M1]，另见 [M999]')
  assert.equal(out, '按你确认的结论 [M1]，另见 ')
  assert.equal(sanitizer.memoryCitations[0].marker, 'M1')
  assert.equal(sanitizer.invalidReferenceFound, true)
})

test('M 版流式跨 chunk 拆分也能识别完整标记', () => {
  const sanitizer = createMemoryCitationSanitizer([
    { id: 'M1', label: '已确认认知', text: '保留浮层' },
    { id: 'M2', label: '已确认认知', text: '用大侧栏' },
  ])
  const out1 = sanitizer.push('结论 [M')
  const out2 = sanitizer.push('1]，错误 [M99')
  const out3 = sanitizer.push('9] 结束')
  assert.equal(out1, '结论 ')
  assert.equal(out2, '[M1]，错误 ')
  assert.equal(out3, ' 结束')
  assert.equal(sanitizer.flush(), '')
  assert.equal(sanitizer.memoryCitations[0].marker, 'M1')
  assert.equal(sanitizer.invalidReferenceFound, true)
})

test('M 版在 `[` 与 `M` 被拆分时也缓冲左括号并识别标记', () => {
  const sanitizer = createMemoryCitationSanitizer([{ id: 'M1', label: '已确认认知', text: '保留浮层' }])
  const out1 = sanitizer.push('结论 [')
  const out2 = sanitizer.push('M1] 更多')
  assert.equal(out1, '结论 ')
  assert.equal(out2, '[M1] 更多')
  assert.equal(sanitizer.flush(), '')
  assert.equal(sanitizer.memoryCitations.length, 1)
  assert.equal(sanitizer.memoryCitations[0].marker, 'M1')
  assert.equal(sanitizer.invalidReferenceFound, false)
})

test('M 版流结束时悬空的单个左括号由 flush 返回', () => {
  const sanitizer = createMemoryCitationSanitizer([{ id: 'M1', label: '已确认认知', text: '保留浮层' }])
  assert.equal(sanitizer.push('说明见 ['), '说明见 ')
  assert.equal(sanitizer.flush(), '[')
  assert.equal(sanitizer.memoryCitations.length, 0)
  assert.equal(sanitizer.invalidReferenceFound, false)
})

test('同一 M 标记多次出现只记一次引用', () => {
  const sanitizer = createMemoryCitationSanitizer([
    { id: 'M1', label: '已确认认知', text: '保留浮层' },
    { id: 'M2', label: '已确认认知', text: '用大侧栏' },
  ])
  const out = sanitizer.push('按 [M1] 与 [M1] 处理，[M2] 兜底')
  assert.equal(out, '按 [M1] 与 [M1] 处理，[M2] 兜底')
  assert.equal(sanitizer.memoryCitations.length, 2)
  assert.deepEqual(sanitizer.memoryCitations.map((c) => c.marker), ['M1', 'M2'])
  assert.equal(sanitizer.invalidReferenceFound, false)
})

const evidence = [{ noteId: 'n1', noteTitle: 'React', chunkId: 'c1', headingPath: ['前端'], content: 'Diff', excerpt: 'Diff', score: 0.9, source: 'chunk_vector' as const }]
const memoryRecallStub = { recall: async () => [{ label: '已确认认知', text: '保留现有浮层' }] }

test('streamRagAnswer 带 memoryRecall 时 prompt 注入认知节、双 sanitizer 并行清洗', async () => {
  const deltas: string[] = []
  let capturedOptions: any
  const service = new RagStreamService(
    { plan: async () => ({ intent: 'explain', tools: ['chunk_vector', 'rerank'], reasoningMode: 'off', graphHops: 0 }) } as any,
    { retrieve: async () => ({ evidence, warnings: [], rerankApplied: true, candidateCount: 1 }) } as any,
    { streamTask: async (options: any) => { capturedOptions = options; return sseStream(['按 [M1] 的结论完成，另见 [M999]']) } } as any,
  )
  const result = await service.streamRagAnswer(
    { question: '界面怎么改', knowledgeBaseId: 'kb1', userId: 'u1', memoryRecall: memoryRecallStub as any },
    { onStatus: async () => undefined, onDelta: async (text: string) => { deltas.push(text) } },
  )
  assert.equal(deltas.join(''), '按 [M1] 的结论完成，另见 ')
  assert.ok(capturedOptions.prompt.includes('[已确认认知]'))
  assert.ok(capturedOptions.prompt.includes('[M1] 已确认认知 | 保留现有浮层'))
  assert.ok(capturedOptions.system.includes('Cite confirmed user memories using only [M1] IDs; cite note evidence using only [E1] IDs. Keep the two systems separate.'))
  assert.equal(result.memoryCitations[0].marker, 'M1')
  assert.equal(result.memoryCitations[0].text, '保留现有浮层')
  assert.ok(result.warnings.includes('已忽略无效引用'))
})

test('streamRagAnswer 不带 memoryRecall 时 memoryCitations 缺省为空且 prompt 不含认知节', async () => {
  const deltas: string[] = []
  let capturedOptions: any
  const service = new RagStreamService(
    { plan: async () => ({ intent: 'explain', tools: ['chunk_vector', 'rerank'], reasoningMode: 'off', graphHops: 0 }) } as any,
    { retrieve: async () => ({ evidence, warnings: [], rerankApplied: true, candidateCount: 1 }) } as any,
    { streamTask: async (options: any) => { capturedOptions = options; return sseStream(['这是答案 [E1]']) } } as any,
  )
  const result = await service.streamRagAnswer(
    { question: 'React 是什么', userId: 'u1' },
    { onStatus: async () => undefined, onDelta: async (text: string) => { deltas.push(text) } },
  )
  assert.equal(deltas.join(''), '这是答案 [E1]')
  assert.equal(result.memoryCitations.length, 0)
  assert.equal(result.citations[0].evidenceId, 'E1')
  assert.ok(!capturedOptions.prompt.includes('[已确认认知]'))
})

test('streamRagAnswer 无证据降级时 memoryCitations 也为空', async () => {
  let modelCalled = false
  const service = new RagStreamService(
    { plan: async () => ({ intent: 'user_history', tools: ['keyword'], reasoningMode: 'off', graphHops: 0 }) } as any,
    { retrieve: async () => ({ evidence: [], warnings: [], rerankApplied: false, candidateCount: 0 }) } as any,
    { streamTask: async () => { modelCalled = true; return sseStream([]) } } as any,
  )
  const result = await service.streamRagAnswer(
    { question: '我踩了什么坑', userId: 'u1', memoryRecall: memoryRecallStub as any },
    { onStatus: async () => undefined, onDelta: async () => undefined },
  )
  assert.equal(modelCalled, false)
  assert.equal(result.memoryCitations.length, 0)
  assert.ok(result.warnings.includes('未找到足够笔记证据'))
})

// 构造一个按 chunk 输出的上游 ReadableStream（模拟 gateway 流式响应）
function sseStream(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
}
