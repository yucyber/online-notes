import { Injectable } from '@nestjs/common'
import { AiGatewayClient } from '../ai-gateway.client'
import { KnowledgeBasesService } from '../../knowledge-bases/knowledge-bases.service'
import { ChunkRetrievalService } from '../../semantic/chunk-retrieval.service'
import { RagEvidence, RagPlan, RagTool } from './rag.types'

@Injectable()
export class RagRetrievalService {
  constructor(private readonly chunks: ChunkRetrievalService, private readonly knowledgeBases: KnowledgeBasesService, private readonly gateway: AiGatewayClient) {}

  async retrieve(question: string, userId: string, knowledgeBaseId: string | undefined, plan: RagPlan) {
    const warnings: string[] = []
    const rewrite = await this.rewrite(question, warnings)
    const vectorInput = { query: rewrite.query, knowledgeBaseId, limit: 15 }
    const keywordInput = { ...vectorInput, keywords: rewrite.keywords }
    const candidates: RagEvidence[] = []
    if (plan.tools.includes('keyword')) candidates.push(...(await this.chunks.searchKeywordChunks(keywordInput, userId)).map((item) => this.fromChunk(item, 'keyword')))
    if (plan.tools.includes('chunk_vector')) candidates.push(...(await this.chunks.searchChunks(vectorInput, userId)).map((item) => this.fromChunk(item, 'chunk_vector')))
    if (plan.tools.includes('graph_expand') && knowledgeBaseId) {
      const graph = await this.knowledgeBases.expandGraphEvidence(knowledgeBaseId, userId, candidates.map((item) => item.chunkId))
      candidates.push(...graph.map((item: any) => ({ ...item, excerpt: item.content.slice(0, 700), content: item.content.slice(0, 1200), score: 0.35, source: 'graph_expand' as RagTool })))
    } else if (plan.tools.includes('graph_expand')) warnings.push('未指定知识库，已跳过图谱扩展')
    else warnings.push('本次未使用知识图谱扩展')
    const unique = this.mergeEvidence(candidates).slice(0, 30)
    let rerankApplied = false
    if (plan.tools.includes('rerank') && unique.length > 1) {
      try {
        const ranked = await this.gateway.rerank(question, unique.map((item) => item.content))
        const scoreByIndex = new Map(ranked.map((item) => [item.index, item.score]))
        unique.forEach((item, index) => { item.score = scoreByIndex.get(index) ?? item.score })
        unique.sort((left, right) => right.score - left.score); rerankApplied = true
      } catch { warnings.push('排序服务暂不可用，已使用基础排序') }
    }
    return { evidence: unique.slice(0, 10), warnings, rerankApplied, candidateCount: candidates.length }
  }

  private async rewrite(question: string, warnings: string[]) {
    try {
      const result = await this.gateway.chatTask({ task: 'query_rewrite', responseFormat: { type: 'json_object' }, maxTokens: 256, temperature: 0, system: 'Return JSON only: {"query":"canonical retrieval query","keywords":["at most 3"]}. Preserve user intent.', prompt: question })
      const value = JSON.parse(result.content); const query = String(value?.query || '').trim()
      return { query: query || question, keywords: Array.isArray(value?.keywords) ? value.keywords.slice(0, 3) : [] }
    } catch { warnings.push('检索改写不可用，已使用原问题'); return { query: question, keywords: [] } }
  }

  private fromChunk(item: any, source: RagTool): RagEvidence {
    const content = String(item.content || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
    return { noteId: item.noteId, noteTitle: item.title, chunkId: item.chunkId, headingPath: item.headingPath || [], content, excerpt: content.slice(0, 700), score: Number(item.score || 0), source }
  }

  private mergeEvidence(candidates: RagEvidence[]): RagEvidence[] {
    const byChunkId = new Map<string, RagEvidence>()
    for (const candidate of candidates) {
      const current = byChunkId.get(candidate.chunkId)
      if (!current) {
        byChunkId.set(candidate.chunkId, { ...candidate })
        continue
      }
      const higher = candidate.score > current.score ? candidate : current
      byChunkId.set(candidate.chunkId, {
        ...higher,
        graphPath: candidate.graphPath?.length ? candidate.graphPath : current.graphPath,
      })
    }
    return [...byChunkId.values()]
  }
}
