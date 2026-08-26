import { HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AiChatOptions, AiChatRoute, AiProviderConfig, AiRerankResult } from './ai-gateway.types'

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

@Injectable()
export class AiGatewayClient {
  private readonly fetchImpl: FetchLike

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject('AI_GATEWAY_FETCH')
    fetchImpl?: FetchLike,
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
    const provider = this.resolveChatProvider(options.route || 'text')

    // 推理型模型可能把小预算的 maxTokens 全部耗在思考过程上，导致 content 为空。
    // 当 content 为空且 finish_reason=length 时，用更高的预算有限重试一次，尽量让模型产出正文。
    const data = await this.chatOnce(options, provider)
    const content = this.extractChatContent(data)
    if (content) return String(content).trim()

    if (options.retryOnLengthOverflow && this.isLengthOverflow(data)) {
      const retried = await this.chatOnce(options, provider, this.retryMaxTokens(options.maxTokens))
      const retriedContent = this.extractChatContent(retried)
      if (retriedContent) return String(retriedContent).trim()
    }

    throw new Error(`${provider.provider} chat returned no assistant content. body=${this.describeChatBody(data, provider)}`)
  }

  // 单次非流式 chat 请求，返回解析后的响应体。
  private async chatOnce(options: AiChatOptions, provider: AiProviderConfig, maxTokensOverride?: number): Promise<any> {
    const response = await this.postJson(
      this.endpoint(provider.baseUrl, '/chat/completions'),
      provider.apiKey,
      this.chatBody(provider, { ...options, maxTokens: maxTokensOverride ?? options.maxTokens }, { stream: false }),
      `${provider.provider} chat`,
    )
    return response.json().catch(() => ({}))
  }

  // content 为空时是否由预算耗尽（finish_reason=length）导致，用于判断是否值得重试。
  private isLengthOverflow(data: any): boolean {
    return data.choices?.[0]?.finish_reason === 'length'
  }

  // 重试预算在原值基础上翻倍，但不超过一个安全上限，避免单次摘要请求无界放大成本。
  private retryMaxTokens(original?: number): number {
    const base = original ?? 1024
    return Math.min(Math.max(base * 2, 2048), 8000)
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
    const provider = this.resolveChatProvider(options.route || 'text')
    const response = await this.postJson(this.endpoint(provider.baseUrl, '/chat/completions'), provider.apiKey, this.chatBody(provider, options, {
      stream: true,
    }), `${provider.provider} stream chat`)

    if (!response.body) throw new Error(`${provider.provider} stream chat returned no body`)
    return this.openAiSseToTextStream(response.body)
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

  private resolveChatProvider(route: AiChatRoute): AiProviderConfig {
    const provider = this.resolveChatProviderName(route)
    return this.readProviderConfig(provider, this.chatProviderKeys(route, provider))
  }

  // text 与 reasoning 默认共用 SenseNova，避免本地聊天依赖另一套失效凭据；仍保留显式切换 provider 的能力。
  private resolveChatProviderName(route: AiChatRoute): string {
    return String(
      this.configService.get<string>(route === 'reasoning' ? 'AI_REASONING_PROVIDER' : 'AI_TEXT_PROVIDER') ||
      'sensenova',
    ).toLowerCase()
  }

  private chatProviderKeys(route: AiChatRoute, provider: string) {
    if (provider === 'mimo') {
      return {
        apiKey: 'MIMO_API_KEY',
        baseUrl: 'MIMO_BASE_URL',
        model: 'MIMO_MODEL',
      }
    }

    if (provider === 'sensenova') {
      return {
        apiKey: 'SENSENOVA_API_KEY',
        baseUrl: 'SENSENOVA_BASE_URL',
        model: route === 'reasoning' ? 'SENSENOVA_REASONING_MODEL' : 'SENSENOVA_TEXT_MODEL',
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
    // reasoning_effort 仅对支持它的 provider 发送；SenseNova 6.8 官方未声明该参数，避免发送未声明字段。
    if (options.reasoningEffort && this.supportsReasoningEffort(provider.provider)) {
      body.reasoning_effort = options.reasoningEffort
    }
    return body
  }

  // 已知声明 reasoning_effort 参数的 provider 才允许发送；其余（如 SenseNova）不发送，避免依赖未声明行为。
  private supportsReasoningEffort(provider: string): boolean {
    return provider !== 'sensenova'
  }

  private async postJson(url: string, apiKey: string, body: any, label: string) {
    const retryableStatuses = new Set([429, 502, 503, 504])

    for (let attempt = 0; attempt <= 2; attempt += 1) {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (response.ok) return response

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
