import api from './client'
import type { DashboardOverview, Tag } from '@/types'

// 仪表盘相关 API
export const dashboardAPI = {
  getOverview: () =>
    api.get<DashboardOverview>('/dashboard/overview').then(res => res as unknown as DashboardOverview),
  getTopics: () =>
    api.get<{ topics: any[] }>('/v1/semantic/topics', { timeout: 60000 }).then(res => {
      const data = res as unknown as any;
      return data.data?.topics || [];
    }),
  convertTopicToTag: (topicName: string, noteIds: string[]) =>
    api.post('/v1/semantic/topics/convert', { topicName, noteIds }).then(res => res as unknown as { tag: Tag; updated: number }),
}
