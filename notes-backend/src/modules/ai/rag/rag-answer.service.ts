import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common'
import { AiWorkflowContext } from '../ai-gateway.types'
import { AiGatewayClient } from '../ai-gateway.client'
import { AiRunService } from '../ai-run.service'
import { AiRunTiming } from '../ai-run-timing'
import { QueryPlannerService } from './query-planner.service'
import { RagAnswerResponse } from './rag.types'
import { RagRetrievalService } from './rag-retrieval.service'
import { sanitizeCitationText } from './rag-citation-sanitize'

@Injectable()
export class RagAnswerService {
  private readonly logger = new Logger(RagAnswerService.name)
  constructor(private readonly planner: QueryPlannerService, private readonly retrieval: RagRetrievalService, private readonly gateway: AiGatewayClient, @Optional() private readonly runs?: AiRunService) {}

  async answer(question: string, knowledgeBaseId: string | undefined, context: AiWorkflowContext = {}): Promise<RagAnswerResponse> {
    if (!context.userId) throw new BadRequestException('Authenticated user is required.')
    const runId = context.runId || await this.startRun(context.userId)
    const timing = new AiRunTiming(async (stage) => {
      if (!runId || !this.runs) return
      try { await this.runs.addStage(runId, stage) }
      catch { this.logger.warn('AI run stage audit update failed') }
    })
    try {
      const plan = await timing.measure('context_prepare', () => this.planner.plan(question))
      const result = await timing.measure('context_prepare', () => this.retrieval.retrieve(question, context.userId!, knowledgeBaseId, plan))
      await this.runs?.mergeMetrics(runId!, { inputChars: question.length, candidateChunks: result.candidateCount })
      if (result.evidence.length === 0) {
        await this.runs?.mergeMetrics(runId!, { outputChars: 12 })
        await this.runs?.succeed(runId!)
        return { answer: '笔记中未找到相关记录。', citations: [], planSummary: { ...plan, rerankApplied: result.rerankApplied }, warnings: [...result.warnings, '未找到足够笔记证据'], runId }
      }
      const allowed = result.evidence
      const response = await timing.measure('response', () => this.gateway.chatTask({
        task: 'rag_answer', reasoningMode: plan.reasoningMode, maxTokens: 1800, temperature: 0.2,
        audit: { graphName: 'GraphRagAnswerGraph', userId: context.userId, runId },
        system: 'Answer in Chinese. Cite note-supported claims using only [E1] style IDs supplied in context. General knowledge is allowed only when labelled “通用补充”, never as a user-note fact. For user history claims, use only evidence. Do not reveal reasoning.',
        prompt: ['用户问题：' + question, '', '证据：', ...allowed.map((item, index) => `[E${index + 1}] ${item.noteTitle} | ${item.headingPath.join(' > ')}\n${item.content}`)].join('\n\n'),
      }))
      const sanitized = sanitizeCitationText(response.content, allowed)
      const citations = sanitized.citations
      const warnings = [...result.warnings]
      if (sanitized.invalidReferenceFound) warnings.push('已忽略无效引用')
      if (citations.length === 0) warnings.push('回答未附带可验证引用')
      await this.runs?.mergeMetrics(runId!, { outputChars: sanitized.answer.length, candidateNotes: new Set(result.evidence.map((item) => item.noteId)).size, candidateChunks: result.evidence.length })
      await this.runs?.succeed(runId!, response.attempt)
      return { answer: sanitized.answer, citations, planSummary: { ...plan, rerankApplied: result.rerankApplied }, warnings, runId }
    } catch (error) {
      if (runId) await this.runs?.fail(runId, error).catch(() => undefined)
      throw error
    }
  }

  private async startRun(userId: string) {
    if (!this.runs) return undefined
    const route = this.gateway.describeTaskRoute?.('rag_answer')
    return (await this.runs.start({ graphName: 'GraphRagAnswerGraph', task: 'rag_answer', userId, provider: route?.provider, model: route?.model })).runId
  }
}
