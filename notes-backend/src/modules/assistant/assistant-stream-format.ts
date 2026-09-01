import { RagCitation, RagPlanSummary } from '../ai/rag/rag.types'

export type AssistantStreamEvent =
  | { event: 'started'; data: { conversationId: string; userMessageId: string; assistantMessageId: string; requestId: string } }
  | { event: 'status'; data: { stage: 'routing' | 'retrieving' | 'answering'; message: string } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'complete'; data: { messageId: string; route: 'pet' | 'rag'; citations: RagCitation[]; warnings: string[]; planSummary?: RagPlanSummary; runId?: string } }
  | { event: 'cancelled'; data: { messageId: string; text: string; reason: 'user_stopped' } }
  | { event: 'error'; data: { code: string; message: string; retryable: boolean } }

export function formatSseEvent(event: AssistantStreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`
}

export function parseSseEvent(block: string): AssistantStreamEvent | null {
  const lines = block.split('\n')
  let eventName = ''
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (!eventName || dataLines.length === 0) return null
  return { event: eventName as AssistantStreamEvent['event'], data: JSON.parse(dataLines.join('\n')) }
}
