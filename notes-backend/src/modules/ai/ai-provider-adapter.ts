import { AiReasoningMode } from './ai-gateway.types'

interface ProviderOptionsInput {
  provider: string
  model: string
  reasoningMode: AiReasoningMode
}

export function buildProviderOptions(input: ProviderOptionsInput): Record<string, unknown> {
  if (input.provider !== 'siliconflow') return {}

  if (input.model.startsWith('Qwen/')) {
    if (input.reasoningMode === 'off') return { enable_thinking: false }
    if (input.reasoningMode === 'deep') return { enable_thinking: true }
  }

  if (input.model === 'deepseek-ai/DeepSeek-V4-Flash' && input.reasoningMode === 'deep') {
    return { enable_thinking: true }
  }

  return {}
}
