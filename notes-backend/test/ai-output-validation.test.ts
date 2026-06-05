import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AiService } from '../src/modules/ai/ai.service'

function answerContent(result: any): string {
  return result.messages[0].content
}

test('AiService repairs invalid Mermaid output once and strips markdown fences', async () => {
  const prompts: string[] = []
  const gateway = {
    chat: async (options: any) => {
      prompts.push(options.prompt)
      return prompts.length === 1
        ? 'Here is your chart:\nA connects to B'
        : '```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```'
    },
  }
  const service = new AiService(gateway as any, {} as any)

  const result = await service.generateMermaid({ content: '生成开始到结束的流程图' })

  assert.equal(answerContent(result), 'flowchart TD\n  A[开始] --> B[结束]')
  assert.equal(prompts.length, 2)
  assert.match(prompts[1], /Repair this Mermaid output/)
})

test('AiService repairs and normalizes mindmap JSON with stable root and child fields', async () => {
  const prompts: string[] = []
  const gateway = {
    chat: async (options: any) => {
      prompts.push(options.prompt)
      return prompts.length === 1
        ? '{"nodeData":{"topic":"","children":"bad"}}'
        : '{"nodeData":{"topic":"项目规划","children":[{"topic":"需求分析"}]}}'
    },
  }
  const service = new AiService(gateway as any, {} as any)

  const result = await service.generateMindmap({ content: '项目规划', scenario: 'generate' })
  const parsed = JSON.parse(answerContent(result))

  assert.equal(prompts.length, 2)
  assert.match(prompts[1], /Repair this mind map JSON/)
  assert.equal(parsed.nodeData.id, 'root')
  assert.equal(parsed.nodeData.root, true)
  assert.equal(parsed.nodeData.topic, '项目规划')
  assert.equal(parsed.nodeData.children[0].id, 'root-1')
  assert.equal(parsed.nodeData.children[0].topic, '需求分析')
  assert.deepEqual(parsed.nodeData.children[0].children, [])
  assert.deepEqual(parsed.linkData, {})
})
