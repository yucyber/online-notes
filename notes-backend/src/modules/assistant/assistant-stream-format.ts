import { RagCitation, RagPlanSummary } from '../ai/rag/rag.types'
import { MemoryCitation } from '../ai/rag/rag-citation-sanitize'

export type AssistantStreamEvent =
  | { event: 'started'; data: { conversationId: string; userMessageId: string; assistantMessageId: string; requestId: string } }
  | { event: 'status'; data: { stage: 'routing' | 'retrieving' | 'answering'; message: string } }
  | { event: 'delta'; data: { text: string } }
  // 重连快照：刷新/重新订阅同一 requestId 时，attach 先补发一条 resume 事件携带当前已生成全量 content，
  // 前端用它覆盖气泡（而非 append），之后续收 delta 事件追加，保证无缝衔接、无缺失、无重复。
  | { event: 'resume'; data: { assistantMessageId: string; content: string } }
  | { event: 'complete'; data: { messageId: string; route: 'pet' | 'rag'; citations: RagCitation[]; memoryCitations?: MemoryCitation[]; warnings: string[]; planSummary?: RagPlanSummary; runId?: string } }
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
