import assert = require('node:assert/strict')
import { test } from 'node:test'

import { AiService } from '../src/modules/ai/ai.service'
import { AggregateSummaryGraph } from '../src/modules/ai/graphs/aggregate-summary.graph'
import { KnowledgeGraphBuildGraph } from '../src/modules/ai/graphs/knowledge-graph-build.graph'

function taskResult(content: string) {
  return { content, attempt: {} }
}

test('AiService declares task identities for existing AI entry points', async () => {
  const tasks: string[] = []
  const gateway = {
    chat: async () => { throw new Error('legacy chat route used') },
    streamChat: async () => { throw new Error('legacy stream route used') },
    chatTask: async (options: any) => {
      tasks.push(options.task)
      if (options.task === 'mindmap') return taskResult('{"topic":"Root","children":[]}')
      if (options.task === 'mermaid') return taskResult('flowchart TD\nA-->B')
      return taskResult(options.task === 'topic_name' ? 'Frontend' : 'AI result')
    },
    streamTask: async (options: any) => {
      tasks.push(options.task)
      return new ReadableStream<Uint8Array>({ start(controller) { controller.close() } })
    },
    describeTaskRoute: () => ({ provider: 'siliconflow', model: 'model' }),
  }
  const service = new AiService(gateway as any, {} as any)

  await service.generateSummary('笔记内容'.repeat(40))
  await service.generateTopicName('topic context')
  await service.streamWriter({ type: 'polish', context: 'text' })
  await service.chatPet({ message: 'hello' })
  await service.generateMindmap({ content: 'mindmap' })
  await service.generateMermaid({ content: 'diagram' })

  assert.deepEqual(tasks, ['note_summary', 'topic_name', 'writer', 'pet_chat', 'mindmap', 'mermaid'])
})

test('aggregate summary and knowledge graph declare their task identities', async () => {
  const tasks: string[] = []
  const gateway = {
    chat: async () => { throw new Error('legacy chat route used') },
    chatTask: async (options: any) => {
      tasks.push(options.task)
      if (options.task === 'knowledge_graph') return taskResult('{"nodes":[],"edges":[]}')
      return taskResult('summary')
    },
  }

  await new AggregateSummaryGraph(gateway as any).run([{ title: 'A', content: 'alpha' }])
  await new KnowledgeGraphBuildGraph(gateway as any).run({
    knowledgeBaseId: 'kb-1',
    notes: [{ id: 'note-1', title: 'A', content: 'alpha' }],
  })

  assert.deepEqual(tasks, ['aggregate_summary', 'knowledge_graph'])
})
