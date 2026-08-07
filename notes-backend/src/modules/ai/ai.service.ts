import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common'
import { AiGatewayClient } from './ai-gateway.client'
import { AiChatRoute, AiMermaidInput, AiMindmapInput, AiPetInput, AiWorkflowContext, AiWriterInput } from './ai-gateway.types'
import { AiRunService } from './ai-run.service'
import { AggregateSummaryGraph } from './graphs/aggregate-summary.graph'
import { KnowledgeGraphBuildGraph } from './graphs/knowledge-graph-build.graph'
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service'
import { buildMermaidPrompt, buildMermaidRepairPrompt, buildMindmapPrompt, buildMindmapRepairPrompt, buildWriterPrompt, cleanText, cleanTopicName, normalizeMermaidCode, normalizeMindmapAnswer, truncateContent } from './ai-content'

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

  async generateSummary(content: string): Promise<string> {
    const cleanContent = cleanText(content).slice(0, 3000)
    if (!cleanContent) return ''
    try {
      return await this.gateway.chat({ route: 'text', system: 'You summarize notes for a knowledge management app. Return only the summary.', prompt: `Summarize the following note in Chinese within 120 Chinese characters. Keep the core facts and avoid prefaces.\n\n${cleanContent}`, maxTokens: 256, temperature: 0.2 })
    } catch (error: any) {
      this.logger.warn(`Summary generation failed, using fallback: ${error.message}`)
      return truncateContent(cleanContent)
    }
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
    return this.withAiRun({ graphName: 'KnowledgeGraphBuildGraph', route: 'reasoning', context }, () => graph.run({ knowledgeBaseId: id, notes }))
  }

  async generateWriterText(input: AiWriterInput, context?: AiWorkflowContext): Promise<string> {
    return this.withAiRun({ graphName: 'WriterGraph', route: 'text', context }, () => this.gateway.chat({ route: 'text', system: 'You are a focused writing assistant. Return only the requested content.', prompt: buildWriterPrompt(input), maxTokens: 1200, temperature: 0.5 }))
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
    return this.withAiRun({ graphName: 'PetChatGraph', route: 'text', context }, () => this.gateway.streamChat({ route: 'text', system: 'You are a friendly assistant inside an online notes app. Be concise, useful, and warm.', prompt: input.message || 'Hello', maxTokens: 1200, temperature: 0.6 }))
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
