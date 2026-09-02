import {
  AiLocalFallback,
  AiModelTarget,
  AiModelTier,
  AiReasoningMode,
  AiTask,
} from './ai-gateway.types'

export interface AiModelPolicy {
  tier: AiModelTier
  reasoningMode: AiReasoningMode
  maxTokens: number
  primary: AiModelTarget
  qualityFallback?: AiModelTarget | AiLocalFallback
  providerFallback?: AiModelTarget
}

export const AI_TASKS = [
  'note_summary',
  'aggregate_summary',
  'knowledge_graph',
  'organizer_proposal',
  'rag_answer',
  'query_rewrite',
  'query_plan',
  'search_hit_explanation',
  'writer',
  'topic_name',
  'pet_chat',
  'mindmap',
  'mermaid',
  'destructive_reorganization',
  'conflict_analysis',
  'proposal_revision',
  'context_summary',
  'memory_extract',
] as const satisfies readonly AiTask[]

const policies = {
  note_summary: policy('standard', 'off', 256, 'siliconflow_standard', 'local_summary', 'bai_deepseek'),
  aggregate_summary: policy('standard', 'off', 1800, 'siliconflow_standard', 'siliconflow_deep', 'bai_deepseek'),
  knowledge_graph: policy('standard', 'off', 2400, 'siliconflow_standard', 'siliconflow_deep', 'bai_deepseek'),
  organizer_proposal: policy('standard', 'off', 2400, 'siliconflow_standard', 'siliconflow_deep', 'bai_deepseek'),
  rag_answer: policy('standard', 'off', 1800, 'siliconflow_standard', 'insufficient_evidence', 'bai_deepseek'),
  query_rewrite: policy('economy', 'off', 256, 'siliconflow_economy', 'siliconflow_standard', 'bai_deepseek'),
  query_plan: policy('economy', 'off', 256, 'siliconflow_economy', 'safe_tool_plan'),
  search_hit_explanation: policy('economy', 'off', 256, 'siliconflow_economy', 'show_chunk'),
  writer: policy('standard', 'off', 1200, 'siliconflow_standard', undefined, 'bai_deepseek'),
  topic_name: policy('economy', 'off', 64, 'siliconflow_economy', 'local_topic'),
  pet_chat: policy('economy', 'off', 400, 'siliconflow_economy', undefined, 'bai_deepseek'),
  mindmap: policy('standard', 'off', 2000, 'siliconflow_standard', 'siliconflow_deep', 'bai_deepseek'),
  mermaid: policy('deep', 'deep', 4096, 'siliconflow_deep', 'ar_expert', 'bai_deepseek'),
  destructive_reorganization: policy('deep', 'deep', 6000, 'siliconflow_deep', 'ar_expert', 'bai_deepseek'),
  conflict_analysis: policy('deep', 'deep', 5000, 'siliconflow_deep', 'ar_expert', 'bai_deepseek'),
  proposal_revision: policy('deep', 'deep', 5000, 'siliconflow_deep', 'ar_expert', 'bai_deepseek'),
  context_summary: policy('standard', 'off', 1024, 'siliconflow_standard', 'siliconflow_deep', 'bai_deepseek'),
  // 记忆提取：economy 档文本模型即可（extractor 自带 temperature 0 / json_object），质量降级到 standard，供应商降级同其他任务。
  memory_extract: policy('economy', 'off', 512, 'siliconflow_economy', 'siliconflow_standard', 'bai_deepseek'),
} satisfies Record<AiTask, AiModelPolicy>

function policy(
  tier: AiModelTier,
  reasoningMode: AiReasoningMode,
  maxTokens: number,
  primary: AiModelTarget,
  qualityFallback?: AiModelTarget | AiLocalFallback,
  providerFallback?: AiModelTarget,
): AiModelPolicy {
  return { tier, reasoningMode, maxTokens, primary, qualityFallback, providerFallback }
}

export function resolveAiModelPolicy(task: AiTask): AiModelPolicy {
  return policies[task]
}
