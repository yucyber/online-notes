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

// ===== 认知记忆（阶段四 Task 7）：候选 / 长期记忆 / 冲突 / 会话设置 =====

export type MemoryKind = 'decision' | 'preference' | 'fact' | 'hypothesis' | 'open_question' | 'constraint' | 'lesson';

export type MemoryScope = { type: 'global' | 'knowledge_base' | 'note' | 'conversation'; id?: string };

export type MemoryEvidence = { type: string; messageId?: string; noteId?: string; chunkId?: string; excerpt: string };

export type MemoryCandidateView = {
  id: string; kind: MemoryKind; subject: string; statement: string;
  scope: MemoryScope; confidence: number; evidence: MemoryEvidence[]; createdAt: string;
};

export type MemoryView = {
  id: string; kind: MemoryKind; subject: string; statement: string; scope: MemoryScope;
  status: 'confirmed' | 'superseded'; evidenceStatus: 'ok' | 'stale';
  relation?: { type: string; targetMemoryId: string };
  validFrom?: string; validTo?: string; supersededById?: string; confirmedAt?: string; updatedAt: string;
};

// 与后端 MEMORY_KINDS 对应的展示文案；未知 kind 回退为原文
export const MEMORY_KIND_LABELS: Record<string, string> = {
  decision: '决策', preference: '偏好', fact: '事实', hypothesis: '假设',
  open_question: '待确认问题', constraint: '约束', lesson: '经验',
};

// kind 枚举顺序（文案单一来源为 MEMORY_KIND_LABELS；徽标/表单下拉共用，避免组件内重复映射）
export const MEMORY_KIND_ORDER: MemoryKind[] = ['decision', 'preference', 'fact', 'hypothesis', 'open_question', 'constraint', 'lesson'];

export const MEMORY_KIND_OPTIONS: Array<{ value: MemoryKind; label: string }> = MEMORY_KIND_ORDER.map((kind) => ({
  value: kind,
  label: MEMORY_KIND_LABELS[kind] ?? kind,
}));

export const MEMORY_SCOPE_LABELS: Record<string, string> = {
  global: '全局', knowledge_base: '知识库', note: '笔记', conversation: '会话',
};

export function memoryKindLabel(kind: string): string {
  return MEMORY_KIND_LABELS[kind] ?? kind;
}

export function memoryScopeLabel(scope: MemoryScope): string {
  const base = MEMORY_SCOPE_LABELS[scope.type] ?? scope.type;
  return scope.id ? `${base} · ${scope.id}` : base;
}

export type MemoryConfirmConflict = { memoryId: string; subject: string; statement: string };

export type MemoryResolveAction =
  | { type: 'supersede'; targetMemoryId: string }
  | { type: 'keep_both' }
  | { type: 'reject_memory' };

function unwrapList<T>(payload: any): T[] {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  if (Array.isArray(data?.items)) return data.items as T[];
  if (Array.isArray(data)) return data as T[];
  return [];
}

export async function fetchMemoryCandidates(): Promise<MemoryCandidateView[]> {
  const response = await fetch('/api/assistant/memories/candidates?status=pending', { cache: 'no-store' });
  if (!response.ok) throw new Error('认知候选加载失败');
  return unwrapList<MemoryCandidateView>(await response.json());
}

export async function confirmMemoryCandidate(
  id: string,
  edits?: Partial<{ kind: MemoryKind; subject: string; statement: string; scope: MemoryScope; validFrom: string }>,
): Promise<{ memoryId: string; conflict?: MemoryConfirmConflict }> {
  const response = await fetch(`/api/assistant/memories/candidates/${encodeURIComponent(id)}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edits: edits ?? {} }),
  });
  if (!response.ok) throw new Error('候选确认失败');
  const payload = await response.json();
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return { memoryId: String(data?.memoryId ?? ''), conflict: data?.conflict };
}

export async function rejectMemoryCandidate(id: string, reason: string): Promise<void> {
  const response = await fetch(`/api/assistant/memories/candidates/${encodeURIComponent(id)}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason ?? '' }),
  });
  if (!response.ok) throw new Error('候选拒绝失败');
}

export async function batchConfirmMemoryCandidates(
  ids: string[], kind: MemoryKind, scope: MemoryScope,
): Promise<{ confirmed: number; conflicts: number }> {
  const response = await fetch('/api/assistant/memories/candidates/batch-confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, kind, scope }),
  });
  if (!response.ok) throw new Error('批量确认失败');
  const payload = await response.json();
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return { confirmed: Number(data?.confirmed ?? 0), conflicts: Number(data?.conflicts ?? 0) };
}

export async function fetchMemories(includeSuperseded?: boolean): Promise<MemoryView[]> {
  const query = includeSuperseded ? '?includeSuperseded=1' : '';
  const response = await fetch(`/api/assistant/memories${query}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('认知列表加载失败');
  return unwrapList<MemoryView>(await response.json());
}

export async function resolveMemoryConflict(id: string, action: MemoryResolveAction): Promise<{ status: string }> {
  const response = await fetch(`/api/assistant/memories/${encodeURIComponent(id)}/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
  });
  if (!response.ok) throw new Error('冲突解决失败');
  const payload = await response.json();
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return { status: String(data?.status ?? '') };
}

export async function deleteMemory(id: string): Promise<void> {
  const response = await fetch(`/api/assistant/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('认知删除失败');
}

export async function refreshMemoryEvidence(id: string): Promise<{ evidenceStatus: 'ok' | 'stale'; reviewCreated: boolean }> {
  const response = await fetch(`/api/assistant/memories/${encodeURIComponent(id)}/refresh-evidence`, { method: 'POST' });
  if (!response.ok) throw new Error('证据刷新失败');
  const payload = await response.json();
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return {
    evidenceStatus: data?.evidenceStatus === 'stale' ? 'stale' : 'ok',
    reviewCreated: Boolean(data?.reviewCreated),
  };
}

export type ConversationMemorySettings = { memoryEnabled?: boolean; temporary?: boolean };

export async function updateConversationSettings(id: string, settings: ConversationMemorySettings): Promise<void> {
  const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}/settings`, {
    // 后端 PATCH conversations/:id/settings 用 @Body('settings') 取参，body 需 { settings } 包裹
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }),
  });
  if (!response.ok) throw new Error('会话设置更新失败');
}
