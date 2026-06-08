import assert = require('node:assert/strict')
import { test } from 'node:test'
import { Types } from 'mongoose'
import { KnowledgeBasesService } from '../src/modules/knowledge-bases/knowledge-bases.service'

const userId = '507f1f77bcf86cd799439012'
const kbId = '507f1f77bcf86cd799439013'
const noteOneId = '507f1f77bcf86cd799439014'
const noteTwoId = '507f1f77bcf86cd799439015'
const outsideNoteId = '507f1f77bcf86cd799439016'

function execResult<T>(value: T) {
  return { exec: async () => value }
}

function doc(value: any) {
  return {
    ...value,
    toObject: () => value,
  }
}

test('KnowledgeBasesService replaces a graph inside one user-owned knowledge base boundary', async () => {
  const deletes: any[] = []
  const inserts: any[] = []
  const linkQueries: any[] = []
  const kbModel = {
    findOne: (query: any) => execResult(doc({ _id: new Types.ObjectId(kbId), userId: query.userId })),
  }
  const linkModel = {
    find: (query: any) => {
      linkQueries.push(query)
      return {
        sort: () => execResult([
          doc({ noteId: new Types.ObjectId(noteOneId) }),
          doc({ noteId: new Types.ObjectId(noteTwoId) }),
        ]),
      }
    },
  }
  const noteModel = {}
  const noteAccess = {
    objectId: (id: string) => new Types.ObjectId(id),
  }
  const graphNodeModel = {
    deleteMany: (query: any) => {
      deletes.push({ collection: 'nodes', query })
      return execResult({ deletedCount: 2 })
    },
    insertMany: async (rows: any[]) => {
      inserts.push({ collection: 'nodes', rows })
      return rows.map((row) => doc({ _id: new Types.ObjectId(), ...row }))
    },
  }
  const graphEdgeModel = {
    deleteMany: (query: any) => {
      deletes.push({ collection: 'edges', query })
      return execResult({ deletedCount: 1 })
    },
    insertMany: async (rows: any[]) => {
      inserts.push({ collection: 'edges', rows })
      return rows.map((row) => doc({ _id: new Types.ObjectId(), ...row }))
    },
  }
  const service = new KnowledgeBasesService(
    kbModel as any,
    linkModel as any,
    noteModel as any,
    noteAccess as any,
    graphNodeModel as any,
    graphEdgeModel as any,
  )

  const saved = await service.replaceGraph(kbId, {
    nodes: [
      { id: 'node-a', label: 'Attention', type: 'concept', confidence: 0.9, noteIds: [noteOneId, outsideNoteId] },
      { id: 'node-b', label: 'Graphs', type: 'topic', confidence: 0.8, noteIds: [noteTwoId] },
      { id: 'node-outside', label: 'Outside', type: 'entity', confidence: 0.7, noteIds: [outsideNoteId] },
    ],
    edges: [
      { id: 'edge-a', source: 'node-a', target: 'node-b', relation: 'supports', weight: 0.6, noteIds: [noteOneId, outsideNoteId] },
      { id: 'edge-outside', source: 'node-a', target: 'node-outside', relation: 'leaks', weight: 0.6, noteIds: [outsideNoteId] },
    ],
  }, userId)

  assert.equal(linkQueries[0].knowledgeBaseId.toString(), kbId)
  assert.equal(linkQueries[0].userId.toString(), userId)
  assert.equal(deletes[0].collection, 'edges')
  assert.equal(deletes[0].query.knowledgeBaseId.toString(), kbId)
  assert.equal(deletes[0].query.userId.toString(), userId)
  assert.equal(deletes[1].collection, 'nodes')
  assert.equal(inserts[0].collection, 'nodes')
  assert.equal(inserts[0].rows.length, 2)
  assert.deepEqual(inserts[0].rows[0].noteIds.map(String), [noteOneId])
  assert.equal(inserts[1].collection, 'edges')
  assert.equal(inserts[1].rows.length, 1)
  assert.deepEqual(inserts[1].rows[0].noteIds.map(String), [noteOneId])
  assert.equal(saved.nodes.length, 2)
  assert.equal(saved.edges.length, 1)
})

test('KnowledgeBasesService reads a graph scoped by knowledge base and user', async () => {
  const queries: any[] = []
  const kbModel = {
    findOne: (query: any) => execResult(doc({ _id: new Types.ObjectId(kbId), userId: query.userId })),
  }
  const noteAccess = {
    objectId: (id: string) => new Types.ObjectId(id),
  }
  const graphNodeModel = {
    find: (query: any) => {
      queries.push({ collection: 'nodes', query })
      return {
        sort: () => execResult([
          doc({
            _id: new Types.ObjectId(),
            knowledgeBaseId: new Types.ObjectId(kbId),
            userId: new Types.ObjectId(userId),
            nodeId: 'node-a',
            label: 'Attention',
            type: 'concept',
            confidence: 0.9,
            noteIds: [new Types.ObjectId(noteOneId)],
          }),
        ]),
      }
    },
  }
  const graphEdgeModel = {
    find: (query: any) => {
      queries.push({ collection: 'edges', query })
      return {
        sort: () => execResult([
          doc({
            _id: new Types.ObjectId(),
            knowledgeBaseId: new Types.ObjectId(kbId),
            userId: new Types.ObjectId(userId),
            edgeId: 'edge-a',
            source: 'node-a',
            target: 'node-b',
            relation: 'supports',
            weight: 0.6,
            noteIds: [new Types.ObjectId(noteOneId)],
          }),
        ]),
      }
    },
  }
  const service = new KnowledgeBasesService(
    kbModel as any,
    {} as any,
    {} as any,
    noteAccess as any,
    graphNodeModel as any,
    graphEdgeModel as any,
  )

  const graph = await service.getGraph(kbId, userId)

  assert.equal(queries[0].collection, 'nodes')
  assert.equal(queries[0].query.knowledgeBaseId.toString(), kbId)
  assert.equal(queries[0].query.userId.toString(), userId)
  assert.equal(queries[1].collection, 'edges')
  assert.equal(graph.nodes[0].id, 'node-a')
  assert.equal(graph.edges[0].source, 'node-a')
  assert.deepEqual(graph.edges[0].noteIds, [noteOneId])
})
