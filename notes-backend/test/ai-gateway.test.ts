import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AiGatewayClient } from '../src/modules/ai/ai-gateway.client'
import { AiService } from '../src/modules/ai/ai.service'
import { AiController } from '../src/modules/ai/ai.controller'
import { EmbeddingService } from '../src/modules/semantic/embedding.service'

class FakeConfigService {
  constructor(private readonly values: Record<string, string | undefined>) {}

  get<T = string>(key: string): T | undefined {
    return this.values[key] as T | undefined
  }
}

function createConfig(overrides: Record<string, string | undefined> = {}) {
  return new FakeConfigService({
    AI_TEXT_PROVIDER: 'sensenova',
    AI_REASONING_PROVIDER: 'mimo',
    AI_EMBEDDING_PROVIDER: 'siliconflow',
    AI_RERANKER_PROVIDER: 'siliconflow',
    MIMO_API_KEY: 'mimo-secret',
    MIMO_BASE_URL: 'https://mimo.example/v1',
    MIMO_MODEL: 'mimo-v2.5-pro',
    SENSENOVA_API_KEY: 'sensenova-secret',
    SENSENOVA_BASE_URL: 'https://sensenova.example/v1',
    SENSENOVA_TEXT_MODEL: 'deepseek-v4-flash',
    SILICONFLOW_API_KEY: 'siliconflow-secret',
    SILICONFLOW_BASE_URL: 'https://api.siliconflow.cn/v1',
    SILICONFLOW_EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-8B',
    SILICONFLOW_RERANKER_MODEL: 'Qwen/Qwen3-Reranker-8B',
    SILICONFLOW_RERANKER_PATH: '/rerank',
    ...overrides,
  })
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('AiGatewayClient routes text chat to SenseNova by default', async () => {
  const calls: Array<{ url: string; body: any; headers: any }> = []
  const fetchImpl = async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers })
    return jsonResponse({ choices: [{ message: { content: 'OK from SenseNova' } }] })
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  const result = await client.chat({ route: 'text', prompt: 'hello', maxTokens: 16 })

  assert.equal(result, 'OK from SenseNova')
  assert.equal(calls[0].url, 'https://sensenova.example/v1/chat/completions')
  assert.equal(calls[0].body.model, 'deepseek-v4-flash')
  assert.equal(calls[0].headers.Authorization, 'Bearer sensenova-secret')
})

test('AiGatewayClient routes reasoning chat to MiMo', async () => {
  const calls: Array<{ url: string; body: any }> = []
  const fetchImpl = async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return jsonResponse({ choices: [{ message: { content: 'OK from MiMo' } }] })
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  const result = await client.chat({ route: 'reasoning', prompt: 'think', maxTokens: 16 })

  assert.equal(result, 'OK from MiMo')
  assert.equal(calls[0].url, 'https://mimo.example/v1/chat/completions')
  assert.equal(calls[0].body.model, 'mimo-v2.5-pro')
})

test('AiGatewayClient reports missing config without leaking existing secrets', async () => {
  const client = new AiGatewayClient(
    createConfig({ SENSENOVA_API_KEY: undefined }) as any,
    (async () => jsonResponse({})) as any,
  )

  await assert.rejects(
    () => client.chat({ route: 'text', prompt: 'hello' }),
    (error: any) => {
      assert.match(error.message, /SENSENOVA_API_KEY/)
      assert.doesNotMatch(error.message, /mimo-secret|siliconflow-secret|sensenova-secret/)
      return true
    },
  )
})

test('AiGatewayClient generates SiliconFlow embeddings', async () => {
  const calls: Array<{ url: string; body: any }> = []
  const fetchImpl = async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return jsonResponse({ data: [{ embedding: [0.1, 0.2, 0.3] }] })
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  const embedding = await client.embedding('health check')

  assert.deepEqual(embedding, [0.1, 0.2, 0.3])
  assert.equal(calls[0].url, 'https://api.siliconflow.cn/v1/embeddings')
  assert.equal(calls[0].body.model, 'Qwen/Qwen3-Embedding-8B')
})

test('AiGatewayClient reranks with SiliconFlow rerank endpoint', async () => {
  const calls: Array<{ url: string; body: any }> = []
  const fetchImpl = async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return jsonResponse({
      results: [
        { index: 1, relevance_score: 0.91 },
        { index: 0, score: 0.42 },
      ],
    })
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  const result = await client.rerank('query', ['doc a', 'doc b'])

  assert.deepEqual(result, [
    { index: 1, score: 0.91, document: 'doc b' },
    { index: 0, score: 0.42, document: 'doc a' },
  ])
  assert.equal(calls[0].url, 'https://api.siliconflow.cn/v1/rerank')
  assert.equal(calls[0].body.model, 'Qwen/Qwen3-Reranker-8B')
})

test('AiService falls back to truncated summary when gateway fails', async () => {
  const gateway = {
    chat: async () => {
      throw new Error('provider unavailable')
    },
  }
  const service = new AiService(gateway as any)

  const summary = await service.generateSummary('<p>Hello **world** from a long note.</p>')

  assert.equal(summary, 'Hello world from a long note.')
})

test('AiService returns cleaned topic names from the text provider', async () => {
  const gateway = {
    chat: async () => '"Frontend Performance"',
  }
  const service = new AiService(gateway as any)

  const topic = await service.generateTopicName('notes')

  assert.equal(topic, 'Frontend Performance')
})

test('AiController forwards mindmap requests to AiService', async () => {
  const expected = { messages: [{ role: 'assistant', type: 'answer', content: '{"nodeData":{"id":"root"}}' }] }
  const service = {
    generateMindmap: async (body: any) => {
      assert.deepEqual(body, { content: 'AI Gateway', scenario: 'generate' })
      return expected
    },
  }
  const controller = new AiController(service as any)

  const result = await controller.generateMindmap({ content: 'AI Gateway', scenario: 'generate' })

  assert.deepEqual(result, expected)
})

test('EmbeddingService delegates to AiService and keeps empty fallback on failure', async () => {
  const okService = {
    generateEmbedding: async (text: string) => {
      assert.equal(text, 'search text')
      return [1, 2, 3]
    },
  }
  const okEmbedding = new EmbeddingService(okService as any)

  assert.deepEqual(await okEmbedding.generateEmbedding('search text'), [1, 2, 3])

  const failingService = {
    generateEmbedding: async () => {
      throw new Error('provider unavailable')
    },
  }
  const failingEmbedding = new EmbeddingService(failingService as any)

  assert.deepEqual(await failingEmbedding.generateEmbedding('search text'), [])
})
