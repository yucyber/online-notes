import api from './client'
import type { KnowledgeBase, KnowledgeBaseNoteLink, KnowledgeGraphProposal } from '@/types'

export type KnowledgeGraphEvidence = {
  noteId: string
  noteTitle: string
  chunkId: string
  headingPath: string[]
  excerpt: string
}

export type KnowledgeGraphEvidenceResult = {
  compatibility: 'evidence_available' | 'evidence_unavailable' | 'legacy_graph_without_evidence'
  items: KnowledgeGraphEvidence[]
}

export const knowledgeBasesAPI = {
  getAll: () =>
    api.get<KnowledgeBase[]>('/knowledge-bases').then(res => res as unknown as KnowledgeBase[]),

  create: (payload: { name: string; description?: string }) =>
    api.post<KnowledgeBase>('/knowledge-bases', payload).then(res => res as unknown as KnowledgeBase),

  getNotes: (id: string) =>
    api.get<KnowledgeBaseNoteLink[]>(`/knowledge-bases/${id}/notes`).then(res => res as unknown as KnowledgeBaseNoteLink[]),

  addNote: (id: string, noteId: string) =>
    api.post<KnowledgeBaseNoteLink>(`/knowledge-bases/${id}/notes`, { noteId }).then(res => res as unknown as KnowledgeBaseNoteLink),

  removeNote: (id: string, noteId: string) =>
    api.delete(`/knowledge-bases/${id}/notes/${noteId}`).then(res => res as unknown as { ok: boolean }),

  buildGraphProposal: (id: string) =>
    api.post<KnowledgeGraphProposal>('/ai/knowledge-graph/proposal', { knowledgeBaseId: id }, { timeout: 60000 })
      .then(res => res as unknown as KnowledgeGraphProposal),

  getGraph: (id: string) =>
    api.get<KnowledgeGraphProposal>(`/knowledge-bases/${id}/graph`).then(res => res as unknown as KnowledgeGraphProposal),

  saveGraph: (id: string, payload: Pick<KnowledgeGraphProposal, 'nodes' | 'edges'>) =>
    api.put<KnowledgeGraphProposal>(`/knowledge-bases/${id}/graph`, payload).then(res => res as unknown as KnowledgeGraphProposal),

  getNodeEvidence: (id: string, nodeId: string) =>
    api.get<KnowledgeGraphEvidenceResult>(`/knowledge-bases/${id}/graph/nodes/${encodeURIComponent(nodeId)}/evidence`)
      .then(res => res as unknown as KnowledgeGraphEvidenceResult),

  getEdgeEvidence: (id: string, edgeId: string) =>
    api.get<KnowledgeGraphEvidenceResult>(`/knowledge-bases/${id}/graph/edges/${encodeURIComponent(edgeId)}/evidence`)
      .then(res => res as unknown as KnowledgeGraphEvidenceResult),
}
