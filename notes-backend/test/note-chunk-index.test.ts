import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NoteChunkIndexService } from '../src/modules/notes/note-chunk-index.service'

const updatedAt = new Date('2026-08-26T09:00:00.000Z')

function queryResult<T>(value: T) {
  return { lean: () => ({ exec: async () => value }) }
}

test('内容哈希未变化的 Chunk 复用已有 embedding', async () => {
  let embeddingCalls = 0
  let bulkCalls = 0
  const built = [{ chunkIndex: 0, headingPath: ['React'], content: 'Diff', contentHash: 'same', tokenCount: 1 }]
  const service = new NoteChunkIndexService(
    { find: () => queryResult([{ chunkIndex: 0, contentHash: 'same', embedding: [0.5], embeddingModel: 'Qwen/Qwen3-Embedding-8B', chunkStrategyVersion: 'heading-aware-v1' }]), bulkWrite: async () => { bulkCalls++ } } as any,
    { exists: async () => ({ _id: 'note-1' }) } as any,
    { buildChunks: () => built } as any,
    { generateEmbedding: async () => { embeddingCalls++; return [0.1] } } as any,
  )

  const result = await service.refreshNoteChunks({
    noteId: 'note-1', userId: 'user-1', title: 'React', content: 'Diff', expectedUpdatedAt: updatedAt,
  })

  assert.deepEqual(result, { total: 1, reused: 1, embedded: 0, removed: 0, failed: 0, stale: false })
  assert.equal(embeddingCalls, 0)
  assert.equal(bulkCalls, 0)
})

test('旧 Chunk 缺少模型和切分版本时复用 embedding 并补齐元数据', async () => {
  const bulkOperations: any[] = []
  const built = [{ chunkIndex: 0, headingPath: ['React'], content: '<p>Diff</p>', contentHash: 'same', tokenCount: 1 }]
  const service = new NoteChunkIndexService(
    {
      find: () => queryResult([{ chunkIndex: 0, contentHash: 'same', embedding: [0.5] }]),
      bulkWrite: async (operations: any[]) => { bulkOperations.push(...operations) },
    } as any,
    { exists: async () => ({ _id: 'note-1' }) } as any,
    { buildChunks: () => built } as any,
    { generateEmbedding: async () => { throw new Error('不应重新请求 embedding') } } as any,
  )

  await service.refreshNoteChunks({
    noteId: 'note-1', userId: 'user-1', title: 'React', content: 'Diff', expectedUpdatedAt: updatedAt,
  })

  assert.equal(bulkOperations.length, 1)
  assert.equal(bulkOperations[0].replaceOne.replacement.embeddingModel, 'Qwen/Qwen3-Embedding-8B')
  assert.equal(bulkOperations[0].replaceOne.replacement.chunkStrategyVersion, 'heading-aware-v1')
})

test('只为变化的 Chunk 生成 embedding 并替换失效位置', async () => {
  const embeddedTexts: string[] = []
  const bulkOperations: any[] = []
  const built = [
    { chunkIndex: 0, headingPath: ['React', 'Diff'], content: 'unchanged', contentHash: 'same', tokenCount: 1 },
    { chunkIndex: 1, headingPath: ['React', '性能'], content: 'changed', contentHash: 'new', tokenCount: 1 },
  ]
  const service = new NoteChunkIndexService(
    {
      find: () => queryResult([
        { chunkIndex: 0, contentHash: 'same', embedding: [0.5], embeddingModel: 'Qwen/Qwen3-Embedding-8B', chunkStrategyVersion: 'heading-aware-v1' },
        { chunkIndex: 1, contentHash: 'old', embedding: [0.4] },
        { chunkIndex: 2, contentHash: 'removed', embedding: [0.3] },
      ]),
      bulkWrite: async (operations: any[]) => { bulkOperations.push(...operations) },
    } as any,
    { exists: async () => ({ _id: 'note-1' }) } as any,
    { buildChunks: () => built } as any,
    { generateEmbedding: async (text: string) => { embeddedTexts.push(text); return [0.9] } } as any,
  )

  const result = await service.refreshNoteChunks({
    noteId: 'note-1', userId: 'user-1', title: 'React', content: '正文', expectedUpdatedAt: updatedAt,
  })

  assert.equal(embeddedTexts[0], 'React\nReact > 性能\nchanged')
  assert.deepEqual(result, { total: 2, reused: 1, embedded: 1, removed: 1, failed: 0, stale: false })
  assert.equal(bulkOperations.length, 2)
})

test('任一 embedding 失败时保留上一版 Chunk', async () => {
  let bulkCalls = 0
  const service = new NoteChunkIndexService(
    { find: () => queryResult([]), bulkWrite: async () => { bulkCalls++ } } as any,
    { exists: async () => ({ _id: 'note-1' }) } as any,
    { buildChunks: () => [{ chunkIndex: 0, headingPath: [], content: 'body', contentHash: 'hash', tokenCount: 1 }] } as any,
    { generateEmbedding: async () => [] } as any,
  )

  const result = await service.refreshNoteChunks({
    noteId: 'note-1', userId: 'user-1', title: 'Title', content: 'body', expectedUpdatedAt: updatedAt,
  })

  assert.equal(result.failed, 1)
  assert.equal(bulkCalls, 0)
})

test('来源笔记版本已变化时不写入旧 Chunk', async () => {
  let bulkCalls = 0
  const service = new NoteChunkIndexService(
    { find: () => queryResult([]), bulkWrite: async () => { bulkCalls++ } } as any,
    { exists: async () => null } as any,
    { buildChunks: () => [{ chunkIndex: 0, headingPath: [], content: 'body', contentHash: 'hash', tokenCount: 1 }] } as any,
    { generateEmbedding: async () => [0.1] } as any,
  )

  const result = await service.refreshNoteChunks({
    noteId: 'note-1', userId: 'user-1', title: 'Title', content: 'body', expectedUpdatedAt: updatedAt,
  })

  assert.equal(result.stale, true)
  assert.equal(bulkCalls, 0)
})
