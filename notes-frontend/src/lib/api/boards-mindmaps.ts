import api from './client'

type BoardCreateInput = { _id?: string; title: string; content?: any; noteId?: string }
type MindMapCreateInput = { _id?: string; title: string; content?: any; noteId: string }
type MindMapUpdateInput = { title?: string; content?: any }

/** Single surface for boards (create / get / save). */
export const boardsAPI = {
  create: (data: BoardCreateInput) =>
    api.post('/v1/boards', data).then((res) => res as unknown as { id: string; title: string }),
  get: (id: string) =>
    api.get(`/v1/boards/${id}`).then((res) => res as unknown as any),
  save: (id: string, content: any) =>
    api.put(`/v1/boards/${id}`, { content }).then((res) => res as unknown as any),
}

/** Single surface for mindmaps (create / get / save). */
export const mindmapsAPI = {
  create: (data: MindMapCreateInput) =>
    api.post('/v1/mindmaps', data).then((res) => res as unknown as { id: string; title: string }),
  get: (id: string) =>
    api.get(`/v1/mindmaps/${id}`).then((res) => res as unknown as any),
  update: (id: string, data: MindMapUpdateInput) =>
    api.put(`/v1/mindmaps/${id}`, data).then((res) => res as unknown as any),
  save: (id: string, content: any) =>
    api.put(`/v1/mindmaps/${id}`, { content }).then((res) => res as unknown as any),
}
