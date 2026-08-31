import assert = require('node:assert/strict')
import { test } from 'node:test'

import { AiGatewayClient } from '../src/modules/ai/ai-gateway.client'
import { AiRunTiming } from '../src/modules/ai/ai-run-timing'

class FakeConfigService {
  constructor(private readonly values: Record<string, string | undefined>) {}

  get<T = string>(key: string): T | undefined {
    return this.values[key] as T | undefined
  }
}

function createConfig() {
  return new FakeConfigService({
    AI_TASK_ROUTING_ENABLED: 'true',
    AI_REQUEST_TIMEOUT_MS: '1000',
    SILICONFLOW_API_KEY: 'siliconflow-secret',
    SILICONFLOW_BASE_URL: 'https://api.siliconflow.cn/v1',
    SILICONFLOW_ECONOMY_TEXT_MODEL: 'Qwen/Qwen3.5-4B',
    SILICONFLOW_STANDARD_TEXT_MODEL: 'Qwen/Qwen3-14B',
    SILICONFLOW_DEEP_REASONING_MODEL: 'deepseek-ai/DeepSeek-V4-Flash',
    BAI_API_KEY: 'bai-secret',
    BAI_BASE_URL: 'https://api.b.ai/v1',
    BAI_FALLBACK_MODEL: 'deepseek-v4-flash',
    AR_API_KEY: 'ar-secret',
    AR_BASE_URL: 'https://ps.air-outer.com/v1',
    AR_MODEL: 'claude-opus-4-8',
  })
}

function jsonResponse(body: any, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function sseResponse(content: string) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`))
      controller.close()
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function withProductionStreamMetadata(stream: ReadableStream<Uint8Array>) {
  Object.defineProperties(stream, {
    __aiProvider: {
      value: {
        provider: 'siliconflow',
        model: 'Qwen/Qwen3-14B',
        apiKey: 'siliconflow-secret',
        baseUrl: 'https://api.siliconflow.cn/v1',
      },
    },
    __aiRetryCount: { value: 0 },
  })
  return stream
}

async function readTextStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ''
  while (true) {
    const next = await reader.read()
    if (next.done) return output
    output += decoder.decode(next.value, { stream: true })
  }
}

function createCapacity() {
  return {
    estimateTokens: () => 100,
    reserve: async (provider: string) => ({ provider, granted: true, retryAfterMs: 0, reservedTokens: 100, activeKey: provider }),
    reconcile: async () => undefined,
    release: async () => undefined,
  }
}

function createAuditRecorder(options: { runId?: string; failStageWrites?: boolean } = {}) {
  const runId = options.runId || 'run-auto'
  const starts: any[] = []
  const stages: any[] = []
  const metrics: any[] = []
  const succeeded: any[] = []
  const failed: any[] = []
  return {
    starts,
    stages,
    metrics,
    succeeded,
    failed,
    service: {
      start: async (input: any) => {
        starts.push(input)
        return { ...input, runId, status: 'running' }
      },
      addStage: async (savedRunId: string, stage: any) => {
        if (options.failStageWrites) throw new Error('prompt content reasoning apiKey full provider response')
        stages.push({ runId: savedRunId, ...stage })
      },
      mergeMetrics: async (savedRunId: string, value: any) => {
        if (options.failStageWrites) throw new Error('prompt content reasoning apiKey full provider response')
        metrics.push({ runId: savedRunId, ...value })
      },
      succeed: async (savedRunId: string, attempt: any) => {
        succeeded.push({ runId: savedRunId, attempt })
      },
      fail: async (savedRunId: string, error: any) => {
        failed.push({ runId: savedRunId, error })
      },
    },
  }
}

function stageSummary(stages: any[]) {
  return stages.map(({ name, status, attempt, provider, model, fallbackType }) => ({
    name,
    status,
    attempt,
    provider,
    model,
    fallbackType,
  }))
}

function assertSafeAuditObject(value: unknown) {
  const forbidden = new Set(['prompt', 'content', 'reasoning', 'apiKey'])
  const visit = (current: any) => {
    if (!current || typeof current !== 'object') return
    for (const [key, child] of Object.entries(current)) {
      assert.equal(forbidden.has(key), false, `audit object contains forbidden field: ${key}`)
      visit(child)
    }
  }
  visit(value)
}

test('AiRunTiming emits a non-negative stage on success and failure without capturing work values', async () => {
  const stages: any[] = []
  const timing = new AiRunTiming((stage) => { stages.push(stage) })

  const result = await timing.measure('provider', async () => 'private provider body', {
    attempt: 1,
    provider: 'siliconflow',
    model: 'Qwen/Qwen3-14B',
  })
  await assert.rejects(
    () => timing.measure('validation', async () => { throw new Error('private validation value') }, { attempt: 1 }),
    /private validation value/,
  )

  assert.equal(result, 'private provider body')
  assert.deepEqual(stages.map(({ name, status }) => ({ name, status })), [
    { name: 'provider', status: 'succeeded' },
    { name: 'validation', status: 'failed' },
  ])
  assert.ok(stages.every((stage) => Number.isInteger(stage.durationMs) && stage.durationMs >= 0))
  assert.doesNotMatch(JSON.stringify(stages), /private provider body|private validation value/)
})

test('chatTask reuses a pre-created run and records primary capacity, provider, and validation stages', async () => {
  const audit = createAuditRecorder({ runId: 'run-precreated' })
  const fetchImpl = async () => jsonResponse({ choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }] })
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any, audit.service as any, createCapacity() as any)

  const result = await client.chatTask({
    task: 'writer',
    prompt: 'write',
    audit: { graphName: 'WriterGraph', userId: 'user-1', runId: 'run-precreated' },
  })

  assert.equal(result.content, 'answer')
  assert.equal(audit.starts.length, 0)
  assert.equal(audit.succeeded.length, 1)
  assert.equal(audit.failed.length, 0)
  assert.deepEqual(stageSummary(audit.stages), [
    { name: 'capacity_wait', status: 'succeeded', attempt: 1, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
    { name: 'provider', status: 'succeeded', attempt: 1, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
    { name: 'validation', status: 'succeeded', attempt: 1, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
  ])
  assert.ok(audit.stages.every((stage) => Number.isInteger(stage.durationMs) && stage.durationMs >= 0))
  assert.deepEqual(audit.metrics.map(({ runId, ...metrics }) => metrics), [
    { inputChars: 5 },
    { outputChars: 6 },
  ])
  assertSafeAuditObject({ stages: audit.stages, metrics: audit.metrics })
})

test('streamTask records provider stages and finalizes after the response stream is consumed', async () => {
  const audit = createAuditRecorder({ runId: 'run-stream' })
  const client = new AiGatewayClient(
    createConfig() as any,
    (async () => sseResponse('stream answer')) as any,
    audit.service as any,
    createCapacity() as any,
  )

  const stream = await client.streamTask({
    task: 'writer',
    prompt: 'write',
    audit: { graphName: 'WriterGraph', runId: 'run-stream' },
  })
  const content = await readTextStream(stream)

  assert.equal(content, 'stream answer')
  assert.equal(audit.starts.length, 0)
  assert.deepEqual(stageSummary(audit.stages), [
    { name: 'capacity_wait', status: 'succeeded', attempt: 1, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
    { name: 'provider', status: 'succeeded', attempt: 1, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
    { name: 'validation', status: 'succeeded', attempt: 1, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
  ])
  assert.deepEqual(audit.metrics.map(({ runId, ...metrics }) => metrics), [
    { inputChars: 5 },
    { outputChars: 13 },
  ])
  assert.equal(audit.succeeded.length, 1)
  assert.equal(audit.failed.length, 0)
})

test('streamTask keeps provider fallback attempts in one audit run', async () => {
  const audit = createAuditRecorder()
  const fetchImpl = async (url: any) => String(url).startsWith('https://api.siliconflow.cn/')
    ? jsonResponse({ error: { message: 'rate limited' } }, 429, { 'Retry-After': '0' })
    : sseResponse('fallback stream')
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any, audit.service as any, createCapacity() as any)

  const content = await readTextStream(await client.streamTask({ task: 'writer', prompt: 'write' }))

  assert.equal(content, 'fallback stream')
  assert.deepEqual(
    audit.stages.filter((stage) => stage.name === 'provider').map(({ attempt, status, provider, fallbackType }) => ({ attempt, status, provider, fallbackType })),
    [
      { attempt: 1, status: 'failed', provider: 'siliconflow', fallbackType: undefined },
      { attempt: 2, status: 'failed', provider: 'siliconflow', fallbackType: undefined },
      { attempt: 3, status: 'failed', provider: 'siliconflow', fallbackType: undefined },
      { attempt: 4, status: 'succeeded', provider: 'bai', fallbackType: 'provider' },
    ],
  )
  assert.deepEqual(stageSummary(audit.stages).slice(-2), [
    { name: 'provider', status: 'succeeded', attempt: 4, provider: 'bai', model: 'deepseek-v4-flash', fallbackType: 'provider' },
    { name: 'validation', status: 'succeeded', attempt: 4, provider: 'bai', model: 'deepseek-v4-flash', fallbackType: 'provider' },
  ])
  assert.equal(audit.succeeded.length, 1)
  assert.equal(audit.failed.length, 0)
})

test('streamTask finalizes a post-prime stream failure once', async () => {
  const audit = createAuditRecorder()
  const encoder = new TextEncoder()
  const client = new AiGatewayClient(createConfig() as any, (async () => sseResponse('unused')) as any, audit.service as any, createCapacity() as any)
  ;(client as any).openPrimedTaskStream = async () => new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('partial'))
      setTimeout(() => controller.error(new Error('upstream stream failed')), 0)
    },
  })

  const stream = await client.streamTask({ task: 'writer', prompt: 'write' })

  await assert.rejects(() => readTextStream(stream), /upstream stream failed/)
  assert.equal(audit.succeeded.length, 0)
  assert.equal(audit.failed.length, 1)
})

test('streamTask finalizes client cancellation as one failure', async () => {
  const audit = createAuditRecorder()
  const encoder = new TextEncoder()
  const client = new AiGatewayClient(createConfig() as any, (async () => sseResponse('unused')) as any, audit.service as any, createCapacity() as any)
  ;(client as any).openPrimedTaskStream = async () => withProductionStreamMetadata(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('partial'))
    },
  }))

  const reader = (await client.streamTask({ task: 'writer', prompt: 'write' })).getReader()
  const first = await reader.read()
  assert.equal(new TextDecoder().decode(first.value), 'partial')
  await reader.cancel('client cancelled')
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.equal(audit.succeeded.length + audit.failed.length, 1)
  assert.equal(audit.succeeded.length, 0)
  assert.equal(audit.failed.length, 1)
})

test('streamTask counts a UTF-8 character split across chunks once', async () => {
  const audit = createAuditRecorder()
  const encoded = new TextEncoder().encode('你')
  const client = new AiGatewayClient(createConfig() as any, (async () => sseResponse('unused')) as any, audit.service as any, createCapacity() as any)
  ;(client as any).openPrimedTaskStream = async () => withProductionStreamMetadata(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded.slice(0, 1))
      controller.enqueue(encoded.slice(1))
      controller.close()
    },
  }))

  const content = await readTextStream(await client.streamTask({ task: 'writer', prompt: 'write' }))

  assert.equal(content, '你')
  assert.deepEqual(audit.metrics.map(({ runId, ...metrics }) => metrics), [
    { inputChars: 5 },
    { outputChars: 1 },
  ])
})

test('chatTask records each transient retry as its own provider attempt', async () => {
  const audit = createAuditRecorder()
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return calls === 1
      ? jsonResponse({ error: { message: 'rate limited' } }, 429, { 'Retry-After': '0' })
      : jsonResponse({ choices: [{ message: { content: 'recovered' } }] })
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any, audit.service as any, createCapacity() as any)

  await client.chatTask({ task: 'writer', prompt: 'write' })

  assert.equal(audit.starts.length, 1)
  assert.deepEqual(stageSummary(audit.stages), [
    { name: 'capacity_wait', status: 'succeeded', attempt: 1, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
    { name: 'provider', status: 'failed', attempt: 1, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
    { name: 'capacity_wait', status: 'succeeded', attempt: 2, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
    { name: 'provider', status: 'succeeded', attempt: 2, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
    { name: 'validation', status: 'succeeded', attempt: 2, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
  ])
})

test('chatTask records failed validation before a quality fallback attempt', async () => {
  const audit = createAuditRecorder()
  const fetchImpl = async (_url: any, init: any) => {
    const model = JSON.parse(init.body).model
    return model === 'Qwen/Qwen3-14B'
      ? jsonResponse({ choices: [{ message: { content: '{"nodes":{}}' } }] })
      : jsonResponse({ choices: [{ message: { content: '{"nodes":[],"edges":[]}' } }] })
  }
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any, audit.service as any, createCapacity() as any)

  await client.chatTask({ task: 'knowledge_graph', prompt: 'extract' })

  assert.deepEqual(stageSummary(audit.stages), [
    { name: 'capacity_wait', status: 'succeeded', attempt: 1, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
    { name: 'provider', status: 'succeeded', attempt: 1, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
    { name: 'validation', status: 'failed', attempt: 1, provider: 'siliconflow', model: 'Qwen/Qwen3-14B', fallbackType: undefined },
    { name: 'capacity_wait', status: 'succeeded', attempt: 2, provider: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4-Flash', fallbackType: 'quality' },
    { name: 'provider', status: 'succeeded', attempt: 2, provider: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4-Flash', fallbackType: 'quality' },
    { name: 'validation', status: 'succeeded', attempt: 2, provider: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4-Flash', fallbackType: 'quality' },
  ])
})

test('chatTask numbers provider fallback after every exhausted primary provider attempt', async () => {
  const audit = createAuditRecorder()
  const fetchImpl = async (url: any) => String(url).startsWith('https://api.siliconflow.cn/')
    ? jsonResponse({ error: { message: 'rate limited' } }, 429, { 'Retry-After': '0' })
    : jsonResponse({ choices: [{ message: { content: 'fallback' } }] })
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any, audit.service as any, createCapacity() as any)

  await client.chatTask({ task: 'writer', prompt: 'write' })

  const providers = audit.stages.filter((stage) => stage.name === 'provider')
  assert.deepEqual(providers.map(({ attempt, status, provider, fallbackType }) => ({ attempt, status, provider, fallbackType })), [
    { attempt: 1, status: 'failed', provider: 'siliconflow', fallbackType: undefined },
    { attempt: 2, status: 'failed', provider: 'siliconflow', fallbackType: undefined },
    { attempt: 3, status: 'failed', provider: 'siliconflow', fallbackType: undefined },
    { attempt: 4, status: 'succeeded', provider: 'bai', fallbackType: 'provider' },
  ])
  assert.equal(audit.stages.at(-1).name, 'validation')
  assert.equal(audit.stages.at(-1).attempt, 4)
  assert.equal(audit.stages.at(-1).fallbackType, 'provider')
})

test('chatTask closes the final failed validation stage and finalizes the run once', async () => {
  const audit = createAuditRecorder()
  const fetchImpl = async () => jsonResponse({ choices: [{ message: { content: '{"nodes":{}}' } }] })
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any, audit.service as any, createCapacity() as any)

  await assert.rejects(() => client.chatTask({ task: 'knowledge_graph', prompt: 'extract' }), /validation/)

  assert.equal(audit.succeeded.length, 0)
  assert.equal(audit.failed.length, 1)
  assert.deepEqual(audit.stages.filter((stage) => stage.name === 'validation').map(({ attempt, status, fallbackType }) => ({ attempt, status, fallbackType })), [
    { attempt: 1, status: 'failed', fallbackType: undefined },
    { attempt: 2, status: 'failed', fallbackType: 'quality' },
  ])
  assert.ok(audit.stages.every((stage) => stage.durationMs >= 0))
})

test('audit stage write failures do not change a successful task result or leak audit error details', async () => {
  const audit = createAuditRecorder({ failStageWrites: true })
  const warnings: string[] = []
  const fetchImpl = async () => jsonResponse({ choices: [{ message: { content: 'answer' } }] })
  const client = new AiGatewayClient(createConfig() as any, fetchImpl as any, audit.service as any, createCapacity() as any)
  ;(client as any).logger = { warn: (message: string) => warnings.push(message) }

  const result = await client.chatTask({ task: 'writer', prompt: 'private prompt' })

  assert.equal(result.content, 'answer')
  assert.equal(audit.succeeded.length, 1)
  assert.ok(warnings.length >= 1)
  assert.doesNotMatch(warnings.join('\n'), /private prompt|prompt|content|reasoning|apiKey|full provider response|secret/i)
})
