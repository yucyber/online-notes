import { Injectable } from '@nestjs/common'
import { AiGatewayClient } from '../ai-gateway.client'
import { RagCitation, RagPlanSummary } from './rag.types'
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
  constructor(private readonly planner: QueryPlannerService, private readonly retrieval: RagRetrievalService, private readonly gateway: AiGatewayClient) {}

  async streamRagAnswer(input: { question: string; knowledgeBaseId?: string; userId: string; memoryRecall?: MemoryRecallServiceLike }, hooks: RagStreamHooks): Promise<{ route: 'rag'; citations: RagCitation[]; memoryCitations: MemoryCitation[]; warnings: string[]; planSummary: RagPlanSummary; runId?: string }> {
    const { question, knowledgeBaseId, userId, memoryRecall } = input
    await hooks.onStatus('retrieving', '正在检索笔记')
    const plan = await this.planner.plan(question)
    const result = await this.retrieval.retrieve(question, userId, knowledgeBaseId, plan)
    if (result.evidence.length === 0) {
      await hooks.onStatus('answering', '未找到相关片段')
      return { route: 'rag', citations: [], memoryCitations: [], warnings: [...result.warnings, '未找到足够笔记证据'], planSummary: { ...plan, rerankApplied: result.rerankApplied } }
    }
    await hooks.onStatus('answering', `已找到 ${result.evidence.length} 个相关片段`)
    const allowed = result.evidence
    const options = buildRagAnswerTaskOptions({ question, allowed, plan, userId })

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
    const warnings = [...result.warnings]
    if (sanitizer.invalidReferenceFound || memorySanitizer?.invalidReferenceFound) warnings.push('已忽略无效引用')
    if (sanitizer.citations.length === 0 && memoryCitations.length === 0) warnings.push('回答未附带可验证引用')
    return { route: 'rag', citations: sanitizer.citations, memoryCitations, warnings, planSummary: { ...plan, rerankApplied: result.rerankApplied } }
  }
}
