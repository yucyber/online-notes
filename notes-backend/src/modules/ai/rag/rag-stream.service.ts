import { Injectable } from '@nestjs/common'
import { AiGatewayClient } from '../ai-gateway.client'
import { RagCitation, RagPlanSummary } from './rag.types'
import { QueryPlannerService } from './query-planner.service'
import { RagRetrievalService } from './rag-retrieval.service'
import { createRagCitationSanitizer } from './rag-citation-sanitize'

export type RagStreamHooks = {
  onStatus(stage: 'retrieving' | 'answering', message: string): void | Promise<void>
  onDelta(text: string): void | Promise<void>
}

@Injectable()
export class RagStreamService {
  constructor(private readonly planner: QueryPlannerService, private readonly retrieval: RagRetrievalService, private readonly gateway: AiGatewayClient) {}

  async streamRagAnswer(input: { question: string; knowledgeBaseId?: string; userId: string }, hooks: RagStreamHooks): Promise<{ route: 'rag'; citations: RagCitation[]; warnings: string[]; planSummary: RagPlanSummary; runId?: string }> {
    const { question, knowledgeBaseId, userId } = input
    await hooks.onStatus('retrieving', '正在检索笔记')
    const plan = await this.planner.plan(question)
    const result = await this.retrieval.retrieve(question, userId, knowledgeBaseId, plan)
    if (result.evidence.length === 0) {
      await hooks.onStatus('answering', '未找到相关片段')
      return { route: 'rag', citations: [], warnings: [...result.warnings, '未找到足够笔记证据'], planSummary: { ...plan, rerankApplied: result.rerankApplied } }
    }
    await hooks.onStatus('answering', `已找到 ${result.evidence.length} 个相关片段`)
    const allowed = result.evidence
    const stream = await this.gateway.streamTask({
      task: 'rag_answer', reasoningMode: plan.reasoningMode, maxTokens: 1800, temperature: 0.2,
      audit: { graphName: 'GraphRagAnswerGraph', userId },
      system: 'Answer in Chinese. Cite note-supported claims using only [E1] style IDs supplied in context. General knowledge is allowed only when labelled “通用补充”, never as a user-note fact. For user history claims, use only evidence. Do not reveal reasoning.',
      prompt: ['用户问题：' + question, '', '证据：', ...allowed.map((item, index) => `[E${index + 1}] ${item.noteTitle} | ${item.headingPath.join(' > ')}\n${item.content}`)].join('\n\n'),
    })
    const sanitizer = createRagCitationSanitizer(allowed)
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          const safe = sanitizer.push(decoder.decode(value, { stream: true }))
          if (safe) await hooks.onDelta(safe)
        }
      }
    } finally {
      const tail = sanitizer.flush()
      if (tail) await hooks.onDelta(tail)
    }
    const warnings = [...result.warnings]
    if (sanitizer.invalidReferenceFound) warnings.push('已忽略无效引用')
    if (sanitizer.citations.length === 0) warnings.push('回答未附带可验证引用')
    return { route: 'rag', citations: sanitizer.citations, warnings, planSummary: { ...plan, rerankApplied: result.rerankApplied } }
  }
}
