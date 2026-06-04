import { Injectable, Logger } from '@nestjs/common'
import { AiService } from '../ai/ai.service'

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name)

  constructor(private readonly aiService: AiService) {}

  async generateEmbedding(text: string): Promise<number[]> {
    if (!text) return []

    try {
      const embedding = await this.aiService.generateEmbedding(text)
      return Array.isArray(embedding) ? embedding : []
    } catch (error: any) {
      this.logger.error(`Embedding generation failed: ${error.message}`)
      return []
    }
  }
}
