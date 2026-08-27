export type AiChatRoute = 'text' | 'reasoning'
export type AiTask =
  | 'note_summary'
  | 'aggregate_summary'
  | 'knowledge_graph'
  | 'organizer_proposal'
  | 'rag_answer'
  | 'query_rewrite'
  | 'query_plan'
  | 'search_hit_explanation'
  | 'writer'
  | 'topic_name'
  | 'pet_chat'
  | 'mindmap'
  | 'mermaid'
  | 'destructive_reorganization'
  | 'conflict_analysis'
  | 'proposal_revision'

export type AiReasoningMode = 'off' | 'auto' | 'deep'
export type AiModelTier = 'economy' | 'standard' | 'deep'
export type AiModelTarget =
  | 'siliconflow_economy'
  | 'siliconflow_standard'
  | 'siliconflow_deep'
  | 'bai_deepseek'
  | 'ar_expert'
export type AiLocalFallback =
  | 'local_summary'
  | 'safe_tool_plan'
  | 'show_chunk'
  | 'local_topic'
  | 'insufficient_evidence'

export interface AiChatOptions {
  task?: AiTask
  reasoningMode?: AiReasoningMode
  route?: AiChatRoute
  system?: string
  prompt: string
  temperature?: number
  maxTokens?: number
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  responseFormat?: { type: 'json_object' }
  allowedNoteIds?: string[]
  audit?: { graphName?: string; userId?: string }
  // 允许 content 为空且 finish_reason=length 时，以更高的 maxTokens 有限重试一次。
  // 用于推理型模型：默认小预算可能被思考过程耗尽导致正文为空。
  retryOnLengthOverflow?: boolean
}

export type AiFallbackType = 'quality' | 'provider'
export type AiFailureReason =
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'timeout'
  | 'empty_content'
  | 'length_exhausted'
  | 'invalid_output'
  | 'rejected'
  | 'unauthorized'
  | 'forbidden'
  | 'cancelled'

export interface AiTaskAttempt {
  task: AiTask
  reasoningMode: AiReasoningMode
  provider: string
  model: string
  durationMs: number
  retryCount: number
  fallbackUsed: boolean
  fallbackType?: AiFallbackType
  fallbackReason?: AiFailureReason
  finishReason?: string
  contentChars: number
  reasoningChars: number
  validationResult: 'valid' | 'invalid'
}

export interface AiTaskResult {
  content: string
  attempt: AiTaskAttempt
}

export interface AiProviderConfig {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
}

export interface AiWorkflowContext {
  userId?: string
}

export interface AiRerankResult {
  index: number
  score: number
  document?: string
}

export interface AiWriterInput {
  prompt?: string
  context: string
  type: 'continue' | 'polish' | 'summary'
}

export interface AiMindmapInput {
  content: any
  scenario?: 'generate' | 'expand' | 'optimize'
}

export interface AiMermaidInput {
  content: string
  availableIcons?: string[]
}

export interface AiKnowledgeGraphInput {
  knowledgeBaseId: string
}

export interface AiPetInput {
  message: string
}
