import { AiTask } from './ai-gateway.types'
import { normalizeMermaidCode, normalizeMindmapAnswer } from './ai-content'

export type AiValidationFailureReason = 'empty_content' | 'invalid_output'

export interface AiOutputValidation {
  valid: boolean
  reason?: AiValidationFailureReason
}

const ORGANIZER_ACTIONS = new Set([
  'create_knowledge_base',
  'move_note',
  'add_tag',
  'set_category',
  'merge_notes',
  'split_note',
  'rewrite_note',
])

export function validateAiOutput(
  task: AiTask,
  content: string,
  context: { allowedNoteIds?: string[] } = {},
): AiOutputValidation {
  if (!String(content || '').trim()) return { valid: false, reason: 'empty_content' }
  if (task === 'knowledge_graph') return validateKnowledgeGraph(content)
  if (task === 'mindmap') {
    return normalizeMindmapAnswer(content) ? { valid: true } : { valid: false, reason: 'invalid_output' }
  }
  if (task === 'mermaid') {
    return normalizeMermaidCode(content) ? { valid: true } : { valid: false, reason: 'invalid_output' }
  }
  if (task === 'organizer_proposal' || task === 'destructive_reorganization' || task === 'proposal_revision') {
    return validateOrganizerProposal(content, context.allowedNoteIds)
  }
  return { valid: true }
}

function validateKnowledgeGraph(content: string): AiOutputValidation {
  const value = parseObject(content)
  return value && Array.isArray(value.nodes) && Array.isArray(value.edges)
    ? { valid: true }
    : { valid: false, reason: 'invalid_output' }
}

function validateOrganizerProposal(content: string, allowedNoteIds: string[] = []): AiOutputValidation {
  const value = parseObject(content)
  if (!value || !Array.isArray(value.actions)) return { valid: false, reason: 'invalid_output' }
  const allowed = new Set(allowedNoteIds)
  const valid = value.actions.every((action: any) => {
    if (!ORGANIZER_ACTIONS.has(String(action?.type || ''))) return false
    const noteIds = Array.isArray(action?.noteIds) ? action.noteIds.map(String) : []
    return allowed.size === 0 || noteIds.every((noteId: string) => allowed.has(noteId))
  })
  return valid ? { valid: true } : { valid: false, reason: 'invalid_output' }
}

function parseObject(content: string): any | undefined {
  try {
    const value = JSON.parse(content)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}
