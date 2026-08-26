import { test } from 'node:test'
import assert = require('node:assert/strict')
import { NoteVectorBackfillRunner } from '../src/modules/notes/note-vector-backfill.runner'
import { NoteChunkerService } from '../src/modules/notes/note-chunker.service'
import { NoteVectorSourceService } from '../src/modules/notes/note-vector-source.service'

function queryResult<T>(value: T) {
  return { lean: () => ({ exec: async () => value }), exec: async () => value }
}

test('回填器跳过摘要、主题向量和 chunks 均为最新的笔记', async () => {
  const chunker = new NoteChunkerService()
  const vectorSource = new NoteVectorSourceService()
  const note = {
    _id: 'note-1', userId: 'user-1', title: '二叉树', content: '<h2>遍历</h2><p>前序遍历</p>',
    summary: '介绍二叉树遍历', summarySource: 'ai', updatedAt: new Date('2026-08-26'),
  }
  const built = chunker.buildChunks(note)
  const source = vectorSource.buildTopicVectorSource({ title: note.title, summary: note.summary, tagNames: [] })
  ;(note as any).embeddingSourceHash = vectorSource.hashTopicVectorSource(source)
  const derivedCalls: any[] = []
  const runner = new NoteVectorBackfillRunner(
    { find: () => queryResult([note]) } as any,
    { find: () => queryResult(built.map((chunk) => ({ ...chunk, embedding: [0.1] }))) } as any,
    { refreshTopicArtifacts: async (...args: any[]) => derivedCalls.push(args) } as any,
    chunker,
    vectorSource,
    { findOwnedName: async () => undefined } as any,
    { findOwnedNames: async () => [] } as any,
  )

  const report = await runner.run()

  assert.equal(report.total, 1)
  assert.equal(report.skipped, 1)
  assert.equal(report.failed, 0)
  assert.equal(derivedCalls.length, 0)
})

test('已明确写回 fallback 且向量和 chunks 完整时保持幂等', async () => {
  const chunker = new NoteChunkerService()
  const vectorSource = new NoteVectorSourceService()
  const note: any = {
    _id: 'note-1', userId: 'user-1', title: '长笔记', content: '<h2>章节</h2><p>正文</p>',
    summary: '兜底摘要', summarySource: 'fallback', summaryUpdatedAt: new Date(), updatedAt: new Date(),
  }
  const built = chunker.buildChunks(note)
  const source = vectorSource.buildTopicVectorSource({ title: note.title, summary: note.summary, tagNames: [] })
  note.embeddingSourceHash = vectorSource.hashTopicVectorSource(source)
  let derivedCalls = 0
  const runner = new NoteVectorBackfillRunner(
    { find: () => queryResult([note]) } as any,
    { find: () => queryResult(built.map((chunk) => ({ ...chunk, embedding: [0.1] }))) } as any,
    { refreshTopicArtifacts: async () => { derivedCalls++ } } as any,
    chunker,
    vectorSource,
    { findOwnedName: async () => undefined } as any,
    { findOwnedNames: async () => [] } as any,
  )

  const report = await runner.run()

  assert.equal(report.skipped, 1)
  assert.equal(report.summaryFallback, 1)
  assert.equal(derivedCalls, 0)
})

test('单篇失败不会阻断后续笔记并记录失败 ID', async () => {
  const notes = [
    { _id: 'bad', userId: 'user-1', title: '失败', content: '<p>失败</p>', summary: '', updatedAt: new Date() },
    { _id: 'good', userId: 'user-1', title: '成功', content: '<p>成功</p>', summary: '', updatedAt: new Date() },
  ]
  const runner = new NoteVectorBackfillRunner(
    { find: () => queryResult(notes), findById: (id: string) => queryResult({ ...notes.find((note) => note._id === id), embeddingSourceHash: 'hash', summarySource: 'ai' }) } as any,
    { find: () => queryResult([]), countDocuments: async () => 1 } as any,
    { refreshTopicArtifacts: async (snapshot: any) => { if (snapshot.noteId === 'bad') throw new Error('embedding failed') } } as any,
    new NoteChunkerService(),
    new NoteVectorSourceService(),
    { findOwnedName: async () => undefined } as any,
    { findOwnedNames: async () => [] } as any,
  )

  const report = await runner.run()

  assert.equal(report.total, 2)
  assert.equal(report.failed, 1)
  assert.deepEqual(report.failedNoteIds, ['bad'])
  assert.equal(report.topicSucceeded, 1)
  assert.equal(report.chunkSucceeded, 1)
})

test('派生后缺少预期 Chunk 时将该笔记计为失败', async () => {
  const note = { _id: 'note-1', userId: 'user-1', title: '正文', content: '<p>需要索引</p>', summary: '', updatedAt: new Date() }
  const runner = new NoteVectorBackfillRunner(
    { find: () => queryResult([note]), findById: () => queryResult({ ...note, embeddingSourceHash: 'hash', summarySource: 'ai' }) } as any,
    { find: () => queryResult([]), countDocuments: async () => 0 } as any,
    { refreshTopicArtifacts: async () => undefined } as any,
    new NoteChunkerService(),
    new NoteVectorSourceService(),
    { findOwnedName: async () => undefined } as any,
    { findOwnedNames: async () => [] } as any,
  )

  const report = await runner.run()

  assert.equal(report.failed, 1)
  assert.deepEqual(report.failedNoteIds, ['note-1'])
  assert.equal(report.notes[0].status, 'failed')
})
