import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common'
import { AiCapacityDeferredError } from '../ai/ai-provider-capacity.service'
import { AiService } from '../ai/ai.service'

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name)

  constructor(@Inject(forwardRef(() => AiService)) private readonly aiService: AiService) {}

  async generateEmbedding(text: string): Promise<number[]> {
    if (!text) return []

    try {
      const embedding = await this.aiService.generateEmbedding(text)
      return Array.isArray(embedding) ? embedding : []
    } catch (error: any) {
      // 容量延迟错误必须向上抛：派生 worker 会转成 Bull 延迟重试；吞掉会导致 chunk 永久缺失。
      if (error instanceof AiCapacityDeferredError) throw error
      this.logger.error(`Embedding generation failed: ${error.message}`)
      return []
    }
  }
}
