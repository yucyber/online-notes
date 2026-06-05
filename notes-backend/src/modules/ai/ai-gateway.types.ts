export type AiChatRoute = 'text' | 'reasoning'

export interface AiChatOptions {
  route?: AiChatRoute
  system?: string
  prompt: string
  temperature?: number
  maxTokens?: number
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

export interface AiPetInput {
  message: string
  conversationId?: string
}
