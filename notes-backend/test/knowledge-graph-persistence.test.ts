import assert = require('node:assert/strict')
import { test } from 'node:test'
import { model, Types } from 'mongoose'
import { KnowledgeBasesService } from '../src/modules/knowledge-bases/knowledge-bases.service'
import { KnowledgeGraphEdgeSchema } from '../src/modules/knowledge-bases/schemas/knowledge-graph-edge.schema'

const userId = '507f1f77bcf86cd799439012'
const kbId = '507f1f77bcf86cd799439013'
const noteOneId = '507f1f77bcf86cd799439014'
const noteTwoId = '507f1f77bcf86cd799439015'
const outsideNoteId = '507f1f77bcf86cd799439016'
const noteOneChunkId = '507f1f77bcf86cd799439021'
const noteTwoChunkId = '507f1f77bcf86cd799439022'
const outsideChunkId = '507f1f77bcf86cd799439023'
const KnowledgeGraphEdgeHydrationModel = model('KnowledgeGraphEdgeHydrationTest', KnowledgeGraphEdgeSchema)

function execResult<T>(value: T) {
  return { exec: async () => value }
}

function doc(value: any) {
  return {
    ...value,
    toObject: () => value,
  }
}

test('KnowledgeGraphEdgeSchema hydrates a missing relation with the Chinese fallback', () => {
  const base = {
    knowledgeBaseId: new Types.ObjectId(kbId),
    userId: new Types.ObjectId(userId),
    edgeId: 'edge-a',
    source: 'node-a',
    target: 'node-b',
    noteIds: [new Types.ObjectId(noteOneId)],
  }

  const missingRelation = KnowledgeGraphEdgeHydrationModel.hydrate(base)
  const existingEnglishRelation = KnowledgeGraphEdgeHydrationModel.hydrate({ ...base, edgeId: 'edge-b', relation: 'supports' })

  assert.equal(missingRelation.relation, '相关')
  assert.equal(existingEnglishRelation.relation, 'supports')
})

test('KnowledgeBasesService replaces a graph inside one user-owned knowledge base boundary', async () => {
  const deletes: any[] = []
  const inserts: any[] = []
  const linkQueries: any[] = []
  const kbModel = {
    findOne: (query: any) => execResult(doc({ _id: new Types.ObjectId(kbId), userId: query.userId })),
    db: {
      startSession: async () => ({
        withTransaction: async (work: () => Promise<void>) => work(),
        endSession: async () => undefined,
      }),
    },
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
  const noteModel = {
    find: () => ({ select: () => execResult([
      doc({ _id: new Types.ObjectId(noteOneId) }),
      doc({ _id: new Types.ObjectId(noteTwoId) }),
    ]) }),
  }
  const noteAccess = {
    objectId: (id: string) => new Types.ObjectId(id),
    readableNotesQuery: (noteIds: Types.ObjectId[]) => ({ _id: { $in: noteIds } }),
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
  const noteChunkModel = {
    find: () => ({ select: () => execResult([
      doc({ _id: new Types.ObjectId(noteOneChunkId), noteId: new Types.ObjectId(noteOneId), userId: new Types.ObjectId(userId) }),
      doc({ _id: new Types.ObjectId(noteTwoChunkId), noteId: new Types.ObjectId(noteTwoId), userId: new Types.ObjectId(userId) }),
    ]) }),
  }
  const service = new KnowledgeBasesService(
    kbModel as any,
    linkModel as any,
    noteModel as any,
    noteAccess as any,
    graphNodeModel as any,
    graphEdgeModel as any,
    undefined,
    noteChunkModel as any,
  )

  const saved = await service.replaceGraph(kbId, {
    nodes: [
      { id: 'node-a', label: 'Attention', type: 'concept', confidence: 0.9, noteIds: [noteOneId, outsideNoteId], evidenceChunkIds: [noteOneChunkId, noteTwoChunkId, outsideChunkId, 'bad-id', noteOneChunkId] },
      { id: 'node-b', label: 'Graphs', type: 'topic', confidence: 0.8, noteIds: [noteTwoId], evidenceChunkIds: [noteTwoChunkId] },
      { id: 'node-outside', label: 'Outside', type: 'entity', confidence: 0.7, noteIds: [outsideNoteId] },
    ],
    edges: [
      { id: 'edge-a', source: 'node-a', target: 'node-b', relation: '', weight: 0.6, noteIds: [noteOneId, outsideNoteId], evidenceChunkIds: [noteOneChunkId, noteTwoChunkId, outsideChunkId] },
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
  assert.deepEqual(inserts[0].rows[0].evidenceChunkIds.map(String), [noteOneChunkId])
  assert.equal(inserts[1].collection, 'edges')
  assert.equal(inserts[1].rows.length, 1)
  assert.deepEqual(inserts[1].rows[0].noteIds.map(String), [noteOneId])
  assert.deepEqual(inserts[1].rows[0].evidenceChunkIds.map(String), [noteOneChunkId, noteTwoChunkId])
  assert.equal(inserts[1].rows[0].relation, '相关')
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
  assert.deepEqual(graph.nodes[0].evidenceChunkIds, [])
})

test('KnowledgeBasesService.replaceGraph preserves the old graph when the transaction fails', async () => {
  const state = {
    nodes: [{ nodeId: 'old-node' }],
    edges: [{ edgeId: 'old-edge' }],
  }
  const session = {
    withTransaction: async (work: () => Promise<void>) => {
      const snapshot = JSON.parse(JSON.stringify(state))
      try {
        await work()
      } catch (error) {
        state.nodes = snapshot.nodes
        state.edges = snapshot.edges
        throw error
      }
    },
    endSession: async () => undefined,
  }
  const kbModel = {
    findOne: (query: any) => execResult(doc({ _id: new Types.ObjectId(kbId), userId: query.userId })),
    db: { startSession: async () => session },
  }
  const linkModel = {
    find: () => ({ sort: () => execResult([doc({ noteId: new Types.ObjectId(noteOneId) })]) }),
  }
  const graphNodeModel = {
    deleteMany: () => ({ exec: async () => { state.nodes = []; return { deletedCount: 1 } } }),
    insertMany: async (rows: any[]) => {
      state.nodes.push(...rows)
      return rows
    },
  }
  const graphEdgeModel = {
    deleteMany: () => ({ exec: async () => { state.edges = []; return { deletedCount: 1 } } }),
    insertMany: async () => { throw new Error('edge insert failed') },
  }
  const service = new KnowledgeBasesService(
    kbModel as any,
    linkModel as any,
    { find: () => ({ select: () => execResult([doc({ _id: new Types.ObjectId(noteOneId) })]) }) } as any,
    { objectId: (id: string) => new Types.ObjectId(id), readableNotesQuery: (noteIds: Types.ObjectId[]) => ({ _id: { $in: noteIds } }) } as any,
    graphNodeModel as any,
    graphEdgeModel as any,
  )

  await assert.rejects(() => service.replaceGraph(kbId, {
      nodes: [
      { id: 'new-node', label: 'New', type: 'concept', noteIds: [noteOneId] },
      { id: 'new-node-2', label: 'New 2', type: 'concept', noteIds: [noteOneId] },
      ],
    edges: [{ id: 'new-edge', source: 'new-node', target: 'new-node-2', relation: 'related', noteIds: [noteOneId] }],
  }, userId), /edge insert failed/)

  assert.deepEqual(state.nodes, [{ nodeId: 'old-node' }])
  assert.deepEqual(state.edges, [{ edgeId: 'old-edge' }])
})
