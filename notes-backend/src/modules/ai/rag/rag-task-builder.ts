import { AiChatOptions } from '../ai-gateway.types'
import { RagEvidence, RagPlan } from './rag.types'

// 一次性 answer 与流式 streamRagAnswer 两条 RAG 路径共用同一份任务选项与提示词，避免后续调优只改一处导致双路径漂移。
export function buildRagAnswerTaskOptions(input: { question: string; allowed: RagEvidence[]; plan: RagPlan; userId: string; runId?: string }): AiChatOptions & { task: 'rag_answer' } {
  const audit: any = { graphName: 'GraphRagAnswerGraph', userId: input.userId }
  if (input.runId) audit.runId = input.runId
  return {
    task: 'rag_answer', reasoningMode: input.plan.reasoningMode, maxTokens: 1800, temperature: 0.2,
    audit,
    system: 'Answer in Chinese. Cite note-supported claims using only [E1] style IDs supplied in context. General knowledge is allowed only when labelled “通用补充”, never as a user-note fact. For user history claims, use only evidence. Do not reveal reasoning.',
    prompt: ['用户问题：' + input.question, '', '证据：', ...input.allowed.map((item, index) => `[E${index + 1}] ${item.noteTitle} | ${item.headingPath.join(' > ')}\n${item.content}`)].join('\n\n'),
  }
}
