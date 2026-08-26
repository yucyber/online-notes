import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common'
import { AiGatewayClient } from './ai-gateway.client'
import { AiChatRoute, AiMermaidInput, AiMindmapInput, AiPetInput, AiWorkflowContext, AiWriterInput } from './ai-gateway.types'
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
  private readonly summarySegmentChars = 3000

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
      const summaries = await Promise.all(segments.map((segment) => this.summarizeChunk(segment, targetChars)))
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
  // maxTokens 是推理模型 thinking+content 的共享预算，给足 2000 避免思考过程耗尽正文；
  // 若仍因 length 溢出导致正文为空，让 gateway 以更高预算重试一次。
  private async summarizeChunk(text: string, targetChars: number): Promise<string> {
    return this.gateway.chat({
      route: 'text',
      system: 'You summarize notes for a knowledge management app. Return only the summary.',
      prompt: `Summarize the following note in Chinese within ${targetChars} Chinese characters. Keep the core facts and avoid prefaces.\n\n${text}`,
      maxTokens: 2000,
      temperature: 0.7,
      retryOnLengthOverflow: true,
    })
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
    return { summary: await this.withAiRun({ graphName: 'AggregateSummaryGraph', route: 'reasoning', context }, () => graph.run(notes)) }
  }

  async buildKnowledgeGraphProposal(knowledgeBaseId: string, context?: AiWorkflowContext) {
    const id = String(knowledgeBaseId || '').trim()
    const userId = context?.userId
    if (!id) throw new BadRequestException('knowledgeBaseId is required.')
    if (!userId) throw new BadRequestException('Authenticated user is required.')
    if (!this.knowledgeBases) throw new Error('Knowledge base service is not available.')
    const graph = this.knowledgeGraphBuildGraph || new KnowledgeGraphBuildGraph(this.gateway)
    const notes = await this.knowledgeBases.listGraphNotes(id, userId)
    return this.withAiRun({ graphName: 'KnowledgeGraphBuildGraph', route: 'text', context }, () => graph.run({ knowledgeBaseId: id, notes }))
  }

  async streamWriter(input: AiWriterInput, context?: AiWorkflowContext): Promise<ReadableStream<Uint8Array>> {
    return this.withAiRun({ graphName: 'WriterGraph', route: 'text', context }, () => this.gateway.streamChat({ route: 'text', system: 'You are a focused writing assistant. Return only the requested content.', prompt: buildWriterPrompt(input), maxTokens: 1200, temperature: 0.5 }))
  }

  async generateMindmap(input: AiMindmapInput, context?: AiWorkflowContext) {
    const content = input.content
    const scenario = input.scenario || 'generate'
    const normalized = await this.withAiRun({ graphName: 'MindmapGenerationGraph', route: 'reasoning', context }, async () => {
      const answer = await this.gateway.chat({ route: 'reasoning', system: 'You generate valid JSON for mind map data. Return JSON only.', prompt: buildMindmapPrompt(scenario, content), maxTokens: 2000, temperature: 0.2 })
      return this.normalizeMindmapOrRepair(answer, scenario, content)
    })
    return { content: normalized }
  }

  async generateMermaid(input: AiMermaidInput, context?: AiWorkflowContext) {
    const code = await this.withAiRun({ graphName: 'MermaidGenerationGraph', route: 'reasoning', context }, async () => {
      const answer = await this.gateway.chat({ route: 'reasoning', system: 'You generate Mermaid diagrams. Return Mermaid code only.', prompt: buildMermaidPrompt(input.content, input.availableIcons || []), maxTokens: 1800, temperature: 0.2 })
      return this.normalizeMermaidOrRepair(answer, input.content, input.availableIcons || [])
    })
    return { content: code }
  }

  async chatPet(input: AiPetInput, context?: AiWorkflowContext): Promise<ReadableStream<Uint8Array>> {
    return this.withAiRun({ graphName: 'PetChatGraph', route: 'text', context }, () => this.gateway.streamChat({ route: 'text', system: 'You are a friendly assistant inside an online notes app. Be concise, useful, and warm.', prompt: input.message || 'Hello', maxTokens: 400, temperature: 0.6, reasoningEffort: 'none' }))
  }

  async generateEmbedding(text: string): Promise<number[]> { return this.gateway.embedding(text) }

  async generateTopicName(context: string): Promise<string> {
    try {
      const answer = await this.gateway.chat({ route: 'text', system: 'You name clusters of notes. Return one short topic phrase only.', prompt: ['Based on the following notes, return one short topic phrase in the same language as the notes.', 'Use 2-6 words. Do not include quotes, punctuation, or explanation.', '', context.slice(0, 3000)].join('\n'), maxTokens: 64, temperature: 0.2 })
      return cleanTopicName(answer)
    } catch (error: any) { this.logger.warn(`Topic naming failed, using fallback: ${error.message}`); return 'General Topic' }
  }

  // 先尝试直接规范化；只有解析失败时才发起第二次 AI 修复请求，避免不必要的额外 token 消耗。
  private async normalizeMindmapOrRepair(answer: string, scenario: string, content: any) {
    const normalized = normalizeMindmapAnswer(answer)
    if (normalized) return normalized
    const repaired = await this.gateway.chat({ route: 'reasoning', system: 'You repair invalid mind map JSON. Return JSON only.', prompt: buildMindmapRepairPrompt(answer, scenario, content), maxTokens: 2000, temperature: 0 })
    const repairedNormalized = normalizeMindmapAnswer(repaired)
    if (!repairedNormalized) throw new Error('AI mind map output is invalid after repair.')
    return repairedNormalized
  }

  private async normalizeMermaidOrRepair(answer: string, content: string, availableIcons: string[]) {
    const normalized = normalizeMermaidCode(answer)
    if (normalized) return normalized
    const repaired = await this.gateway.chat({ route: 'reasoning', system: 'You repair invalid Mermaid code. Return Mermaid code only.', prompt: buildMermaidRepairPrompt(answer, content, availableIcons), maxTokens: 1800, temperature: 0 })
    const repairedNormalized = normalizeMermaidCode(repaired)
    if (!repairedNormalized) throw new Error('AI Mermaid output is invalid after repair.')
    return repairedNormalized
  }

  // withAiRun 封装 AI 调用的审计生命周期；审计失败不中断 AI 操作本身。
  private async withAiRun<T>(input: { graphName: string; route: AiChatRoute; context?: AiWorkflowContext }, execute: () => Promise<T>): Promise<T> {
    const run = await this.startRun(input)
    try { const result = await execute(); await this.succeedRun(run?.runId); return result }
    catch (error) { await this.failRun(run?.runId, error); throw error }
  }

  private async startRun(input: { graphName: string; route: AiChatRoute; context?: AiWorkflowContext }) {
    if (!this.aiRuns) return undefined
    const route = this.describeRoute(input.route)
    try { return await this.aiRuns.start({ graphName: input.graphName, userId: input.context?.userId, provider: route.provider, model: route.model }) }
    catch (error: any) { this.logger.warn(`AI run audit start failed for ${input.graphName}: ${error.message}`); return undefined }
  }

  private async succeedRun(runId?: string) {
    if (!runId || !this.aiRuns) return
    try { await this.aiRuns.succeed(runId) } catch (error: any) { this.logger.warn(`AI run audit success update failed for ${runId}: ${error.message}`) }
  }

  private async failRun(runId: string | undefined, error: unknown) {
    if (!runId || !this.aiRuns) return
    try { await this.aiRuns.fail(runId, error) } catch (auditError: any) { this.logger.warn(`AI run audit failure update failed for ${runId}: ${auditError.message}`) }
  }

  private describeRoute(route: AiChatRoute): { provider?: string; model?: string } {
    try { return this.gateway.describeChatRoute(route) }
    catch (error: any) { this.logger.warn(`AI route description failed for ${route}: ${error.message}`); return {} }
  }
}
