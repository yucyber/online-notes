'use client';

export type ConversationListItem = { id: string; title: string; status: 'active' | 'archived' | 'deleted'; lastMessageAt?: string; messageCount: number; updatedAt: string };

export type ChunkNeighbor = { chunkId: string; headingPath: string[]; excerpt: string };

export type ChunkEvidence = {
  noteId: string; noteTitle: string; chunkId: string; headingPath: string[];
  content: string; noteUpdatedAt: string; relocated: boolean;
  neighbors: { before: ChunkNeighbor[]; after: ChunkNeighbor[] };
};

export async function fetchConversations(): Promise<ConversationListItem[]> {
  const response = await fetch('/api/assistant/conversations', { cache: 'no-store' });
  if (!response.ok) throw new Error('会话列表加载失败');
  const payload = await response.json();
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchChunkEvidence(noteId: string, chunkId: string, opts?: { before?: number; after?: number; heading?: string[] }): Promise<ChunkEvidence> {
  const query = new URLSearchParams();
  if (opts?.before !== undefined) query.set('before', String(opts.before));
  if (opts?.after !== undefined) query.set('after', String(opts.after));
  if (opts?.heading?.length) query.set('heading', opts.heading.join('>'));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}/chunks/${encodeURIComponent(chunkId)}/evidence${suffix}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('证据加载失败');
  const payload = await response.json();
  return (payload?.data && typeof payload.data === 'object') ? payload.data : payload;
}

// ===== 管理 API（合并自计划 2 Task 8，2026-09-02 用户裁决：一次建成）=====

export type AssistantSearchResult = {
  conversations: Array<{ id: string; title: string; updatedAt: string }>;
  messages: Array<{ conversationId: string; messageId: string; seq: number; role: string; snippet: string; updatedAt: string }>;
};

export async function renameConversation(id: string, title: string): Promise<void> {
  const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
  });
  if (!response.ok) throw new Error('重命名失败');
}

export async function setConversationStatus(id: string, action: 'archive' | 'unarchive' | 'delete'): Promise<void> {
  const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
  if (!response.ok) throw new Error('操作失败');
}

export async function searchAssistant(query: string): Promise<AssistantSearchResult> {
  const response = await fetch(`/api/assistant/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('搜索失败');
  const payload = await response.json();
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return { conversations: Array.isArray(data?.conversations) ? data.conversations : [], messages: Array.isArray(data?.messages) ? data.messages : [] };
}

export async function branchConversation(id: string, fromSeq: number): Promise<{ id: string }> {
  const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}/branch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromSeq }),
  });
  if (!response.ok) throw new Error('分支失败');
  const payload = await response.json();
  return (payload?.data && typeof payload.data === 'object') ? payload.data : payload;
}

export async function exportConversation(id: string): Promise<void> {
  const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}/export`, { cache: 'no-store' });
  if (!response.ok) throw new Error('导出失败');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `assistant-${id}.jsonl`; // 代理不透传 Content-Disposition，JS anchor 自设文件名
  anchor.click();
  URL.revokeObjectURL(url);
}
