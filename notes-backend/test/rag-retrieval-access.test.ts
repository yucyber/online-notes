import assert = require('node:assert/strict')
import { test } from 'node:test'
import { ChunkRetrievalService } from '../src/modules/semantic/chunk-retrieval.service'

test('关键词 Chunk 检索始终使用服务端 ACL 和知识库笔记范围', async () => {
  const readableId = '507f1f77bcf86cd799439011'
  let query: any
  const chain = (value: any) => ({ select: () => chain(value), sort: () => chain(value), lean: () => chain(value), exec: async () => value })
  const service = new ChunkRetrievalService(
    { find: (value: any) => { query = value; return chain([{ _id: '507f1f77bcf86cd799439021', noteId: readableId, headingPath: ['React'], content: 'Diff' }]) } } as any,
    { find: () => chain([{ _id: readableId, title: 'React' }]) } as any,
    { find: () => chain([{ noteId: readableId }]) } as any,
    { readableFilter: () => ({ acl: 'readable' }) } as any,
    {} as any,
  )
  const result = await service.searchKeywordChunks({ query: 'diff', knowledgeBaseId: '507f1f77bcf86cd799439013' }, '507f1f77bcf86cd799439012')
  assert.equal(result.length, 1)
  assert.deepEqual(query.noteId.$in.map(String), [readableId])
  assert.equal(query.userId.toString(), '507f1f77bcf86cd799439012')
})
