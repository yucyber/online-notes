import { Inject, Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AiChatOptions, AiChatRoute, AiProviderConfig, AiRerankResult } from './ai-gateway.types'

type FetchLike = (url: string, init?: any) => Promise<any>

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
    const response = await this.postJson(this.endpoint(provider.baseUrl, '/chat/completions'), provider.apiKey, {
      model: provider.model,
      messages: this.buildMessages(options),
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.3,
    })

    await this.assertOk(response, `${provider.provider} chat`)
    const data = await response.json().catch(() => ({}))
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error(`${provider.provider} chat returned no assistant content`)
    return String(content).trim()
  }

  async streamChat(options: AiChatOptions): Promise<ReadableStream<Uint8Array>> {
    const provider = this.resolveChatProvider(options.route || 'text')
    const response = await this.postJson(this.endpoint(provider.baseUrl, '/chat/completions'), provider.apiKey, {
      model: provider.model,
      messages: this.buildMessages(options),
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.5,
      stream: true,
    })

    await this.assertOk(response, `${provider.provider} stream chat`)
    if (!response.body) throw new Error(`${provider.provider} stream chat returned no body`)
    return this.openAiSseToTextStream(response.body)
  }

  async embedding(text: string): Promise<number[]> {
    if (!text) return []
    const provider = this.resolveEmbeddingProvider()
    const response = await this.postJson(this.endpoint(provider.baseUrl, '/embeddings'), provider.apiKey, {
      model: provider.model,
      input: text,
    })

    await this.assertOk(response, `${provider.provider} embedding`)
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
    })

    await this.assertOk(response, `${provider.provider} rerank`)
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
        model: 'SENSENOVA_TEXT_MODEL',
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

  private async postJson(url: string, apiKey: string, body: any) {
    return this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  private async assertOk(response: any, label: string) {
    if (response.ok) return
    const error = await this.readProviderError(response)
    throw new Error(`${label} request failed: HTTP ${response.status}${error ? ` ${error}` : ''}`)
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
