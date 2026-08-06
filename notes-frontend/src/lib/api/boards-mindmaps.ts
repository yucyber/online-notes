import api from './client'

// 画板/思维导图（轻量接口，后端 /api/v1 前缀）
export const boardsAPI = {
  create: (title: string, noteId?: string) => api.post('/v1/boards', { title, noteId }).then(res => res as unknown as { id: string; title: string }),
  get: (id: string) => api.get(`/v1/boards/${id}`).then(res => res as unknown as { id: string; title: string }),
}

export const mindmapsAPI = {
  create: (title: string, noteId?: string) => api.post('/v1/mindmaps', { title, noteId }).then(res => res as unknown as { id: string; title: string }),
  get: (id: string) => api.get(`/v1/mindmaps/${id}`).then(res => res as unknown as { id: string; title: string }),
}


export const createMindMap = async (data: { _id?: string; title: string; content?: any }) => {
  return api.post('/v1/mindmaps', data) as Promise<any>;
};

export const saveMindMap = async (id: string, data: any) => {
  return api.put(`/v1/mindmaps/${id}`, { content: data }) as Promise<any>;
};

export const getMindMap = async (id: string) => {
  return api.get(`/v1/mindmaps/${id}`) as Promise<any>;
};

export const createBoard = async (data: { _id?: string; title: string; content?: any }) => {
  return api.post('/v1/boards', data) as Promise<any>;
};

export const saveBoard = async (id: string, data: any) => {
  return api.put(`/v1/boards/${id}`, { content: data }) as Promise<any>;
};

export const getBoard = async (id: string) => {
  return api.get(`/v1/boards/${id}`) as Promise<any>;
};
