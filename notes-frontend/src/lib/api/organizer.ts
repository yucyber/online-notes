import api from './client'
import type { OrganizerProposal } from '@/components/organizer/organizer-types'

export const organizerAPI = {
  listProposals: () =>
    api.get<OrganizerProposal[]>('/organizer/proposals').then((res) => res as unknown as OrganizerProposal[]),

  getProposal: (id: string) =>
    api.get<OrganizerProposal>(`/organizer/proposals/${id}`).then((res) => res as unknown as OrganizerProposal),

  refreshStale: (id: string) =>
    api.post<OrganizerProposal>(`/organizer/proposals/${id}/refresh-stale`).then((res) => res as unknown as OrganizerProposal),

  createGlobal: () =>
    api.post<{ generated: boolean; reason?: string; proposal?: OrganizerProposal }>('/organizer/planning/global')
      .then((res) => res as unknown as { generated: boolean; reason?: string; proposal?: OrganizerProposal }),

  createIncremental: (noteId: string) =>
    api.post<{ noteId: string; proposal: OrganizerProposal }>(`/organizer/planning/incremental/${noteId}`)
      .then((res) => res as unknown as { noteId: string; proposal: OrganizerProposal }),
}
