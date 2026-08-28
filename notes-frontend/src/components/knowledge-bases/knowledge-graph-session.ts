import type { KnowledgeGraphNodeType } from '@/types'

export interface KnowledgeGraphSessionState {
  query: string
  visibleTypes: KnowledgeGraphNodeType[]
  viewport: { x: number; y: number; zoom: number } | null
  positions: Record<string, { x: number; y: number }>
}

export type KnowledgeGraphSessions = Record<string, KnowledgeGraphSessionState>

export function createKnowledgeGraphSession(): KnowledgeGraphSessionState {
  return {
    query: '',
    visibleTypes: ['concept', 'entity', 'topic', 'claim'],
    viewport: null,
    positions: {},
  }
}

export function updateKnowledgeGraphSession(
  sessions: KnowledgeGraphSessions,
  knowledgeBaseId: string,
  patch: Partial<KnowledgeGraphSessionState>,
): KnowledgeGraphSessions {
  return {
    ...sessions,
    [knowledgeBaseId]: { ...createKnowledgeGraphSession(), ...sessions[knowledgeBaseId], ...patch },
  }
}
