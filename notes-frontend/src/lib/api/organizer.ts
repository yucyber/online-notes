import api from './client'
import type { OrganizerExecution, OrganizerProposal } from '@/components/organizer/organizer-types'

export const organizerAPI = {
  listProposals: () =>
    api.get<OrganizerProposal[]>('/organizer/proposals').then((res) => res as unknown as OrganizerProposal[]),

  getProposal: (id: string) =>
    api.get<OrganizerProposal>(`/organizer/proposals/${id}`).then((res) => res as unknown as OrganizerProposal),

  refreshStale: (id: string) =>
    api.post<OrganizerProposal>(`/organizer/proposals/${id}/refresh-stale`).then((res) => res as unknown as OrganizerProposal),

  deleteProposal: (id: string) =>
    api.delete<{ ok: boolean }>(`/organizer/proposals/${id}`).then((res) => res as unknown as { ok: boolean }),

  // 小助手整理代理：为当前用户生成全局提案（已有 pending 提案则直接返回）。
  runAgent: () =>
    api.post<{ generated: boolean; reason?: string; proposal?: OrganizerProposal }>('/organizer/agent/run')
      .then((res) => res as unknown as { generated: boolean; reason?: string; proposal?: OrganizerProposal }),

  createGlobal: () =>
    api.post<{ generated: boolean; reason?: string; proposal?: OrganizerProposal }>('/organizer/planning/global')
      .then((res) => res as unknown as { generated: boolean; reason?: string; proposal?: OrganizerProposal }),

  createIncremental: (noteId: string) =>
    api.post<{ noteId: string; generated: boolean; reason?: string; proposal?: OrganizerProposal }>(`/organizer/planning/incremental/${noteId}`)
      .then((res) => res as unknown as { noteId: string; generated: boolean; reason?: string; proposal?: OrganizerProposal }),

  executeProposal: (proposalId: string, actionIds: string[], requestId?: string) =>
    api.post<OrganizerExecution>(`/organizer/proposals/${proposalId}/execute`, { actionIds, requestId })
      .then((res) => res as unknown as OrganizerExecution),

  listExecutions: () =>
    api.get<OrganizerExecution[]>('/organizer/executions').then((res) => res as unknown as OrganizerExecution[]),

  undoExecution: (executionId: string, requestId?: string) =>
    api.post<{ ok: boolean; conflicts?: Array<{ noteId: string; message: string }>; execution?: OrganizerExecution }>(`/organizer/executions/${executionId}/undo`, { requestId })
      .then((res) => res as unknown as { ok: boolean; conflicts?: Array<{ noteId: string; message: string }>; execution?: OrganizerExecution }),
}
