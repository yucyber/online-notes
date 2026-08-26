import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { SemanticService } from '../src/modules/semantic/semantic.service'

function findChain<T>(value: T) {
  const chain: any = {
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    select: () => chain,
    lean: () => chain,
    exec: async () => value,
  }
  return chain
}

test('Chunk 搜索按 noteId 聚合并返回最佳片段和额外命中数', async () => {
  const noteId = new Types.ObjectId()
  const noteModel = {
    find: (query: any) => query._id?.$in
      ? findChain([{ _id: noteId, title: 'React Diff', content: '正文', updatedAt: new Date('2026-08-26') }])
      : findChain([{ _id: noteId }]),
  }
  const chunks = [
    { chunkId: 'chunk-1', noteId: String(noteId), title: 'React Diff', headingPath: ['React', 'Diff'], content: '最佳证据', score: 0.92 },
    { chunkId: 'chunk-2', noteId: String(noteId), title: 'React Diff', headingPath: ['React', '坑'], content: '另一个证据', score: 0.8 },
  ]
  const service = new SemanticService(
    noteModel as any,
    {} as any,
    {} as any,
    {} as any,
    { readableFilter: () => ({ readable: true }) } as any,
    {} as any,
    { searchChunks: async () => chunks } as any,
  )

  const page = await service.searchVector('react diff', 'user-1', { mode: 'vector', page: 1, limit: 10 })

  assert.equal(page.data.length, 1)
  assert.deepEqual(page.data[0].bestChunk, {
    chunkId: 'chunk-1',
    headingPath: ['React', 'Diff'],
    content: '最佳证据',
    score: 0.92,
    matchType: 'semantic',
  })
  assert.equal(page.data[0].additionalChunkHits, 1)
  assert.deepEqual(page.data[0].additionalChunks, [{
    chunkId: 'chunk-2', headingPath: ['React', '坑'], content: '另一个证据', score: 0.8, matchType: 'semantic',
  }])
})

test('hybrid 合并关键词与 Chunk 候选且同一笔记只返回一次', async () => {
  const noteId = new Types.ObjectId()
  const noteModel = {
    find: (query: any) => {
      if (query._id?.$in) return findChain([{ _id: noteId, title: 'React', content: '正文', updatedAt: new Date('2026-08-26') }])
      return findChain([{ _id: noteId, title: 'React', content: '关键词正文', updatedAt: new Date('2026-08-26') }])
    },
    countDocuments: async () => 1,
  }
  const service = new SemanticService(
    noteModel as any,
    {} as any,
    {} as any,
    {} as any,
    { readableFilter: () => ({ readable: true }) } as any,
    {} as any,
    { searchChunks: async () => [{ chunkId: 'chunk-1', noteId: String(noteId), title: 'React', headingPath: [], content: '语义证据', score: 0.9 }] } as any,
  )

  const page = await service.searchHybrid('React', 'user-1', { mode: 'hybrid', page: 1, limit: 10 })

  assert.equal(page.data.length, 1)
  assert.equal(page.data[0].id, String(noteId))
  assert.equal(page.data[0].bestChunk?.content, '语义证据')
})
