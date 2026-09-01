import type { RagAnswer } from '@/lib/ai-client'

export const ASSISTANT_HISTORY_KEY = 'ai_assistant_history_v1'
const HISTORY_LIMIT = 100

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  route: 'pet' | 'rag'
  result?: RagAnswer
  createdAt: string
}

function normalizeMessage(value: unknown, route?: AssistantMessage['route'], index = 0): AssistantMessage | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AssistantMessage>
  if (!['user', 'assistant'].includes(String(candidate.role)) || typeof candidate.content !== 'string' || !candidate.content.trim()) return null
  const resolvedRoute = candidate.route === 'pet' || candidate.route === 'rag' ? candidate.route : route
  if (!resolvedRoute) return null
  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `migrated-${resolvedRoute}-${index}`,
    role: candidate.role as AssistantMessage['role'],
    content: candidate.content,
    route: resolvedRoute,
    ...(candidate.result && typeof candidate.result === 'object' ? { result: candidate.result } : {}),
    createdAt: typeof candidate.createdAt === 'string' && candidate.createdAt ? candidate.createdAt : new Date(index).toISOString(),
  }
}

function parseMessages(raw: string | null, route?: AssistantMessage['route']): AssistantMessage[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((value, index) => {
      const message = normalizeMessage(value, route, index)
      return message ? [message] : []
    })
  } catch {
    return []
  }
}

export function saveAssistantHistory(storage: Storage, messages: AssistantMessage[]) {
  storage.setItem(ASSISTANT_HISTORY_KEY, JSON.stringify(messages.slice(-HISTORY_LIMIT)))
}

export function loadAssistantHistory(storage: Storage): AssistantMessage[] {
  const current = storage.getItem(ASSISTANT_HISTORY_KEY)
  if (current !== null) return parseMessages(current).slice(-HISTORY_LIMIT)
  const migrated = [
    ...parseMessages(storage.getItem('ai_pet_history'), 'pet'),
    ...parseMessages(storage.getItem('ai_rag_history'), 'rag'),
  ].slice(-HISTORY_LIMIT)
  if (migrated.length > 0) saveAssistantHistory(storage, migrated)
  storage.removeItem('ai_pet_history')
  storage.removeItem('ai_rag_history')
  return migrated
}

const NOTE_INTENT = /(我的笔记|笔记里|之前|当时|踩坑|查找|找到|搜索|哪篇|比较|区别|差异|冲突|矛盾|知识库)/i

export function routeAssistantMessage(content: string, forceNotes: boolean): AssistantMessage['route'] {
  return forceNotes || NOTE_INTENT.test(content) ? 'rag' : 'pet'
}
