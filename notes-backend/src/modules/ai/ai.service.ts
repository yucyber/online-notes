import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common'
import { AiGatewayClient } from './ai-gateway.client'
import { AiMermaidInput, AiMindmapInput, AiPetInput, AiWorkflowContext, AiWriterInput } from './ai-gateway.types'
import { AiRunService } from './ai-run.service'
import { AggregateSummaryGraph } from './graphs/aggregate-summary.graph'
import { KnowledgeGraphBuildGraph } from './graphs/knowledge-graph-build.graph'
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service'
import { buildMermaidPrompt, buildMermaidRepairPrompt, buildMindmapPrompt, buildMindmapRepairPrompt, buildWriterPrompt, cleanText, cleanTopicName, normalizeMermaidCode, normalizeMindmapAnswer, truncateContent } from './ai-content'

export type SummaryGenerationResult = {
  summary: string
  source: 'ai' | 'passthrough' | 'fallback'
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  constructor(
    private readonly gateway: AiGatewayClient,
    private readonly knowledgeBases: KnowledgeBasesService,
    @Optional() private readonly aiRuns?: AiRunService,
    @Optional() private readonly aggregateSummaryGraph?: AggregateSummaryGraph,
    @Optional() private readonly knowledgeGraphBuildGraph?: KnowledgeGraphBuildGraph,
  ) {}

  // 单段摘要的上限字符数；超过则分段各自摘要再合并，保证长笔记后半部分也参与主题向量。
  private readonly summarySegmentChars = 1600

  // 低于该长度的正文视为"内容较少"：全文信息量少，直接作为 summary，不调用 AI。
  private readonly minSummaryChars = 120

  // 动态计算单次摘要的目标字数：短正文压到约 40%，长正文封顶 120 字。
  private summaryTargetChars(textLength: number): number {
    return Math.min(120, Math.max(30, Math.floor(textLength * 0.4)))
  }

  async generateSummary(content: string): Promise<string> {
    return (await this.generateSummaryResult(content)).summary
  }

  async generateSummaryResult(content: string): Promise<SummaryGenerationResult> {
    const cleanContent = cleanText(content)
    if (!cleanContent) return { summary: '', source: 'passthrough' }
    // 极短正文直接返回全文作为摘要；信息已接近完整，AI 提炼无增益。
    if (cleanContent.length <= this.minSummaryChars) {
      return { summary: cleanContent, source: 'passthrough' }
    }
    // 目标长度基于整篇正文长度计算，分段时每段与最终合并都沿用同一目标，避免拼接后超长。
    const targetChars = this.summaryTargetChars(cleanContent.length)

    try {
      // 短内容走单次摘要，避免不必要的额外请求。
      if (cleanContent.length <= this.summarySegmentChars) {
        return { summary: await this.summarizeChunk(cleanContent, targetChars), source: 'ai' }
      }

      const segments = this.splitSegments(cleanContent, this.summarySegmentChars)
      const summaries: string[] = []
      // Workspace 可能限制瞬时并发；顺序摘要避免同一篇长笔记的多个分段互相触发 429。
      for (const segment of segments) {
        summaries.push(await this.summarizeChunk(segment, targetChars))
      }
      // 先合并各段摘要，再让 AI 提炼一份最终摘要，避免拼接文本语义割裂。
      const merged = summaries.filter(Boolean).join('\n')
      if (!merged) return { summary: '', source: 'fallback' }
      return { summary: await this.summarizeChunk(`[以下为长笔记各部分的摘要]\n${merged}`, targetChars), source: 'ai' }
    } catch (error: any) {
      this.logger.warn(`Summary generation failed, using fallback: ${error.message}`)
      return { summary: truncateContent(cleanContent), source: 'fallback' }
    }
  }

  // 单个 AI 摘要调用，失败时抛出由外层统一降级，这里不吞异常。
  private async summarizeChunk(text: string, targetChars: number): Promise<string> {
    return (await this.gateway.chatTask({
      task: 'note_summary',
      system: 'You summarize notes for a knowledge management app. Return only the summary.',
      prompt: `Summarize the following note in Chinese within ${targetChars} Chinese characters. Keep the core facts and avoid prefaces.\n\n${text}`,
      // 摘要目标最多 120 个汉字，限制声明预算可避免 provider 按过大的输出上限拒绝请求。
      maxTokens: 256,
      temperature: 0.2,
      retryOnLengthOverflow: true,
    })).content
  }

  // 按句子边界尽量切成长度接近但不超过 limit 的分段；避免从句子中间硬切导致摘要信息丢失。
  private splitSegments(text: string, limit: number): string[] {
    const segments: string[] = []
    let rest = text
    while (rest.length > limit) {
      const head = rest.slice(0, limit)
      const cutAt = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('.\n'))
      const split = cutAt > limit * 0.5 ? cutAt + 1 : limit
      segments.push(rest.slice(0, split))
      rest = rest.slice(split).trim()
    }
    if (rest) segments.push(rest)
    return segments
  }

  async generateAggregateSummary(notes: any[], context?: AiWorkflowContext): Promise<{ summary: string }> {
    if (!Array.isArray(notes) || notes.length === 0) return { summary: '' }
    const graph = this.aggregateSummaryGraph || new AggregateSummaryGraph(this.gateway)
    return { summary: await graph.run(notes, context) }
  }

  async buildKnowledgeGraphProposal(knowledgeBaseId: string, context?: AiWorkflowContext) {
    const id = String(knowledgeBaseId || '').trim()
    const userId = context?.userId
    if (!id) throw new BadRequestException('knowledgeBaseId is required.')
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    if (!this.knowledgeBases) throw new Error('Knowledge base service is not available.')
    const graph = this.knowledgeGraphBuildGraph || new KnowledgeGraphBuildGraph(this.gateway)
    const notes = await this.knowledgeBases.listGraphNotes(id, userId)
    return graph.run({ knowledgeBaseId: id, notes }, context)
  }

  async streamWriter(input: AiWriterInput, context?: AiWorkflowContext): Promise<ReadableStream<Uint8Array>> {
    return this.gateway.streamTask({ task: 'writer', system: 'You are a focused writing assistant. Return only the requested content.', prompt: buildWriterPrompt(input), maxTokens: 1200, temperature: 0.5, audit: { graphName: 'WriterGraph', userId: context?.userId } })
  }

  async generateMindmap(input: AiMindmapInput, context?: AiWorkflowContext) {
    const content = input.content
    const scenario = input.scenario || 'generate'
    const normalized = await (async () => {
      const answer = (await this.gateway.chatTask({ task: 'mindmap', system: 'You generate valid JSON for mind map data. Return JSON only.', prompt: buildMindmapPrompt(scenario, content), maxTokens: 2000, temperature: 0.2, audit: { graphName: 'MindmapGenerationGraph', userId: context?.userId } })).content
      return this.normalizeMindmapOrRepair(answer, scenario, content)
    })()
    return { content: normalized }
  }

  async generateMermaid(input: AiMermaidInput, context?: AiWorkflowContext) {
    const code = await (async () => {
      const answer = (await this.gateway.chatTask({ task: 'mermaid', system: 'You generate Mermaid diagrams. Return Mermaid code only.', prompt: buildMermaidPrompt(input.content, input.availableIcons || []), maxTokens: 4096, temperature: 0.2, audit: { graphName: 'MermaidGenerationGraph', userId: context?.userId } })).content
      return this.normalizeMermaidOrRepair(answer, input.content, input.availableIcons || [])
    })()
    return { content: code }
  }

  async chatPet(input: AiPetInput, context?: AiWorkflowContext): Promise<ReadableStream<Uint8Array>> {
    return this.gateway.streamTask({ task: 'pet_chat', system: 'You are a friendly assistant inside an online notes app. Be concise, useful, and warm.', prompt: input.message || 'Hello', maxTokens: 400, temperature: 0.6, audit: { graphName: 'PetChatGraph', userId: context?.userId } })
  }

  async generateEmbedding(text: string): Promise<number[]> { return this.gateway.embedding(text) }

  async generateTopicName(context: string): Promise<string> {
    try {
      const answer = (await this.gateway.chatTask({ task: 'topic_name', system: 'You name clusters of notes. Return one short topic phrase only.', prompt: ['Based on the following notes, return one short topic phrase in the same language as the notes.', 'Use 2-6 words. Do not include quotes, punctuation, or explanation.', '', context.slice(0, 3000)].join('\n'), maxTokens: 64, temperature: 0.2 })).content
      return cleanTopicName(answer)
    } catch (error: any) { this.logger.warn(`Topic naming failed, using fallback: ${error.message}`); return 'General Topic' }
  }

  // 先尝试直接规范化；只有解析失败时才发起第二次 AI 修复请求，避免不必要的额外 token 消耗。
  private async normalizeMindmapOrRepair(answer: string, scenario: string, content: any) {
    const normalized = normalizeMindmapAnswer(answer)
    if (normalized) return normalized
    const repaired = (await this.gateway.chatTask({ task: 'mindmap', system: 'You repair invalid mind map JSON. Return JSON only.', prompt: buildMindmapRepairPrompt(answer, scenario, content), maxTokens: 2000, temperature: 0 })).content
    const repairedNormalized = normalizeMindmapAnswer(repaired)
    if (!repairedNormalized) throw new Error('AI mind map output is invalid after repair.')
    return repairedNormalized
  }

  private async normalizeMermaidOrRepair(answer: string, content: string, availableIcons: string[]) {
    const normalized = normalizeMermaidCode(answer)
    if (normalized) return normalized
    const repaired = (await this.gateway.chatTask({ task: 'mermaid', system: 'You repair invalid Mermaid code. Return Mermaid code only.', prompt: buildMermaidRepairPrompt(answer, content, availableIcons), maxTokens: 4096, temperature: 0 })).content
    const repairedNormalized = normalizeMermaidCode(repaired)
    if (!repairedNormalized) throw new Error('AI Mermaid output is invalid after repair.')
    return repairedNormalized
  }

}
