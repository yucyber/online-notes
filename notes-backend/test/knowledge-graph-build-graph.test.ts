import { test } from 'node:test'
import assert = require('node:assert/strict')
import 'reflect-metadata'
import { OPTIONAL_DEPS_METADATA } from '@nestjs/common/constants'
import { AiService } from '../src/modules/ai/ai.service'
import { KnowledgeGraphBuildGraph } from '../src/modules/ai/graphs/knowledge-graph-build.graph'

test('KnowledgeGraphBuildGraph extracts a proposal scoped to one knowledge base', async () => {
  const calls: any[] = []
  const gateway = {
    chatTask: async (options: any) => {
      calls.push(options)
      return { content: JSON.stringify({
        nodes: [
          { label: 'AI Gateway', type: 'concept', noteIds: ['note-1', 'outside-note'], evidenceChunkIds: ['507f1f77bcf86cd799439021', '507f1f77bcf86cd799439099', 'bad-id', '507f1f77bcf86cd799439021'], confidence: 0.92 },
          { label: 'Run Audit', type: 'entity', noteIds: ['note-2'], confidence: 0.81 },
        ],
        edges: [
          { source: 'AI Gateway', target: 'Run Audit', relation: '记录运行', noteIds: ['note-1', 'note-2'], evidenceChunkIds: ['507f1f77bcf86cd799439021', '507f1f77bcf86cd799439022', '507f1f77bcf86cd799439099'], weight: 0.7 },
        ],
      }), attempt: {} }
    },
  }
  const graph = new KnowledgeGraphBuildGraph(gateway as any)
  const proposal = await graph.run({
    knowledgeBaseId: 'kb-1',
    notes: [
      { id: 'note-1', title: 'Gateway', summary: 'Routes providers.', chunks: [{ chunkId: '507f1f77bcf86cd799439021', headingPath: ['Gateway', 'Routing'], content: 'AI Gateway routes providers.' }], updatedAt: '2026-06-01T00:00:00.000Z' },
      { id: 'note-2', title: 'Audit', summary: 'AI run records status.', chunks: [{ chunkId: '507f1f77bcf86cd799439022', headingPath: ['Audit'], content: 'Run audit records provider and model.' }] },
    ],
  }, { userId: 'user-1', runId: 'run-1' })

  assert.equal(proposal.knowledgeBaseId, 'kb-1')
  assert.equal(proposal.nodes.length, 2)
  assert.deepEqual(proposal.nodes[0].noteIds, ['note-1'])
  assert.deepEqual(proposal.nodes[0].evidenceChunkIds, ['507f1f77bcf86cd799439021'])
  assert.deepEqual(proposal.edges[0].noteIds, ['note-1', 'note-2'])
  assert.deepEqual(proposal.edges[0].evidenceChunkIds, ['507f1f77bcf86cd799439021', '507f1f77bcf86cd799439022'])
  assert.equal(proposal.edges[0].relation, '记录运行')
  assert.doesNotMatch(JSON.stringify(proposal), /outside-note/)
  assert.doesNotMatch(JSON.stringify(proposal), /507f1f77bcf86cd799439099/)
  assert.match(calls[0].prompt, /Knowledge base: kb-1/)
  assert.match(calls[0].prompt, /note-1/)
  assert.match(calls[0].prompt, /note-2/)
  assert.match(calls[0].prompt, /507f1f77bcf86cd799439021/)
  assert.match(calls[0].prompt, /优先发现不同 Note ID 之间有证据的关系/)
  assert.match(calls[0].prompt, /关系使用简洁中文/)
  assert.match(calls[0].prompt, /没有可靠证据时不要连线/)
  assert.doesNotMatch(calls[0].prompt, /Content:/)
  assert.equal(calls[0].task, 'knowledge_graph')
  assert.equal(calls[0].maxTokens, 1400)
  assert.deepEqual(calls[0].responseFormat, { type: 'json_object' })
  assert.deepEqual(calls[0].audit, {
    graphName: 'KnowledgeGraphBuildGraph',
    userId: 'user-1',
    runId: 'run-1',
  })
})

test('KnowledgeGraphBuildGraph uses a Chinese fallback for a missing relation', async () => {
  const gateway = {
    chatTask: async () => ({
      content: JSON.stringify({
        nodes: [
          { label: '检索', noteIds: ['note-1'] },
          { label: '排序', noteIds: ['note-2'] },
        ],
        edges: [{ source: '检索', target: '排序', noteIds: ['note-1', 'note-2'] }],
      }),
      attempt: {},
    }),
  }
  const graph = new KnowledgeGraphBuildGraph(gateway as any)

  const proposal = await graph.run({
    knowledgeBaseId: 'kb-1',
    notes: [
      { id: 'note-1', title: '检索' },
      { id: 'note-2', title: '排序' },
    ],
  })

  assert.equal(proposal.edges[0].relation, '相关')
})

test('KnowledgeGraphBuildGraph limits the default proposal size', async () => {
  const nodes = Array.from({ length: 30 }, (_, index) => ({
    label: `Node ${index + 1}`,
    noteIds: ['note-1'],
  }))
  const edges = Array.from({ length: 50 }, (_, index) => ({
    source: `Node ${(index % 23) + 1}`,
    target: `Node ${((index + 1) % 23) + 1}`,
    relation: `关系 ${index + 1}`,
    noteIds: ['note-1'],
  }))
  const gateway = {
    chatTask: async () => ({ content: JSON.stringify({ nodes, edges }), attempt: {} }),
  }
  const graph = new KnowledgeGraphBuildGraph(gateway as any)

  const proposal = await graph.run({
    knowledgeBaseId: 'kb-1',
    notes: [{ id: 'note-1', title: 'Limits' }],
  })

  assert.equal(proposal.nodes.length, 24)
  assert.equal(proposal.edges.length, 36)
})

test('AiService builds knowledge graph proposals from readable knowledge base notes', async () => {
  const order: string[] = []
  const graphCalls: any[] = []
  const graph = {
    prepare: (input: any) => {
      order.push('prepare')
      return { knowledgeBaseId: input.knowledgeBaseId, notes: input.notes, prompt: 'prepared prompt' }
    },
    runPrepared: async (input: any, context: any) => {
      order.push('run')
      graphCalls.push({ input, context })
      return { knowledgeBaseId: input.knowledgeBaseId, generatedAt: '2026-06-05T00:00:00.000Z', nodes: [], edges: [], warnings: [] }
    },
  }
  const knowledgeBases = {
    listGraphNotes: async (knowledgeBaseId: string, userId: string) => {
      order.push('list')
      assert.equal(knowledgeBaseId, 'kb-1')
      assert.equal(userId, 'user-1')
      return [{ id: 'note-1', title: 'Only readable', chunks: [{ chunkId: 'chunk-1', content: 'Scoped note' }] }]
    },
  }
  const audit = {
    start: async (input: any) => ({ ...input, runId: 'run-1', status: 'running' }),
    addStage: async (_runId: string, stage: any) => {
      order.push('stage')
      assert.equal(stage.name, 'context_prepare')
      assert.equal(stage.status, 'succeeded')
      assert.ok(stage.durationMs >= 0)
    },
    mergeMetrics: async (_runId: string, metrics: any) => {
      assert.deepEqual(metrics, { candidateNotes: 1, candidateChunks: 1 })
    },
    succeed: async () => { throw new Error('gateway owns finalization when provider execution starts') },
    fail: async () => { throw new Error('unexpected failure finalization') },
  }
  const service = new AiService({} as any, knowledgeBases as any, audit as any, undefined, graph as any)
  const proposal = await service.buildKnowledgeGraphProposal('kb-1', { userId: 'user-1' })

  assert.equal(proposal.knowledgeBaseId, 'kb-1')
  assert.deepEqual(order, ['list', 'prepare', 'stage', 'run'])
  assert.deepEqual(graphCalls[0].input.notes, [{ id: 'note-1', title: 'Only readable', chunks: [{ chunkId: 'chunk-1', content: 'Scoped note' }] }])
  assert.deepEqual(graphCalls[0].context, { userId: 'user-1', runId: 'run-1' })
})

test('AiService requires KnowledgeBasesService at module startup', () => {
  const paramTypes = Reflect.getMetadata('design:paramtypes', AiService) || []
  const knowledgeBasesIndex = paramTypes.findIndex((type: any) => type?.name === 'KnowledgeBasesService')
  const optionalIndexes = new Set<number>(Reflect.getMetadata(OPTIONAL_DEPS_METADATA, AiService) || [])
  assert.notEqual(knowledgeBasesIndex, -1)
  assert.equal(optionalIndexes.has(knowledgeBasesIndex), false)
})
