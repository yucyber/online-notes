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
  | 'context_summary'
  | 'memory_extract'

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

export type AiWorkflowAudit = {
  graphName: string
  userId?: string
  runId?: string
}

// OpenAI 兼容的 function calling 工具定义，原样透传给 provider。
export interface AiToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

// 模型发起的一次 tool call；arguments 是原始 JSON 字符串，由调用方自行解析校验。
export interface AiToolCall {
  id: string
  name: string
  arguments: string
}

// agent loop 的多轮消息：需要回填 assistant(tool_calls) 与 tool 执行结果。
export type AiChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: AiToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

// chatToolRound 的返回：content 与 toolCalls 可同时存在（部分实现边给正文边发起调用）。
export interface AiToolRoundResult {
  content: string
  toolCalls: AiToolCall[]
  finishReason?: string
}

export interface AiChatOptions {
  task?: AiTask
  reasoningMode?: AiReasoningMode
  route?: AiChatRoute
  system?: string
  // 多轮消息路径（messages）下可省略；单轮路径必填，缺失时 chatBody 直接抛错。
  prompt?: string
  temperature?: number
  maxTokens?: number
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  responseFormat?: { type: 'json_object' }
  allowedNoteIds?: string[]
  audit?: AiWorkflowAudit
  // 允许 content 为空且 finish_reason=length 时，以更高的 maxTokens 有限重试一次。
  // 用于推理型模型：默认小预算可能被思考过程耗尽导致正文为空。
  retryOnLengthOverflow?: boolean
  // 原生 tool calling：带 tools 的请求模型可在响应中返回 tool_calls（配合 chatToolRound 使用）。
  tools?: AiToolDefinition[]
  // 多轮消息（agent loop 回填 tool 结果）；提供时忽略 system/prompt 的单轮组装。
  messages?: AiChatMessage[]
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
  runId?: string
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
