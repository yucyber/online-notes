import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  AiChatOptions,
  AiChatRoute,
  AiFailureReason,
  AiModelTarget,
  AiProviderConfig,
  AiReasoningMode,
  AiRerankResult,
  AiTask,
  AiTaskResult,
} from './ai-gateway.types'
import { resolveAiModelPolicy } from './ai-model-policy'
import { buildProviderOptions } from './ai-provider-adapter'
import { validateAiOutput } from './ai-output-validator'
import { AiRunService } from './ai-run.service'

type FetchLike = (url: string, init?: any) => Promise<any>

export class AiProviderHttpError extends HttpException {
  constructor(
    status: number,
    readonly providerDetail: string,
  ) {
    const message = status === HttpStatus.TOO_MANY_REQUESTS
      ? 'AI provider is temporarily rate limited. Please try again shortly.'
      : status >= 500
        ? 'AI provider is temporarily unavailable. Please try again shortly.'
        : 'AI provider rejected the request.'
    super(message, status)
  }
}

class AiTaskOutputError extends Error {
  constructor(readonly reason: AiFailureReason) {
    super(reason === 'empty_content' ? 'AI chat returned no assistant content' : `AI task output failed validation: ${reason}`)
  }
}

@Injectable()
export class AiGatewayClient {
  // AgentRouter 网关（阿里云 WAF）对 UA 做精确校验，缺了这个 UA 一律返回 401 unauthorized_client_error。
  // 该 UA 是官方 claude-cli 的签名，必须原样保留；对其它供应商是无害的额外请求头。
  private static readonly AR_USER_AGENT = 'claude-cli/2.1.75 (external, cli)'

  private readonly fetchImpl: FetchLike
  private readonly logger = new Logger(AiGatewayClient.name)

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject('AI_GATEWAY_FETCH')
    fetchImpl?: FetchLike,
    @Optional()
    private readonly aiRuns?: AiRunService,
  ) {
    this.fetchImpl = fetchImpl || ((globalThis.fetch as any).bind(globalThis))
  }

  describeChatRoute(route: AiChatRoute = 'text'): Pick<AiProviderConfig, 'provider' | 'model'> {
    const provider = this.resolveChatProviderName(route)
    const keys = this.chatProviderKeys(route, provider)
    return {
      provider,
      model: this.configService.get<string>(keys.model) || '',
    }
  }

  async chat(options: AiChatOptions): Promise<string> {
    const provider = this.resolveChatProvider(options)

    try {
      return await this.chatWithProvider(options, provider)
    } catch (error) {
      if (!this.shouldUseSummaryProviderFallback(options, provider, error)) throw error
      return this.chatWithProvider(options, this.resolveSummaryProviderFallback())
    }
  }

  private async chatWithProvider(options: AiChatOptions, provider: AiProviderConfig): Promise<string> {
    return (await this.chatWithProviderDetailed(options, provider)).content
  }

  private async chatWithProviderDetailed(options: AiChatOptions, provider: AiProviderConfig): Promise<{
    content: string
    retryCount: number
    finishReason?: string
    reasoningChars: number
  }> {
    // 推理型模型可能把小预算的 maxTokens 全部耗在思考过程上，导致 content 为空。
    // 当 content 为空且 finish_reason=length 时，用更高的预算有限重试一次，尽量让模型产出正文。
    const first = await this.chatOnce(options, provider)
    const content = this.extractChatContent(first.data)
    if (content) return this.chatExecution(first, String(content).trim())

    if (options.retryOnLengthOverflow && this.isLengthOverflow(first.data)) {
      const retried = await this.chatOnce(options, provider, this.retryMaxTokens(options.maxTokens))
      const retriedContent = this.extractChatContent(retried.data)
      if (retriedContent) {
        retried.retryCount += first.retryCount + 1
        return this.chatExecution(retried, String(retriedContent).trim())
      }
      throw new AiTaskOutputError('length_exhausted')
    }

    throw new AiTaskOutputError('empty_content')
  }

  private chatExecution(result: { data: any; retryCount: number }, content: string) {
    return {
      content,
      retryCount: result.retryCount,
      finishReason: result.data.choices?.[0]?.finish_reason,
      reasoningChars: String(result.data.choices?.[0]?.message?.reasoning || '').length,
    }
  }

  private shouldUseSummaryProviderFallback(options: AiChatOptions, provider: AiProviderConfig, error: any): boolean {
    if (options.task !== 'note_summary' || provider.provider !== 'siliconflow') return false
    const status = Number(error?.getStatus?.())
    return status === HttpStatus.TOO_MANY_REQUESTS || status === HttpStatus.SERVICE_UNAVAILABLE
  }

  private resolveSummaryProviderFallback(): AiProviderConfig {
    return this.readProviderConfig('bai', {
      apiKey: 'BAI_API_KEY',
      baseUrl: 'BAI_BASE_URL',
      model: 'BAI_FALLBACK_MODEL',
    })
  }

  // 单次非流式 chat 请求，返回解析后的响应体。
  private async chatOnce(options: AiChatOptions, provider: AiProviderConfig, maxTokensOverride?: number): Promise<{ data: any; retryCount: number }> {
    const response = await this.postJson(
      this.endpoint(provider.baseUrl, '/chat/completions'),
      provider.apiKey,
      this.chatBody(provider, { ...options, maxTokens: maxTokensOverride ?? options.maxTokens }, { stream: false }),
      `${provider.provider} chat`,
    )
    return {
      data: await response.json().catch(() => ({})),
      retryCount: Number((response as any).__aiRetryCount || 0),
    }
  }

  // content 为空时是否由预算耗尽（finish_reason=length）导致，用于判断是否值得重试。
  private isLengthOverflow(data: any): boolean {
    return data.choices?.[0]?.finish_reason === 'length'
  }

  // 重试预算在原值基础上翻倍，但不超过一个安全上限，避免单次摘要请求无界放大成本。
  private retryMaxTokens(original?: number): number {
    const base = original ?? 1024
    return Math.min(Math.max(base * 2, 2048), 16000)
  }

  // 兼容不同厂商的非标准返回结构：优先 OpenAI choices，其次顶层 content/result 等字段。
  // 只用于取正文，不依赖某一家的固定 schema，避免某 provider 返回结构差异导致误判空响应。
  private extractChatContent(data: any): string {
    const choicesContent = data.choices?.[0]?.message?.content
    if (choicesContent) return String(choicesContent)
    const fallbacks = [data.content, data.result, data.output, data.answer, data.data?.content]
    for (const value of fallbacks) {
      if (value && typeof value === 'string' && value.trim()) return String(value)
    }
    return ''
  }

  // 生成不泄露密钥的诊断摘要：只保留顶层键名、正文与 reasoning 长度，帮助定位空响应/结构异常。
  // reasoning 仅用于诊断长度，绝不作为返回值写入数据。
  private describeChatBody(data: any, provider: AiProviderConfig): string {
    const topKeys = Object.keys(data || {}).slice(0, 10).join(',')
    const contentLen = (() => {
      const text = this.extractChatContent(data)
      return text ? `${text.length} chars` : '0'
    })()
    const reasoningLen = String(data.choices?.[0]?.message?.reasoning || '').length
    const finishReason = data.choices?.[0]?.finish_reason || ''
    return `model=${provider.model} topKeys=[${topKeys}] contentLen=${contentLen} reasoningLen=${reasoningLen} finishReason=${finishReason}`
  }

  async streamChat(options: AiChatOptions): Promise<ReadableStream<Uint8Array>> {
    const provider = this.resolveChatProvider(options)
    const response = await this.postJson(this.endpoint(provider.baseUrl, '/chat/completions'), provider.apiKey, this.chatBody(provider, options, {
      stream: true,
    }), `${provider.provider} stream chat`)

    if (!response.body) throw new Error(`${provider.provider} stream chat returned no body`)
    return this.openAiSseToTextStream(response.body)
  }

  async streamTask(options: AiChatOptions & { task: AiTask }): Promise<ReadableStream<Uint8Array>> {
    const policy = this.resolveActiveTaskPolicy(options.task)
    const taskOptions = {
      ...options,
      reasoningMode: policy.reasoningMode,
      maxTokens: options.maxTokens ?? policy.maxTokens,
    }
    const startedAt = Date.now()
    const runId = await this.startTaskRun(options, policy.reasoningMode, policy.primary)
    let stream: ReadableStream<Uint8Array>
    let fallbackReason: AiFailureReason | undefined
    try {
      stream = await this.openPrimedTaskStream(taskOptions, policy.primary)
    } catch (error) {
      fallbackReason = this.classifyFailure(error)
      if (!policy.providerFallback || !this.isProviderFailure(fallbackReason)) {
        await this.failTaskRun(runId, error)
        throw error
      }
      try {
        stream = await this.openPrimedTaskStream(taskOptions, policy.providerFallback)
      } catch (fallbackError) {
        await this.failTaskRun(runId, fallbackError)
        throw fallbackError
      }
    }
    return this.auditTextStream(stream, runId, options.task, policy.reasoningMode, startedAt, fallbackReason)
  }

  private auditTextStream(
    stream: ReadableStream<Uint8Array>,
    runId: string | undefined,
    task: AiTask,
    reasoningMode: AiReasoningMode,
    startedAt: number,
    fallbackReason?: AiFailureReason,
  ): ReadableStream<Uint8Array> {
    if (!runId || !this.aiRuns) return stream
    const reader = stream.getReader()
    const provider = (stream as any).__aiProvider as AiProviderConfig
    const retryCount = Number((stream as any).__aiRetryCount || 0)
    let contentChars = 0
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        const pump = async () => {
          try {
            while (true) {
              const next = await reader.read()
              if (next.done) break
              if (next.value) {
                contentChars += new TextDecoder().decode(next.value).length
                controller.enqueue(next.value)
              }
            }
            await this.succeedTaskRun(runId, {
              content: '',
              attempt: {
                task, reasoningMode, provider: provider.provider, model: provider.model,
                durationMs: Date.now() - startedAt, retryCount,
                fallbackUsed: Boolean(fallbackReason),
                fallbackType: fallbackReason ? 'provider' : undefined,
                fallbackReason, contentChars, reasoningChars: 0, validationResult: 'valid',
              },
            })
            controller.close()
          } catch (error) {
            await this.failTaskRun(runId, error)
            controller.error(error)
          }
        }
        void pump()
      },
      cancel(reason) { return reader.cancel(reason) },
    })
  }

  private async openPrimedTaskStream(
    options: AiChatOptions & { task: AiTask },
    target: AiModelTarget,
  ): Promise<ReadableStream<Uint8Array>> {
    const provider = this.resolveModelTarget(target)
    const response = await this.postJson(
      this.endpoint(provider.baseUrl, '/chat/completions'),
      provider.apiKey,
      this.chatBody(provider, options, { stream: true }),
      `${provider.provider} stream task`,
    )
    if (!response.body) throw new Error(`${provider.provider} stream chat returned no body`)

    const source = this.openAiSseToTextStream(response.body)
    const reader = source.getReader()
    let first: ReadableStreamReadResult<Uint8Array>
    try {
      first = await reader.read()
    } catch (error: any) {
      throw new HttpException(`stream failed before content: ${error?.message || 'upstream error'}`, HttpStatus.SERVICE_UNAVAILABLE)
    }
    if (first.done || !first.value?.length) throw new AiTaskOutputError('empty_content')

    // 首个正文 chunk 是跨模型降级边界；交付后发生错误只透传，不能拼接第二个模型的输出。
    const primed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first.value)
        const pump = async () => {
          try {
            while (true) {
              const next = await reader.read()
              if (next.done) break
              if (next.value) controller.enqueue(next.value)
            }
            controller.close()
          } catch (error) {
            controller.error(error)
          }
        }
        void pump()
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    })
    Object.defineProperties(primed, {
      __aiProvider: { value: provider },
      __aiRetryCount: { value: Number((response as any).__aiRetryCount || 0) },
    })
    return primed
  }

  async embedding(text: string): Promise<number[]> {
    if (!text) return []
    const provider = this.resolveEmbeddingProvider()
    const response = await this.postJson(this.endpoint(provider.baseUrl, '/embeddings'), provider.apiKey, {
      model: provider.model,
      input: text,
    }, `${provider.provider} embedding`)

    const data = await response.json().catch(() => ({}))
    const embedding = data.data?.[0]?.embedding
    if (!Array.isArray(embedding)) throw new Error(`${provider.provider} embedding returned no vector`)
    return embedding.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value))
  }

  async rerank(query: string, documents: string[]): Promise<AiRerankResult[]> {
    if (!query || documents.length === 0) return []
    const provider = this.resolveRerankerProvider()
    const path = this.configService.get<string>('SILICONFLOW_RERANKER_PATH') || '/rerank'
    const response = await this.postJson(this.endpoint(provider.baseUrl, this.ensurePath(path)), provider.apiKey, {
      model: provider.model,
      query,
      documents,
    }, `${provider.provider} rerank`)

    const data = await response.json().catch(() => ({}))
    const results = Array.isArray(data.results) ? data.results : []
    return results.map((item: any) => {
      const index = Number(item.index)
      const score = Number(item.relevance_score ?? item.score ?? item.relevanceScore ?? 0)
      return {
        index,
        score,
        document: documents[index],
      }
    }).filter((item: AiRerankResult) => Number.isInteger(item.index) && Number.isFinite(item.score))
  }

  private resolveChatProvider(options: AiChatOptions): AiProviderConfig {
    if (options.task === 'note_summary' && this.taskRoutingEnabled()) {
      return this.readProviderConfig('siliconflow', {
        apiKey: 'SILICONFLOW_API_KEY',
        baseUrl: 'SILICONFLOW_BASE_URL',
        model: 'SILICONFLOW_STANDARD_TEXT_MODEL',
      })
    }

    const route = options.route || 'text'
    const provider = this.resolveChatProviderName(route)
    return this.readProviderConfig(provider, this.chatProviderKeys(route, provider))
  }

  private taskRoutingEnabled(): boolean {
    return String(this.configService.get<string>('AI_TASK_ROUTING_ENABLED') || '').toLowerCase() === 'true'
  }

  private resolveActiveTaskPolicy(task: AiTask): ReturnType<typeof resolveAiModelPolicy> {
    const policy = resolveAiModelPolicy(task)
    if (this.taskRoutingEnabled()) return policy

    // 灰度开关关闭时保持迁移前的 text/reasoning 两级路由，并禁止触发新策略的跨供应商 fallback。
    const legacyReasoningTasks: AiTask[] = [
      'aggregate_summary',
      'mindmap',
      'mermaid',
      'destructive_reorganization',
      'conflict_analysis',
      'proposal_revision',
    ]
    const useReasoning = legacyReasoningTasks.includes(task)
    return {
      ...policy,
      primary: useReasoning ? 'siliconflow_deep' : 'siliconflow_standard',
      reasoningMode: useReasoning ? 'deep' : 'off',
      qualityFallback: undefined,
      providerFallback: undefined,
    }
  }

  private resolveChatProviderName(route: AiChatRoute): string {
    return String(
      this.configService.get<string>(route === 'reasoning' ? 'AI_REASONING_PROVIDER' : 'AI_TEXT_PROVIDER') ||
      'siliconflow',
    ).toLowerCase()
  }

  private resolveModelTarget(target: AiModelTarget): AiProviderConfig {
    if (target === 'siliconflow_economy') {
      return this.readProviderConfig('siliconflow', {
        apiKey: 'SILICONFLOW_API_KEY', baseUrl: 'SILICONFLOW_BASE_URL', model: 'SILICONFLOW_ECONOMY_TEXT_MODEL',
      })
    }
    if (target === 'siliconflow_standard') {
      return this.readProviderConfig('siliconflow', {
        apiKey: 'SILICONFLOW_API_KEY', baseUrl: 'SILICONFLOW_BASE_URL', model: 'SILICONFLOW_STANDARD_TEXT_MODEL',
      })
    }
    if (target === 'siliconflow_deep') {
      return this.readProviderConfig('siliconflow', {
        apiKey: 'SILICONFLOW_API_KEY', baseUrl: 'SILICONFLOW_BASE_URL', model: 'SILICONFLOW_DEEP_REASONING_MODEL',
      })
    }
    if (target === 'bai_deepseek') return this.resolveSummaryProviderFallback()
    return this.readProviderConfig('ar', { apiKey: 'AR_API_KEY', baseUrl: 'AR_BASE_URL', model: 'AR_MODEL' })
  }

  private isModelTarget(value: string): value is AiModelTarget {
    return ['siliconflow_economy', 'siliconflow_standard', 'siliconflow_deep', 'bai_deepseek', 'ar_expert'].includes(value)
  }

  private classifyFailure(error: any): AiFailureReason {
    if (error instanceof AiTaskOutputError) return error.reason
    const status = Number(error?.getStatus?.())
    if (status === 429) return 'rate_limited'
    if (status === 401) return 'unauthorized'
    if (status === 403) return 'forbidden'
    if (status >= 500) {
      return /timeout|abort/i.test(String(error?.providerDetail || error?.message || ''))
        ? 'timeout'
        : 'upstream_unavailable'
    }
    if (status >= 400) return 'rejected'
    if (error?.name === 'AbortError') return 'cancelled'
    return 'rejected'
  }

  private isQualityFailure(reason: AiFailureReason): boolean {
    return ['empty_content', 'length_exhausted', 'invalid_output'].includes(reason)
  }

  private isProviderFailure(reason: AiFailureReason): boolean {
    return ['rate_limited', 'upstream_unavailable', 'timeout'].includes(reason)
  }

  describeTaskRoute(task: AiTask): Pick<AiProviderConfig, 'provider' | 'model'> {
    const policy = this.resolveActiveTaskPolicy(task)
    const { provider, model } = this.resolveModelTarget(policy.primary)
    return { provider, model }
  }

  describeQualityFallbackRoute(task: AiTask): Pick<AiProviderConfig, 'provider' | 'model'> | undefined {
    const target = this.resolveActiveTaskPolicy(task).qualityFallback
    if (!target || !this.isModelTarget(target)) return undefined
    const { provider, model } = this.resolveModelTarget(target)
    return { provider, model }
  }

  async chatTask(options: AiChatOptions & { task: AiTask }): Promise<AiTaskResult> {
    const policy = this.resolveActiveTaskPolicy(options.task)
    const taskOptions = {
      ...options,
      reasoningMode: policy.reasoningMode,
      maxTokens: options.maxTokens ?? policy.maxTokens,
    }
    const startedAt = Date.now()
    const runId = await this.startTaskRun(options, policy.reasoningMode, policy.primary)

    try {
      let result: AiTaskResult
      try {
        result = await this.executeTaskAttempt(taskOptions, policy.primary, startedAt)
      } catch (error) {
        const reason = this.classifyFailure(error)
        const qualityTarget = policy.qualityFallback
        if (this.isQualityFailure(reason) && qualityTarget && this.isModelTarget(qualityTarget)) {
          result = await this.executeTaskAttempt(taskOptions, qualityTarget, startedAt, 'quality', reason)
        } else if (this.isProviderFailure(reason) && policy.providerFallback) {
          result = await this.executeTaskAttempt(taskOptions, policy.providerFallback, startedAt, 'provider', reason)
        } else {
          throw error
        }
      }
      await this.succeedTaskRun(runId, result)
      return result
    } catch (error) {
      await this.failTaskRun(runId, error)
      throw error
    }
  }

  private async startTaskRun(options: AiChatOptions & { task: AiTask }, reasoningMode: AiReasoningMode, target: AiModelTarget) {
    if (!this.aiRuns) return undefined
    try {
      const route = this.resolveModelTarget(target)
      return (await this.aiRuns.start({
        graphName: options.audit?.graphName || options.task,
        task: options.task,
        reasoningMode,
        userId: options.audit?.userId,
        provider: route.provider,
        model: route.model,
      })).runId
    } catch (error: any) {
      this.logger.warn(`AI run audit start failed for ${options.task}: ${error.message}`)
      return undefined
    }
  }

  private async succeedTaskRun(runId: string | undefined, result: AiTaskResult) {
    if (!runId || !this.aiRuns) return
    try { await this.aiRuns.succeed(runId, result.attempt) }
    catch (error: any) { this.logger.warn(`AI run audit success update failed for ${runId}: ${error.message}`) }
  }

  private async failTaskRun(runId: string | undefined, error: unknown) {
    if (!runId || !this.aiRuns) return
    try { await this.aiRuns.fail(runId, error) }
    catch (auditError: any) { this.logger.warn(`AI run audit failure update failed for ${runId}: ${auditError.message}`) }
  }

  private async executeTaskAttempt(
    options: AiChatOptions & { task: AiTask },
    target: AiModelTarget,
    startedAt: number,
    fallbackType?: 'quality' | 'provider',
    fallbackReason?: AiFailureReason,
  ): Promise<AiTaskResult> {
    const provider = this.resolveModelTarget(target)
    const execution = await this.chatWithProviderDetailed(options, provider)
    const validation = validateAiOutput(options.task, execution.content, { allowedNoteIds: options.allowedNoteIds })
    if (!validation.valid) throw new AiTaskOutputError(validation.reason || 'invalid_output')
    return {
      content: execution.content,
      attempt: {
        task: options.task,
        reasoningMode: options.reasoningMode || 'off',
        provider: provider.provider,
        model: provider.model,
        durationMs: Math.max(0, Date.now() - startedAt),
        retryCount: execution.retryCount,
        fallbackUsed: Boolean(fallbackType),
        fallbackType,
        fallbackReason,
        finishReason: execution.finishReason,
        contentChars: execution.content.length,
        reasoningChars: execution.reasoningChars,
        validationResult: 'valid',
      },
    }
  }

  private chatProviderKeys(route: AiChatRoute, provider: string) {
    if (provider === 'siliconflow') {
      return {
        apiKey: 'SILICONFLOW_API_KEY',
        baseUrl: 'SILICONFLOW_BASE_URL',
        model: route === 'reasoning' ? 'SILICONFLOW_DEEP_REASONING_MODEL' : 'SILICONFLOW_STANDARD_TEXT_MODEL',
      }
    }

    if (provider === 'ar') {
      return {
        apiKey: 'AR_API_KEY',
        baseUrl: 'AR_BASE_URL',
        model: 'AR_MODEL',
      }
    }

    throw new Error(`Unsupported ${route} AI provider: ${provider}`)
  }

  private resolveEmbeddingProvider(): AiProviderConfig {
    const provider = String(this.configService.get<string>('AI_EMBEDDING_PROVIDER') || 'siliconflow').toLowerCase()
    if (provider !== 'siliconflow') throw new Error(`Unsupported embedding AI provider: ${provider}`)

    return this.readProviderConfig(provider, {
      apiKey: 'SILICONFLOW_API_KEY',
      baseUrl: 'SILICONFLOW_BASE_URL',
      model: 'SILICONFLOW_EMBEDDING_MODEL',
    })
  }

  private resolveRerankerProvider(): AiProviderConfig {
    const provider = String(this.configService.get<string>('AI_RERANKER_PROVIDER') || 'siliconflow').toLowerCase()
    if (provider !== 'siliconflow') throw new Error(`Unsupported reranker AI provider: ${provider}`)

    return this.readProviderConfig(provider, {
      apiKey: 'SILICONFLOW_API_KEY',
      baseUrl: 'SILICONFLOW_BASE_URL',
      model: 'SILICONFLOW_RERANKER_MODEL',
    })
  }

  private readProviderConfig(provider: string, keys: { apiKey: string; baseUrl: string; model: string }): AiProviderConfig {
    const apiKey = this.configService.get<string>(keys.apiKey)
    const baseUrl = this.configService.get<string>(keys.baseUrl)
    const model = this.configService.get<string>(keys.model)
    const missing = [
      [keys.apiKey, apiKey],
      [keys.baseUrl, baseUrl],
      [keys.model, model],
    ].filter(([, value]) => !value).map(([key]) => key)

    if (missing.length > 0) {
      throw new Error(`AI provider configuration missing for ${provider}: ${missing.join(', ')}`)
    }

    return { provider, apiKey, baseUrl, model }
  }

  private buildMessages(options: AiChatOptions) {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = []
    if (options.system) messages.push({ role: 'system', content: options.system })
    messages.push({ role: 'user', content: options.prompt })
    return messages
  }

  private chatBody(provider: AiProviderConfig, options: AiChatOptions, extra: { stream: boolean }) {
    const body: Record<string, any> = {
      model: provider.model,
      messages: this.buildMessages(options),
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? (extra.stream ? 0.5 : 0.3),
      stream: extra.stream || undefined,
    }
    if (options.responseFormat) body.response_format = options.responseFormat
    const reasoningMode = options.reasoningMode || (options.reasoningEffort === 'none' ? 'off' : 'auto')
    Object.assign(body, buildProviderOptions({ provider: provider.provider, model: provider.model, reasoningMode }))
    return body
  }

  private async postJson(url: string, apiKey: string, body: any, label: string) {
    const retryableStatuses = new Set([429, 502, 503, 504])
    const timeoutMs = Math.max(1000, Number(this.configService.get<string>('AI_REQUEST_TIMEOUT_MS') || 120_000))

    for (let attempt = 0; attempt <= 2; attempt += 1) {
      let response: any
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': AiGatewayClient.AR_USER_AGENT,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error: any) {
        if (attempt < 2) {
          await this.sleep(500 * (2 ** attempt))
          continue
        }
        throw new HttpException(`${label} request failed: ${error?.name || 'network error'}`, HttpStatus.SERVICE_UNAVAILABLE)
      }

      if (response.ok) {
        Object.defineProperty(response, '__aiRetryCount', { value: attempt, configurable: true })
        return response
      }

      const error = await this.readProviderError(response)
      if (retryableStatuses.has(response.status) && attempt < 2) {
        // Token Plan 明确建议对 429 退避；Retry-After 优先，避免多个请求同时再次撞限流。
        await this.sleep(this.retryDelayMs(response, attempt))
        continue
      }

      const status = retryableStatuses.has(response.status) && response.status !== 429
        ? HttpStatus.SERVICE_UNAVAILABLE
        : response.status
      throw new AiProviderHttpError(
        status,
        `${label} request failed: HTTP ${response.status}${error ? ` ${error}` : ''}`,
      )
    }

    throw new HttpException(`${label} request failed`, HttpStatus.SERVICE_UNAVAILABLE)
  }

  private retryDelayMs(response: any, attempt: number): number {
    const retryAfter = response.headers?.get?.('retry-after')
    if (retryAfter !== null && retryAfter !== undefined && retryAfter !== '') {
      const seconds = Number(retryAfter)
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
    }
    return 500 * (2 ** attempt) + Math.floor(Math.random() * 250)
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  private async readProviderError(response: any): Promise<string> {
    const text = await response.text().catch(() => '')
    if (!text) return ''
    try {
      const data = JSON.parse(text)
      return String(data.error?.message || data.message || data.msg || text).slice(0, 500)
    } catch {
      return String(text).slice(0, 500)
    }
  }

  private endpoint(baseUrl: string, path: string) {
    return `${String(baseUrl).replace(/\/+$/, '')}${this.ensurePath(path)}`
  }

  private ensurePath(path: string) {
    return path.startsWith('/') ? path : `/${path}`
  }

  // SSE 流按行拆分；buffer 保留跨 chunk 的不完整行，直到遇到换行符才提交。
  // 兼容 OpenAI 格式（choices[0].delta.content）和部分厂商的非标准字段（data.content）。
  private openAiSseToTextStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = body.getReader()
        let buffer = ''
        let errored = false

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split(/\r?\n/)
            buffer = lines.pop() || ''

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed.startsWith('data:')) continue
              const payload = trimmed.slice(5).trim()
              if (!payload || payload === '[DONE]') continue

              try {
                const data = JSON.parse(payload)
                const content =
                  data.choices?.[0]?.delta?.content ??
                  data.choices?.[0]?.message?.content ??
                  data.content ??
                  ''
                if (content) controller.enqueue(encoder.encode(String(content)))
              } catch {
                controller.enqueue(encoder.encode(payload))
              }
            }
          }
        } catch (error) {
          errored = true
          controller.error(error)
          return
        } finally {
          if (!errored) controller.close()
        }
      },
    })
  }
}
