import { Injectable, Logger } from '@nestjs/common'
import { AiGatewayClient } from '../ai-gateway.client'
import { RagCitation, RagEvidence, RagPlanSummary } from './rag.types'
import { RagAgentService } from './rag-agent.service'
import { QueryPlannerService } from './query-planner.service'
import { RagRetrievalService } from './rag-retrieval.service'
import { createRagCitationSanitizer, createMemoryCitationSanitizer, MemoryCitation } from './rag-citation-sanitize'
import { buildRagAnswerTaskOptions } from './rag-task-builder'
import type { MemoryRecallServiceLike } from '../../assistant/assistant.constants'

export type RagStreamHooks = {
  onStatus(stage: 'retrieving' | 'answering', message: string): void | Promise<void>
  onDelta(text: string): void | Promise<void>
}

// 双引用体系分隔句：认知引用只认 [M1]，笔记证据只认 [E1]，避免模型把两类依据混用。
const MEMORY_EVIDENCE_SEPARATION = 'Cite confirmed user memories using only [M1] IDs; cite note evidence using only [E1] IDs. Keep the two systems separate.'

@Injectable()
export class RagStreamService {
  private readonly logger = new Logger(RagStreamService.name)

  constructor(private readonly planner: QueryPlannerService, private readonly retrieval: RagRetrievalService, private readonly gateway: AiGatewayClient, private readonly agent: RagAgentService) {}

  async streamRagAnswer(input: { question: string; knowledgeBaseId?: string; userId: string; memoryRecall?: MemoryRecallServiceLike }, hooks: RagStreamHooks): Promise<{ route: 'rag'; citations: RagCitation[]; memoryCitations: MemoryCitation[]; warnings: string[]; planSummary: RagPlanSummary; runId?: string }> {
    const { question, knowledgeBaseId, userId, memoryRecall } = input

    // 检索阶段：优先 agent loop（模型自主决定查什么、查几轮），任何异常降级回固定管线。
    // 取消（CANCELLED）不是故障，直接向外传播，不能触发降级重查。
    let allowed: RagEvidence[]
    let planSummary: RagPlanSummary
    let warnings: string[]
    let runId: string | undefined
    try {
      const agent = await this.agent.collect(
        { question, userId, knowledgeBaseId },
        { onStatus: async (message) => { await hooks.onStatus('retrieving', message) } },
      )
      allowed = agent.evidence
      planSummary = agent.planSummary
      warnings = agent.warnings
      runId = agent.runId
    } catch (error) {
      if ((error as any)?.message === 'CANCELLED') throw error
      this.logger.warn(`agent 检索失败，降级固定管线: ${error?.message ?? error}`)
      await hooks.onStatus('retrieving', '正在检索笔记')
      const plan = await this.planner.plan(question)
      const result = await this.retrieval.retrieve(question, userId, knowledgeBaseId, plan)
      allowed = result.evidence
      planSummary = { ...plan, rerankApplied: result.rerankApplied }
      warnings = result.warnings
    }

    if (allowed.length === 0) {
      await hooks.onStatus('answering', '未找到相关片段')
      return { route: 'rag', citations: [], memoryCitations: [], warnings: [...warnings, '未找到足够笔记证据'], planSummary, runId }
    }
    await hooks.onStatus('answering', `已找到 ${allowed.length} 个相关片段`)
    // agent 路径没有 RagPlan；作答的 reasoningMode 由任务策略强制，这里补齐 plan 形状即可复用同一模板。
    const options = buildRagAnswerTaskOptions({ question, allowed, plan: { ...planSummary, reasoningMode: 'off' }, userId, runId })

    // 认知召回属增强上下文：recall 异常降级为空认知节，不阻断笔记回答（与上下文组装失败降级同一惯例）。
    let recalled: Array<{ label: string; text: string }> = []
    if (memoryRecall) {
      try {
        recalled = await memoryRecall.recall(userId, question, knowledgeBaseId ? { knowledgeBaseId } : {})
      } catch {
        recalled = []
      }
    }
    // 按位置编号 M1..Mn，prompt 认知节与 M sanitizer 共用同一份编号，模型 [Mx] 才能落到 recalled 条目。
    const memoryItems = recalled.map((m, index) => ({ id: `M${index + 1}`, label: m.label, text: m.text }))
    const memorySanitizer = memoryItems.length > 0 ? createMemoryCitationSanitizer(memoryItems) : undefined
    if (memoryItems.length > 0) {
      options.prompt = ['[已确认认知]', ...memoryItems.map((m) => `[${m.id}] ${m.label} | ${m.text}`), '', options.prompt].join('\n')
      options.system = `${options.system}\n${MEMORY_EVIDENCE_SEPARATION}`
    }

    const stream = await this.gateway.streamTask(options)
    const sanitizer = createRagCitationSanitizer(allowed)
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          // E 与 M 标记不相交：先过 E 清洗再喂 M，两套引用各自校验互不干扰。
          let safe = sanitizer.push(decoder.decode(value, { stream: true }))
          if (memorySanitizer) safe = memorySanitizer.push(safe)
          if (safe) await hooks.onDelta(safe)
        }
      }
    } finally {
      // 流结束时补一次无参 decode，冲刷解码缓冲区内残留的多字节字符尾部（与 ai-gateway 的 auditTextStream 同一惯例）
      const tailText = decoder.decode()
      let safe = tailText ? sanitizer.push(tailText) : ''
      if (memorySanitizer) safe = memorySanitizer.push(safe)
      const eRest = sanitizer.flush()
      const tail = memorySanitizer ? memorySanitizer.push(eRest) + memorySanitizer.flush() : eRest
      if (safe + tail) await hooks.onDelta(safe + tail)
    }
    const memoryCitations = memorySanitizer ? memorySanitizer.memoryCitations : []
    // 引用类告警并入检索阶段 warnings（来自 agent loop 或降级管线）
    if (sanitizer.invalidReferenceFound || memorySanitizer?.invalidReferenceFound) warnings.push('已忽略无效引用')
    if (sanitizer.citations.length === 0 && memoryCitations.length === 0) warnings.push('回答未附带可验证引用')
    return { route: 'rag', citations: sanitizer.citations, memoryCitations, warnings, planSummary, runId }
  }
}
