import assert = require('node:assert/strict')
import { test } from 'node:test'
import { NotFoundException } from '@nestjs/common'
import { Types } from 'mongoose'
import { NotesService } from '../src/modules/notes/notes.service'

const ownerId = new Types.ObjectId().toString()
const readerId = new Types.ObjectId().toString()
const strangerId = new Types.ObjectId().toString()
const noteId = new Types.ObjectId().toString()
const otherNoteId = new Types.ObjectId().toString()
const chunkId = new Types.ObjectId().toString()

function queryResult<T>(value: T) {
  return { select: () => queryResult(value), lean: () => queryResult(value), exec: async () => value }
}

function createService(options: { readable: boolean; chunk?: any }) {
  const noteQueries: any[] = []
  const chunkQueries: any[] = []
  const noteModel = {
    findOne: (query: any) => {
      noteQueries.push(query)
      return queryResult(options.readable ? { _id: new Types.ObjectId(noteId) } : null)
    },
  }
  const chunkModel = {
    findOne: (query: any) => {
      chunkQueries.push(query)
      return queryResult(options.chunk ?? null)
    },
  }
  const noteAccess = {
    readScope: (routeNoteId: string, userId: string) => ({ routeNoteId, userId, readable: true }),
    objectId: (id: string) => new Types.ObjectId(id),
  }
  const service = new NotesService(
    noteModel as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    noteAccess as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    undefined,
    undefined,
    undefined,
    undefined,
    chunkModel as any,
  )
  return { service, noteQueries, chunkQueries }
}

for (const [label, userId] of [['owner', ownerId], ['共享 reader', readerId]] as const) {
  test(`${label} 可以读取同一 Note 下的 Chunk 定位信息`, async () => {
    const content = '<h2>该 Chunk</h2><script>不可见</script><p>' + '净化后正文'.repeat(30) + '</p>'
    const { service, noteQueries, chunkQueries } = createService({
      readable: true,
      chunk: { _id: new Types.ObjectId(chunkId), noteId: new Types.ObjectId(noteId), headingPath: ['Root', 'Child'], content },
    })

    const result = await (service as any).getChunkLocation(noteId, chunkId, userId)

    assert.deepEqual(result, {
      chunkId,
      headingPath: ['Root', 'Child'],
      anchorText: ('该 Chunk ' + '净化后正文'.repeat(30)).slice(0, 160),
    })
    assert.deepEqual(noteQueries, [{ routeNoteId: noteId, userId, readable: true }])
    assert.deepEqual(chunkQueries, [{ _id: new Types.ObjectId(chunkId), noteId: new Types.ObjectId(noteId) }])
  })
}

test('无 NoteAccess 时返回 NotFound 且不查询 Chunk', async () => {
  const { service, chunkQueries } = createService({ readable: false })

  await assert.rejects(
    () => (service as any).getChunkLocation(noteId, chunkId, strangerId),
    NotFoundException,
  )
  assert.equal(chunkQueries.length, 0)
})

test('跨 Note 伪造的 chunkId 沿用 NotFound 安全语义', async () => {
  const { service, chunkQueries } = createService({ readable: true })

  await assert.rejects(
    () => (service as any).getChunkLocation(otherNoteId, chunkId, ownerId),
    NotFoundException,
  )
  assert.deepEqual(chunkQueries, [{ _id: new Types.ObjectId(chunkId), noteId: new Types.ObjectId(otherNoteId) }])
})

test('已删除 Chunk 沿用 NotFound 安全语义', async () => {
  const { service } = createService({ readable: true })

  await assert.rejects(
    () => (service as any).getChunkLocation(noteId, chunkId, ownerId),
    NotFoundException,
  )
})

test('anchorText 与浏览器 DOM 的 br 和 HTML entity 文本语义一致', async () => {
  const { service } = createService({
    readable: true,
    chunk: {
      _id: new Types.ObjectId(chunkId),
      noteId: new Types.ObjectId(noteId),
      headingPath: [],
      content: '<p>第一行<br>第二行 &lt;证据&gt; &quot;引用&quot;</p>',
    },
  })

  const result = await (service as any).getChunkLocation(noteId, chunkId, ownerId)

  assert.equal(result.anchorText, '第一行第二行 <证据> "引用"')
})

test('legacy table cell 在 Tiptap 补齐段落后仍能匹配 anchorText', async () => {
  const { service } = createService({
    readable: true,
    chunk: {
      _id: new Types.ObjectId(chunkId),
      noteId: new Types.ObjectId(noteId),
      headingPath: [],
      content: '<table><tr><td>A</td><td>B</td></tr></table>',
    },
  })

  const result = await (service as any).getChunkLocation(noteId, chunkId, ownerId)

  assert.equal(result.anchorText, 'A B')
})
