import { test } from 'node:test'
import assert = require('node:assert/strict')
import 'reflect-metadata'
import { OPTIONAL_DEPS_METADATA } from '@nestjs/common/constants'
import { AiService } from '../src/modules/ai/ai.service'
import { KnowledgeGraphBuildGraph } from '../src/modules/ai/graphs/knowledge-graph-build.graph'

test('KnowledgeGraphBuildGraph extracts a proposal scoped to one knowledge base', async () => {
  const calls: any[] = []
  const gateway = {
    chat: async (options: any) => {
      calls.push(options)
      return JSON.stringify({
        nodes: [
          { label: 'AI Gateway', type: 'concept', noteIds: ['note-1', 'outside-note'], confidence: 0.92 },
          { label: 'Run Audit', type: 'entity', noteIds: ['note-2'], confidence: 0.81 },
        ],
        edges: [
          { source: 'AI Gateway', target: 'Run Audit', relation: 'records runs', noteIds: ['note-1', 'note-2'], weight: 0.7 },
        ],
      })
    },
  }
  const graph = new KnowledgeGraphBuildGraph(gateway as any)

  const proposal = await graph.run({
    knowledgeBaseId: 'kb-1',
    notes: [
      { id: 'note-1', title: 'Gateway', content: 'AI Gateway routes providers.', updatedAt: '2026-06-01T00:00:00.000Z' },
      { id: 'note-2', title: 'Audit', summary: 'AI run records status.', content: 'Run audit records provider and model.' },
    ],
  })

  assert.equal(proposal.knowledgeBaseId, 'kb-1')
  assert.equal(proposal.nodes.length, 2)
  assert.deepEqual(proposal.nodes[0].noteIds, ['note-1'])
  assert.deepEqual(proposal.edges[0].noteIds, ['note-1', 'note-2'])
  assert.doesNotMatch(JSON.stringify(proposal), /outside-note/)
  assert.match(calls[0].prompt, /Knowledge base: kb-1/)
  assert.match(calls[0].prompt, /note-1/)
  assert.match(calls[0].prompt, /note-2/)
})

test('AiService builds knowledge graph proposals from readable knowledge base notes', async () => {
  const graphCalls: any[] = []
  const runStarts: any[] = []
  const gateway = {
    describeChatRoute: () => ({ provider: 'mimo', model: 'mimo-v2.5-pro' }),
  }
  const runs = {
    start: async (payload: any) => {
      runStarts.push(payload)
      return { runId: 'run-1', status: 'running' }
    },
    succeed: async () => undefined,
    fail: async () => undefined,
  }
  const graph = {
    run: async (input: any) => {
      graphCalls.push(input)
      return {
        knowledgeBaseId: input.knowledgeBaseId,
        generatedAt: '2026-06-05T00:00:00.000Z',
        nodes: [],
        edges: [],
        warnings: [],
      }
    },
  }
  const knowledgeBases = {
    listGraphNotes: async (knowledgeBaseId: string, userId: string) => {
      assert.equal(knowledgeBaseId, 'kb-1')
      assert.equal(userId, 'user-1')
      return [{ id: 'note-1', title: 'Only readable', content: 'Scoped note' }]
    },
  }
  const service = new AiService(gateway as any, knowledgeBases as any, runs as any, undefined, graph as any)

  const proposal = await service.buildKnowledgeGraphProposal('kb-1', { userId: 'user-1' })

  assert.equal(proposal.knowledgeBaseId, 'kb-1')
  assert.deepEqual(graphCalls[0].notes, [{ id: 'note-1', title: 'Only readable', content: 'Scoped note' }])
  assert.equal(runStarts[0].graphName, 'KnowledgeGraphBuildGraph')
  assert.equal(runStarts[0].userId, 'user-1')
})

test('AiService requires KnowledgeBasesService at module startup', () => {
  const paramTypes = Reflect.getMetadata('design:paramtypes', AiService) || []
  const knowledgeBasesIndex = paramTypes.findIndex((type: any) => type?.name === 'KnowledgeBasesService')
  const optionalIndexes = new Set<number>(Reflect.getMetadata(OPTIONAL_DEPS_METADATA, AiService) || [])

  assert.notEqual(knowledgeBasesIndex, -1)
  assert.equal(optionalIndexes.has(knowledgeBasesIndex), false)
})
