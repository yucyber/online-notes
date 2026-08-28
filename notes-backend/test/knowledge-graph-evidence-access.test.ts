import assert = require('node:assert/strict')
import { test } from 'node:test'
import { Types } from 'mongoose'
import { KnowledgeBasesService } from '../src/modules/knowledge-bases/knowledge-bases.service'

const userId = '507f1f77bcf86cd799439012'
const kbId = '507f1f77bcf86cd799439013'
const noteId = '507f1f77bcf86cd799439014'
const chunkId = '507f1f77bcf86cd799439021'

function execResult<T>(value: T) { return { exec: async () => value } }
function doc(value: any) { return { ...value, toObject: () => value } }

test('KnowledgeBasesService returns only currently readable sanitized node evidence', async () => {
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
    headingPath: ['Root', 'Child'], content: '<h2>Hello</h2><script>alert(1)</script>' + 'x'.repeat(1000), chunkIndex: 0,
  })]) }) } } }
  const service = new KnowledgeBasesService(kbModel as any, linkModel as any, noteModel as any, noteAccess as any, graphNodeModel as any, graphEdgeModel as any, undefined, chunkModel as any)

  const result = await service.getGraphEvidence(kbId, 'node', 'node-a', userId)

  assert.equal(result.compatibility, 'evidence_available')
  assert.equal(result.items.length, 1)
  assert.deepEqual(result.items[0].headingPath, ['Root', 'Child'])
  assert.equal(result.items[0].noteTitle, 'Safe note')
  assert.doesNotMatch(result.items[0].excerpt, /[<>]|alert\(1\)/)
  assert.ok(result.items[0].excerpt.length <= 320)
  assert.equal(String(chunkQueries[0].userId), userId)
  assert.deepEqual(chunkQueries[0].noteId.$in.map(String), [noteId])
})

test('KnowledgeBasesService returns an explicit empty compatibility result for legacy graphs', async () => {
  const kbModel = { findOne: (query: any) => execResult(doc({ _id: new Types.ObjectId(kbId), userId: query.userId })) }
  const graphNodeModel = { findOne: () => execResult(doc({ nodeId: 'node-a' })) }
  const service = new KnowledgeBasesService(kbModel as any, {} as any, {} as any, { objectId: (id: string) => new Types.ObjectId(id) } as any, graphNodeModel as any, {} as any)

  assert.deepEqual(await service.getGraphEvidence(kbId, 'node', 'node-a', userId), { compatibility: 'legacy_graph_without_evidence', items: [] })
})
