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
