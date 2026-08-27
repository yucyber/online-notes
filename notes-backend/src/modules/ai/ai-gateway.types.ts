export type AiChatRoute = 'text' | 'reasoning'
export type AiTask = 'note_summary'

export interface AiChatOptions {
  task?: AiTask
  route?: AiChatRoute
  system?: string
  prompt: string
  temperature?: number
  maxTokens?: number
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  responseFormat?: { type: 'json_object' }
  // 允许 content 为空且 finish_reason=length 时，以更高的 maxTokens 有限重试一次。
  // 用于推理型模型：默认小预算可能被思考过程耗尽导致正文为空。
  retryOnLengthOverflow?: boolean
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
