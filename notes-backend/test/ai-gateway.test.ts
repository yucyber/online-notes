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
    AI_REASONING_PROVIDER: 'sensenova',
    AI_EMBEDDING_PROVIDER: 'siliconflow',
    AI_RERANKER_PROVIDER: 'siliconflow',
    AI_TASK_ROUTING_ENABLED: 'false',
    SENSENOVA_API_KEY: 'sensenova-secret',
    SENSENOVA_BASE_URL: 'https://sensenova.example/v1',
    SENSENOVA_TEXT_MODEL: 'sensenova-6.8-flash-lite',
    SENSENOVA_REASONING_MODEL: 'deepseek-v4-flash',
    SILICONFLOW_API_KEY: 'siliconflow-secret',
    SILICONFLOW_BASE_URL: 'https://api.siliconflow.cn/v1',
    SILICONFLOW_STANDARD_TEXT_MODEL: 'Qwen/Qwen3-14B',
    SILICONFLOW_EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-8B',
    SILICONFLOW_RERANKER_MODEL: 'Qwen/Qwen3-Reranker-8B',
    SILICONFLOW_RERANKER_PATH: '/rerank',
    ...overrides,
  })
}

function jsonResponse(body: any, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
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
  assert.equal(calls[0].body.model, 'sensenova-6.8-flash-lite')
  assert.equal(calls[0].headers.Authorization, 'Bearer sensenova-secret')
})

test('AiGatewayClient routes reasoning chat to SenseNova by default', async () => {
  const calls: Array<{ url: string; body: any }> = []
  const fetchImpl = async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return jsonResponse({ choices: [{ message: { content: 'OK from SenseNova reasoning' } }] })
  }
  const client = new AiGatewayClient(
    createConfig({ AI_REASONING_PROVIDER: undefined }) as any,
    fetchImpl as any,
  )

  const result = await client.chat({ route: 'reasoning', prompt: 'think', maxTokens: 16 })

  assert.equal(result, 'OK from SenseNova reasoning')
  assert.equal(calls[0].url, 'https://sensenova.example/v1/chat/completions')
  assert.equal(calls[0].body.model, 'deepseek-v4-flash')
})

test('AiGatewayClient routes note summaries to SiliconFlow standard model when task routing is enabled', async () => {
  const calls: Array<{ url: string; body: any; headers: any }> = []
  const fetchImpl = async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers })
    return jsonResponse({ choices: [{ message: { content: '摘要正文' } }] })
  }
  const client = new AiGatewayClient(createConfig({ AI_TASK_ROUTING_ENABLED: 'true' }) as any, fetchImpl as any)

  const result = await client.chat({
    task: 'note_summary',
    route: 'text',
    prompt: 'summarize',
    reasoningEffort: 'none',
  })

  assert.equal(result, '摘要正文')
  assert.equal(calls[0].url, 'https://api.siliconflow.cn/v1/chat/completions')
  assert.equal(calls[0].body.model, 'Qwen/Qwen3-14B')
  assert.equal(calls[0].body.enable_thinking, false)
  assert.equal(calls[0].body.reasoning_effort, undefined)
  assert.equal(calls[0].headers.Authorization, 'Bearer siliconflow-secret')
})

test('AiGatewayClient rejects removed mimo provider configuration', async () => {
  const client = new AiGatewayClient(
    createConfig({ AI_TEXT_PROVIDER: 'mimo' }) as any,
    (async () => jsonResponse({ choices: [{ message: { content: 'unused' } }] })) as any,
  )

  await assert.rejects(
    () => client.chat({ route: 'text', prompt: 'hello' }),
    /Unsupported text AI provider: mimo/,
  )
})

test('AiGatewayClient forwards explicit reasoning and JSON output options to SenseNova', async () => {
  const calls: Array<{ body: any }> = []
  const fetchImpl = async (_url: any, init: any) => {
    calls.push({ body: JSON.parse(init.body) })
    return jsonResponse({ choices: [{ message: { content: '{"nodes":[]}' } }] })
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  await client.chat({
    route: 'reasoning',
    prompt: 'extract graph',
    reasoningEffort: 'low',
    responseFormat: { type: 'json_object' },
  })

  assert.equal(calls[0].body.reasoning_effort, 'low')
  assert.deepEqual(calls[0].body.response_format, { type: 'json_object' })
})

test('AiGatewayClient forwards explicit reasoning_effort to SenseNova', async () => {
  const calls: Array<{ body: any }> = []
  const fetchImpl = async (_url: any, init: any) => {
    calls.push({ body: JSON.parse(init.body) })
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  await client.chat({
    route: 'text',
    prompt: 'hello',
    reasoningEffort: 'none',
  })

  assert.equal(calls[0].body.reasoning_effort, 'none')
})

test('AiGatewayClient retries once on length overflow with higher budget', async () => {
  const calls: Array<{ body: any }> = []
  let attempt = 0
  const fetchImpl = async (_url: any, init: any) => {
    calls.push({ body: JSON.parse(init.body) })
    attempt += 1
    if (attempt === 1) {
      return jsonResponse({ choices: [{ message: { content: '', reasoning: 'thinking...' }, finish_reason: 'length' }] })
    }
    return jsonResponse({ choices: [{ message: { content: 'final summary' } }] })
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  const result = await client.chat({
    route: 'text',
    prompt: 'summarize',
    maxTokens: 256,
    retryOnLengthOverflow: true,
  })

  assert.equal(result, 'final summary')
  assert.equal(calls.length, 2)
  // 重试时提高预算，给正文留出 token。
  assert.ok(calls[1].body.max_tokens > calls[0].body.max_tokens)
})

test('AiGatewayClient does not retry empty content when finish_reason is not length', async () => {
  const calls: Array<{ body: any }> = []
  const fetchImpl = async (_url: any, init: any) => {
    calls.push({ body: JSON.parse(init.body) })
    return jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] })
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  await assert.rejects(
    () => client.chat({ route: 'text', prompt: 'hi', retryOnLengthOverflow: true }),
    /no assistant content/,
  )
  assert.equal(calls.length, 1)
})

test('AiService keeps Pet chat lightweight and disables reasoning', async () => {
  const calls: any[] = []
  const gateway = {
    describeChatRoute: () => ({ provider: 'sensenova', model: 'sensenova-6.8-flash-lite' }),
    streamChat: async (options: any) => {
      calls.push(options)
      return new ReadableStream<Uint8Array>({ start(controller) { controller.close() } })
    },
  }
  const service = new AiService(gateway as any, {} as any)

  await service.chatPet({ message: '你好' }, { userId: 'user-1' })

  assert.equal(calls[0].route, 'text')
  assert.equal(calls[0].reasoningEffort, 'none')
  assert.equal(calls[0].maxTokens, 400)
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
      assert.doesNotMatch(error.message, /siliconflow-secret|sensenova-secret/)
      return true
    },
  )
})

test('AiGatewayClient retries a transient 429 and returns the next successful response', async () => {
  let attempts = 0
  const fetchImpl = async () => {
    attempts += 1
    if (attempts === 1) {
      return jsonResponse(
        { error: { type: 'quota_exceeded_error', message: 'Allocated quota exceeded' } },
        429,
        { 'Retry-After': '0' },
      )
    }
    return jsonResponse({ choices: [{ message: { content: 'recovered' } }] })
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  const result = await client.chat({ route: 'text', prompt: 'hello' })

  assert.equal(result, 'recovered')
  assert.equal(attempts, 2)
})

test('AiGatewayClient does not retry invalid provider requests', async () => {
  let attempts = 0
  const fetchImpl = async () => {
    attempts += 1
    return jsonResponse({ error: { message: 'invalid request' } }, 400)
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  await assert.rejects(
    () => client.chat({ route: 'text', prompt: 'hello' }),
    (error: any) => error?.getStatus?.() === 400,
  )
  assert.equal(attempts, 1)
})

test('AiGatewayClient preserves 429 after transient retries are exhausted', async () => {
  let attempts = 0
  const fetchImpl = async () => {
    attempts += 1
    return jsonResponse(
      { error: { type: 'quota_exceeded_error', message: 'Allocated quota exceeded' } },
      429,
      { 'Retry-After': '0' },
    )
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  await assert.rejects(
    () => client.chat({ route: 'text', prompt: 'hello' }),
    (error: any) => {
      assert.equal(error?.getStatus?.(), 429)
      assert.equal(error?.message, 'AI provider is temporarily rate limited. Please try again shortly.')
      assert.match(error?.providerDetail, /Allocated quota exceeded/)
      assert.doesNotMatch(JSON.stringify(error?.getResponse?.()), /Allocated quota exceeded/)
      return true
    },
  )
  assert.equal(attempts, 3)
})

test('AiGatewayClient maps exhausted provider outages to a safe 503', async () => {
  let attempts = 0
  const fetchImpl = async () => {
    attempts += 1
    return jsonResponse(
      { error: { message: 'upstream node pool internal detail' } },
      503,
      { 'Retry-After': '0' },
    )
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  await assert.rejects(
    () => client.chat({ route: 'text', prompt: 'hello' }),
    (error: any) => {
      assert.equal(error?.getStatus?.(), 503)
      assert.equal(error?.message, 'AI provider is temporarily unavailable. Please try again shortly.')
      assert.match(error?.providerDetail, /upstream node pool internal detail/)
      assert.doesNotMatch(JSON.stringify(error?.getResponse?.()), /internal detail/)
      return true
    },
  )
  assert.equal(attempts, 3)
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
  const service = new AiService(gateway as any, {} as any)

  const summary = await service.generateSummary('<p>Hello **world** from a long note.</p>')

  assert.equal(summary, 'Hello world from a long note.')
})

test('AiService splits long notes into segments before summarizing', async () => {
  const calls: string[] = []
  const optionsSeen: any[] = []
  let inFlight = 0
  let maxInFlight = 0
  const gateway = {
    chat: async (options: any) => {
      calls.push(options.prompt)
      optionsSeen.push(options)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight -= 1
      return `seg:${options.prompt.length}`
    },
  }
  const service = new AiService(gateway as any, {} as any)

  // 构造 7000 字内容验证确实拆成多段并做一次合并摘要。
  const longContent = ('这是一个较长的笔记段落，用于验证分段摘要逻辑是否正常工作。'.repeat(200))
  assert.ok(longContent.length > 3000)

  const result = await service.generateSummary(longContent)

  // 分段调用 + 一次合并调用，共三段以上。
  assert.ok(calls.length >= 3)
  assert.match(result, /^seg:/)
  // 每个分段的 prompt 长度都不超过 1600 字分段上限加文案长度。
  calls.forEach((prompt) => assert.ok(prompt.length < 1800))
  optionsSeen.forEach((options) => assert.equal(options.reasoningEffort, 'none'))
  assert.equal(maxInFlight, 1)
})

test('AiService returns empty summary for empty content without calling gateway', async () => {
  let called = false
  const gateway = {
    chat: async () => { called = true; return 'unexpected' },
  }
  const service = new AiService(gateway as any, {} as any)

  const summary = await service.generateSummary('   \n  ')

  assert.equal(summary, '')
  assert.equal(called, false)
})

test('AiService skips AI for short content and returns it directly', async () => {
  let called = false
  const gateway = {
    chat: async () => { called = true; return 'AI summary' },
  }
  const service = new AiService(gateway as any, {} as any)

  const summary = await service.generateSummary('很短的一条笔记内容。')

  assert.equal(summary, '很短的一条笔记内容。')
  assert.equal(called, false)
})

test('AiService uses dynamic target length for medium content (40% of length)', async () => {
  const calls: string[] = []
  const optionsSeen: any[] = []
  const gateway = {
    chat: async (options: any) => {
      calls.push(options.prompt)
      optionsSeen.push(options)
      return 'AI summary'
    },
  }
  const service = new AiService(gateway as any, {} as any)

  // 155 字正文，目标 = floor(155*0.4) = 62，属于 121~300 区间，应调用 AI。
  const mediumContent = '笔记'.repeat(77) + '。'
  assert.ok(mediumContent.length > 120 && mediumContent.length <= 300)

  await service.generateSummary(mediumContent)

  assert.equal(calls.length, 1)
  assert.match(calls[0], /within 62 Chinese characters/)
  assert.equal(optionsSeen[0].maxTokens, 256)
  assert.equal(optionsSeen[0].temperature, 0.2)
  assert.equal(optionsSeen[0].reasoningEffort, 'none')
})

test('AiGatewayClient 为外部请求设置超时并重试瞬时网络错误', async () => {
  const signals: any[] = []
  let attempts = 0
  const fetchImpl = async (_url: any, init: any) => {
    signals.push(init.signal)
    attempts++
    if (attempts === 1) throw new TypeError('fetch failed')
    return jsonResponse({ choices: [{ message: { content: 'recovered' } }] })
  }
  const client = new AiGatewayClient(createConfig({ AI_REQUEST_TIMEOUT_MS: '120000' }) as any, fetchImpl as any)

  const result = await client.chat({ route: 'text', prompt: 'hello' })

  assert.equal(result, 'recovered')
  assert.equal(attempts, 2)
  assert.ok(signals.every((signal) => signal instanceof AbortSignal))
})

test('AiService caps summary target at 120 for long content', async () => {
  const calls: string[] = []
  const gateway = {
    chat: async (options: any) => {
      calls.push(options.prompt)
      return 'AI summary'
    },
  }
  const service = new AiService(gateway as any, {} as any)

  const longContent = '笔记内容'.repeat(100)
  assert.ok(longContent.length > 300)

  await service.generateSummary(longContent)

  // 超过 300 字时目标封顶 120 字。
  calls.forEach((prompt) => assert.match(prompt, /within 120 Chinese characters/))
})

test('AiGatewayClient reads non-standard content fields from provider response', async () => {
  const fetchImpl = async () => jsonResponse({ content: 'Plain content field' })
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any)

  const result = await client.chat({ route: 'text', prompt: 'hello' })

  assert.equal(result, 'Plain content field')
})

test('AiService returns cleaned topic names from the text provider', async () => {
  const gateway = {
    chat: async () => '"Frontend Performance"',
  }
  const service = new AiService(gateway as any, {} as any)

  const topic = await service.generateTopicName('notes')

  assert.equal(topic, 'Frontend Performance')
})

test('AiController forwards mindmap requests to AiService', async () => {
  const expected = { content: { nodeData: { id: 'root' } } }
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
