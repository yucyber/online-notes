import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Types } from 'mongoose'
import { ChunkRetrievalService } from '../src/modules/semantic/chunk-retrieval.service'

function findChain<T>(value: T) {
  const chain: any = {
    select: () => chain,
    lean: () => chain,
    exec: async () => value,
  }
  return chain
}

test('Chunk 向量搜索只使用服务端计算出的可读笔记范围', async () => {
  const readableNoteId = new Types.ObjectId()
  const forbiddenNoteId = new Types.ObjectId()
  let pipeline: any[] = []
  const chunkModel = {
    aggregate: (value: any[]) => ({ exec: async () => { pipeline = value; return [
      { _id: new Types.ObjectId(), noteId: readableNoteId, headingPath: ['React'], content: 'Diff', score: 0.9 },
      { _id: new Types.ObjectId(), noteId: forbiddenNoteId, headingPath: ['私有'], content: 'Secret', score: 0.99 },
    ] } }),
  }
  const noteModel = {
    find: (query: any) => query._id
      ? findChain([{ _id: readableNoteId, title: 'React' }])
      : findChain([{ _id: readableNoteId }]),
  }
  const service = new ChunkRetrievalService(
    chunkModel as any,
    noteModel as any,
    {} as any,
    { readableFilter: () => ({ acl: 'readable' }) } as any,
    { generateEmbedding: async () => [0.1] } as any,
  )

  const results = await service.searchChunks({ query: 'react diff', limit: 8 }, new Types.ObjectId().toString())

  assert.equal(results.length, 1)
  assert.equal(results[0].noteId, readableNoteId.toString())
  assert.deepEqual(pipeline[0].$vectorSearch.filter.noteId.$in, [readableNoteId])
})

test('knowledgeBaseId 只允许检索该知识库内仍可读的笔记', async () => {
  const linkedReadableId = new Types.ObjectId()
  const linkedForbiddenId = new Types.ObjectId()
  let readableQuery: any
  const kbNoteModel = {
    find: () => findChain([{ noteId: linkedReadableId }, { noteId: linkedForbiddenId }]),
  }
  const noteModel = {
    find: (query: any) => {
      if (!query._id) readableQuery = query
      return query._id
        ? findChain([{ _id: linkedReadableId, title: 'React' }])
        : findChain([{ _id: linkedReadableId }])
    },
  }
  const chunkModel = {
    aggregate: () => ({ exec: async () => [{
      _id: new Types.ObjectId(), noteId: linkedReadableId, headingPath: [], content: 'Diff', score: 0.8,
    }] }),
  }
  const service = new ChunkRetrievalService(
    chunkModel as any,
    noteModel as any,
    kbNoteModel as any,
    { readableFilter: () => ({ acl: 'readable' }) } as any,
    { generateEmbedding: async () => [0.1] } as any,
  )

  const results = await service.searchChunks(
    { query: 'diff', knowledgeBaseId: new Types.ObjectId().toString(), limit: 8 },
    new Types.ObjectId().toString(),
  )

  assert.deepEqual(readableQuery.$and[1], { _id: { $in: [linkedReadableId, linkedForbiddenId] } })
  assert.deepEqual(results.map((result) => result.noteId), [linkedReadableId.toString()])
})
