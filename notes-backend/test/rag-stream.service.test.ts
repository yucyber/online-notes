import { test } from 'node:test'
import assert = require('node:assert/strict')
import { RagStreamService } from '../src/modules/ai/rag/rag-stream.service'

const evidence = [{ noteId: 'n1', noteTitle: 'React', chunkId: 'c1', headingPath: ['前端'], content: 'Diff', excerpt: 'Diff', score: 0.9, source: 'chunk_vector' as const }]

test('流式回答逐段下发正文并剔除伪造引用', async () => {
  const deltas: string[] = []
  const service = new RagStreamService(
    { plan: async () => ({ intent: 'explain', tools: ['chunk_vector', 'rerank'], reasoningMode: 'off', graphHops: 0 }) } as any,
    { retrieve: async () => ({ evidence, warnings: [], rerankApplied: true, candidateCount: 1 }) } as any,
    { streamTask: async () => sseStream(['这是答案 [E', '1] 另见 [E999]']) } as any,
  )
  const result = await service.streamRagAnswer({ question: 'React 是什么', userId: 'u1' }, {
    onStatus: async () => undefined,
    onDelta: async (text) => { deltas.push(text) },
  })
  assert.equal(deltas.join(''), '这是答案 [E1] 另见 ')
  assert.equal(result.citations[0].evidenceId, 'E1')
  assert.equal(result.warnings.includes('已忽略无效引用'), true)
})

test('无证据时不调用模型并返回降级提示', async () => {
  let modelCalled = false
  const service = new RagStreamService(
    { plan: async () => ({ intent: 'user_history', tools: ['keyword'], reasoningMode: 'off', graphHops: 0 }) } as any,
    { retrieve: async () => ({ evidence: [], warnings: [], rerankApplied: false, candidateCount: 0 }) } as any,
    { streamTask: async () => { modelCalled = true; return sseStream([]) } } as any,
  )
  const result = await service.streamRagAnswer({ question: '我踩了什么坑', userId: 'u1' }, { onStatus: async () => undefined, onDelta: async () => undefined })
  assert.equal(modelCalled, false)
  assert.equal(result.citations.length, 0)
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
