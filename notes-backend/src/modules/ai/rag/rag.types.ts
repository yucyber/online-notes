export type RagIntent = 'lookup' | 'explain' | 'compare' | 'user_history' | 'organize'
export type RagTool = 'keyword' | 'chunk_vector' | 'graph_expand' | 'rerank'

export interface RagPlan {
  intent: RagIntent
  tools: RagTool[]
  reasoningMode: 'off' | 'deep'
  graphHops: 0 | 1
}

export interface RagEvidence {
  noteId: string
  noteTitle: string
  chunkId: string
  headingPath: string[]
  excerpt: string
  content: string
  score: number
  source: RagTool
  graphPath?: string[]
}

export interface RagCitation {
  evidenceId: string
  noteId: string
  noteTitle: string
  chunkId: string
  headingPath: string[]
  excerpt: string
  score?: number
}

export interface RagAnswerResponse {
  answer: string
  citations: RagCitation[]
  planSummary: { intent: RagIntent, tools: RagTool[], graphHops: 0 | 1, rerankApplied: boolean }
  warnings: string[]
  runId?: string
}
