import assert = require('node:assert/strict')
import { test } from 'node:test'
import { Types } from 'mongoose'
import { KnowledgeBasesService } from '../src/modules/knowledge-bases/knowledge-bases.service'

const userId = '507f1f77bcf86cd799439012'
const kbId = '507f1f77bcf86cd799439013'
const noteId = '507f1f77bcf86cd799439014'
const chunkId = '507f1f77bcf86cd799439021'
const sanitizedContent = 'Hello & ' + 'x'.repeat(1000)

function execResult<T>(value: T) { return { exec: async () => value } }
function doc(value: any) { return { ...value, toObject: () => value } }

test('KnowledgeBasesService returns the complete sanitized content and bounded preview for readable node evidence', async () => {
  const chunkQueries: any[] = []
  const kbModel = { findOne: (query: any) => execResult(doc({ _id: new Types.ObjectId(kbId), userId: query.userId })) }
  const linkModel = { find: () => ({ sort: () => execResult([doc({ noteId: new Types.ObjectId(noteId) })]) }) }
  const noteModel = { find: () => ({ select: () => execResult([doc({ _id: new Types.ObjectId(noteId), title: 'Safe note' })]) }) }
  const noteAccess = {
    objectId: (id: string) => new Types.ObjectId(id),
    readableNotesQuery: (ids: Types.ObjectId[]) => ({ _id: { $in: ids } }),
  }
  const graphNodeModel = { findOne: () => execResult(doc({ nodeId: 'node-a', evidenceChunkIds: [new Types.ObjectId(chunkId), new Types.ObjectId(chunkId)] })) }
  const graphEdgeModel = { findOne: () => execResult(null) }
  const chunkModel = { find: (query: any) => { chunkQueries.push(query); return { sort: () => ({ select: () => execResult([doc({
    _id: new Types.ObjectId(chunkId), noteId: new Types.ObjectId(noteId), userId: new Types.ObjectId(userId),
    headingPath: ['Root', 'Child'], content: '<h2>Hello &amp;</h2><script>alert(1)</script><style>.hidden { display: none }</style><p>' + 'x'.repeat(1000) + '</p>', chunkIndex: 0,
  })]) }) } } }
  const service = new KnowledgeBasesService(kbModel as any, linkModel as any, noteModel as any, noteAccess as any, graphNodeModel as any, graphEdgeModel as any, undefined, chunkModel as any)

  const result = await service.getGraphEvidence(kbId, 'node', 'node-a', userId)

  assert.equal(result.compatibility, 'evidence_available')
  assert.equal(result.items.length, 1)
  const item = result.items[0]
  assert.deepEqual(item.headingPath, ['Root', 'Child'])
  assert.equal(item.noteTitle, 'Safe note')
  assert.equal(item.chunkId, chunkId)
  assert.equal(item.content, sanitizedContent)
  assert.equal(item.preview, sanitizedContent.slice(0, 320))
  assert.doesNotMatch(item.content, /[<>]|alert\(1\)|display: none/)
  assert.equal(String(chunkQueries[0].userId), userId)
  assert.deepEqual(chunkQueries[0].noteId.$in.map(String), [noteId])
})

test('KnowledgeBasesService omits evidence after the current user loses NoteAccess', async () => {
  const kbModel = { findOne: (query: any) => execResult(doc({ _id: new Types.ObjectId(kbId), userId: query.userId })) }
  const linkModel = { find: () => ({ sort: () => execResult([doc({ noteId: new Types.ObjectId(noteId) })]) }) }
  const noteModel = { find: () => ({ select: () => execResult([]) }) }
  const noteAccess = { objectId: (id: string) => new Types.ObjectId(id), readableNotesQuery: (ids: Types.ObjectId[]) => ({ _id: { $in: ids } }) }
  const graphNodeModel = { findOne: () => execResult(doc({ nodeId: 'node-a', evidenceChunkIds: [new Types.ObjectId(chunkId)] })) }
  const service = new KnowledgeBasesService(kbModel as any, linkModel as any, noteModel as any, noteAccess as any, graphNodeModel as any, {} as any, undefined, {} as any)

  assert.deepEqual(await service.getGraphEvidence(kbId, 'node', 'node-a', userId), { compatibility: 'evidence_unavailable', items: [] })
})

test('KnowledgeBasesService omits evidence after its note is removed from the knowledge base', async () => {
  const kbModel = { findOne: (query: any) => execResult(doc({ _id: new Types.ObjectId(kbId), userId: query.userId })) }
  const linkModel = { find: () => ({ sort: () => execResult([]) }) }
  const noteModel = { find: () => ({ select: () => execResult([]) }) }
  const noteAccess = { objectId: (id: string) => new Types.ObjectId(id), readableNotesQuery: (ids: Types.ObjectId[]) => ({ _id: { $in: ids } }) }
  const graphNodeModel = { findOne: () => execResult(doc({ nodeId: 'node-a', evidenceChunkIds: [new Types.ObjectId(chunkId)] })) }
  const service = new KnowledgeBasesService(kbModel as any, linkModel as any, noteModel as any, noteAccess as any, graphNodeModel as any, {} as any, undefined, {} as any)

  assert.deepEqual(await service.getGraphEvidence(kbId, 'node', 'node-a', userId), { compatibility: 'evidence_unavailable', items: [] })
})

test('KnowledgeBasesService omits evidence when its referenced Chunk has been deleted', async () => {
  const kbModel = { findOne: (query: any) => execResult(doc({ _id: new Types.ObjectId(kbId), userId: query.userId })) }
  const linkModel = { find: () => ({ sort: () => execResult([doc({ noteId: new Types.ObjectId(noteId) })]) }) }
  const noteModel = { find: () => ({ select: () => execResult([doc({ _id: new Types.ObjectId(noteId), title: 'Safe note' })]) }) }
  const noteAccess = { objectId: (id: string) => new Types.ObjectId(id), readableNotesQuery: (ids: Types.ObjectId[]) => ({ _id: { $in: ids } }) }
  const graphNodeModel = { findOne: () => execResult(doc({ nodeId: 'node-a', evidenceChunkIds: [new Types.ObjectId(chunkId)] })) }
  const chunkModel = { find: () => ({ sort: () => ({ select: () => execResult([]) }) }) }
  const service = new KnowledgeBasesService(kbModel as any, linkModel as any, noteModel as any, noteAccess as any, graphNodeModel as any, {} as any, undefined, chunkModel as any)

  assert.deepEqual(await service.getGraphEvidence(kbId, 'node', 'node-a', userId), { compatibility: 'evidence_unavailable', items: [] })
})

test('KnowledgeBasesService returns an explicit empty compatibility result for legacy graphs', async () => {
  const kbModel = { findOne: (query: any) => execResult(doc({ _id: new Types.ObjectId(kbId), userId: query.userId })) }
  const graphNodeModel = { findOne: () => execResult(doc({ nodeId: 'node-a' })) }
  const service = new KnowledgeBasesService(kbModel as any, {} as any, {} as any, { objectId: (id: string) => new Types.ObjectId(id) } as any, graphNodeModel as any, {} as any)

  assert.deepEqual(await service.getGraphEvidence(kbId, 'node', 'node-a', userId), { compatibility: 'legacy_graph_without_evidence', items: [] })
})
