import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NoteDerivedService } from '../src/modules/notes/note-derived.service'
import { NoteVectorSourceService } from '../src/modules/notes/note-vector-source.service'

test('主题向量写回来源信息且不改变笔记业务更新时间', async () => {
  const calls: any[] = []
  const noteModel = {
    updateOne: (...args: any[]) => {
      calls.push(args)
      return { exec: async () => ({ acknowledged: true, modifiedCount: 1 }) }
    },
  }
  const service = new NoteDerivedService(
    noteModel as any,
    { generateEmbedding: async () => [0.1, 0.2] } as any,
    {} as any,
    {} as any,
    new NoteVectorSourceService(),
  )

  await service.updateTopicEmbedding(
    { _id: 'note-1', title: 'React', content: '正文' } as any,
    '标题：React\n摘要：Diff 摘要',
  )

  assert.deepEqual(calls[0][1].$set.embedding, [0.1, 0.2])
  assert.equal(calls[0][1].$set.embeddingSourceHash.length, 64)
  assert.equal(calls[0][1].$set.embeddingModel, 'Qwen/Qwen3-Embedding-8B')
  assert.ok(calls[0][1].$set.embeddingUpdatedAt instanceof Date)
  assert.deepEqual(calls[0][2], { timestamps: false })
})

test('正文变化时先生成最终摘要，再用分类和标签名称生成主题向量', async () => {
  const embeddedTexts: string[] = []
  const updates: any[] = []
  let summaryCalls = 0
  const noteModel = {
    updateOne: (...args: any[]) => {
      updates.push(args)
      return { exec: async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 }) }
    },
  }
  const service = new NoteDerivedService(
    noteModel as any,
    { generateEmbedding: async (text: string) => { embeddedTexts.push(text); return [0.1] } } as any,
    { generateSummary: async () => { summaryCalls++; return 'AI 最终摘要' } } as any,
    { invalidateLists: async () => undefined } as any,
    new NoteVectorSourceService(),
    { findOwnedName: async () => '前端' } as any,
    { findOwnedNames: async () => ['性能', 'React'] } as any,
  )
  const expectedUpdatedAt = new Date('2026-08-26T09:00:00.000Z')

  await service.refreshTopicArtifacts({
    noteId: 'note-1',
    userId: 'user-1',
    title: 'React Diff',
    content: '旧正文不应进入主题向量',
    summary: '兜底摘要',
    categoryId: 'category-1',
    tagIds: ['tag-1', 'tag-2'],
    expectedUpdatedAt,
  }, { titleChanged: false, contentChanged: true, taxonomyChanged: false })

  assert.equal(summaryCalls, 1)
  assert.equal(embeddedTexts[0], '标题：React Diff\n摘要：AI 最终摘要\n分类：前端\n标签：React、性能')
  assert.equal(embeddedTexts[0].includes('旧正文'), false)
  assert.deepEqual(updates[0][0], { _id: 'note-1', updatedAt: expectedUpdatedAt })
})

test('只修改分类标签时复用现有摘要，不调用摘要模型', async () => {
  let summaryCalls = 0
  const embeddedTexts: string[] = []
  const noteModel = {
    updateOne: () => ({ exec: async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 }) }),
  }
  const service = new NoteDerivedService(
    noteModel as any,
    { generateEmbedding: async (text: string) => { embeddedTexts.push(text); return [0.1] } } as any,
    { generateSummary: async () => { summaryCalls++; return '不应生成' } } as any,
    { invalidateLists: async () => undefined } as any,
    new NoteVectorSourceService(),
    { findOwnedName: async () => '后端' } as any,
    { findOwnedNames: async () => ['NestJS'] } as any,
  )

  await service.refreshTopicArtifacts({
    noteId: 'note-1',
    userId: 'user-1',
    title: '依赖注入',
    content: '正文',
    summary: '已有摘要',
    categoryId: 'category-1',
    tagIds: ['tag-1'],
    expectedUpdatedAt: new Date('2026-08-26T09:00:00.000Z'),
  }, { titleChanged: false, contentChanged: false, taxonomyChanged: true })

  assert.equal(summaryCalls, 0)
  assert.equal(embeddedTexts[0], '标题：依赖注入\n摘要：已有摘要\n分类：后端\n标签：NestJS')
})

test('陈旧快照未能写回摘要时停止生成主题向量', async () => {
  let embeddingCalls = 0
  const noteModel = {
    updateOne: () => ({ exec: async () => ({ acknowledged: true, matchedCount: 0, modifiedCount: 0 }) }),
  }
  const service = new NoteDerivedService(
    noteModel as any,
    { generateEmbedding: async () => { embeddingCalls++; return [0.1] } } as any,
    { generateSummary: async () => '过期摘要' } as any,
    { invalidateLists: async () => undefined } as any,
    new NoteVectorSourceService(),
  )

  await service.refreshTopicArtifacts({
    noteId: 'note-1',
    userId: 'user-1',
    title: '标题',
    content: '旧正文',
    summary: '旧摘要',
    tagIds: [],
    expectedUpdatedAt: new Date('2026-08-26T09:00:00.000Z'),
  }, { titleChanged: false, contentChanged: true, taxonomyChanged: false })

  assert.equal(embeddingCalls, 0)
})
