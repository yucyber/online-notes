export type OrganizerActionType = 'create_knowledge_base' | 'move_note' | 'add_tag' | 'set_category' | 'merge_notes' | 'split_note' | 'rewrite_note'

export interface OrganizerProposalAction {
  actionId: string
  type: OrganizerActionType
  riskLevel: 'low' | 'high'
  reason: string
  noteIds: string[]
  evidenceChunkIds: string[]
  expectedUpdatedAt: Array<{ noteId: string; updatedAt: string }>
  categoryId?: string
  categoryName?: string
  tagId?: string
  tagName?: string
  knowledgeBaseId?: string
  knowledgeBaseName?: string
  targetNoteId?: string
  sourceNoteId?: string
  payload?: Record<string, unknown>
}

export interface OrganizerProposal {
  id: string
  userId: string
  status: 'pending' | 'stale' | 'confirmed'
  revision: number
  summary: string
  modelRunId?: string
  createdAt?: string
  updatedAt?: string
  actions: OrganizerProposalAction[]
}

export interface OrganizerExecutionActionSummary {
  actionId: string
  type: OrganizerActionType
  noteIds: string[]
}

export interface OrganizerExecution {
  id: string
  proposalId: string
  proposalRevision: number
  status: 'executed' | 'undone'
  undoDeadline?: string
  undoneAt?: string
  createdAt?: string
  updatedAt?: string
  actions: OrganizerExecutionActionSummary[]
}
