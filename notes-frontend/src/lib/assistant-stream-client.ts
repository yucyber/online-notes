'use client';

export type AssistantRoute = 'pet' | 'rag';

export type RagCitation = { evidenceId: string; noteId: string; noteTitle: string; chunkId: string; headingPath: string[]; excerpt: string; score?: number };

// 认知召回引用：model 回答中以 [M1] 标记，与笔记引用 [E1]（RagCitation）严格分离
export type MemoryCitation = { marker: string; memoryId: string; text: string };

export type RagPlanSummary = { intent: string; tools: string[]; graphHops: 0 | 1; rerankApplied: boolean };

export type AssistantMessageView = {
  id: string; conversationId: string; seq: number; role: 'user' | 'assistant'; route: AssistantRoute;
  content: string; status: 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled';
  requestId?: string; retryOfMessageId?: string; citations: RagCitation[]; warnings: string[];
  // 可选：历史消息/complete 事件携带的已确认认知引用（阶段一/二解析器缺省为空数组）
  memoryCitations?: MemoryCitation[];
  tokenUsage?: { input: number; output: number };
  createdAt: string; completedAt?: string;
};

export type AssistantStreamEvents = {
  onStarted?(data: { conversationId: string; userMessageId: string; assistantMessageId: string; requestId: string }): void;
  onStatus?(stage: 'routing' | 'retrieving' | 'answering', message: string): void;
  onDelta?(text: string): void;
  // 重连快照：刷新后用同 requestId 重新发起请求，若后端仍在生成则触发此回调；
  // content 为当前全量已生成内容，前端应覆盖（而非追加）气泡内容，后续 onDelta 再追加。
  onResume?(data: { assistantMessageId: string; content: string }): void;
  onComplete?(data: { messageId: string; route: AssistantRoute; citations: RagCitation[]; warnings: string[]; planSummary?: RagPlanSummary; runId?: string; memoryCitations?: MemoryCitation[] }): void;
  onCancelled?(data: { messageId: string; text: string; reason: string }): void;
  onError?(code: string, message: string, retryable: boolean): void;
};

type RawEvent = { event: string; data: any };

function parseBlock(block: string): RawEvent | null {
  let eventName = '';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!eventName || dataLines.length === 0) return null;
  try { return { event: eventName, data: JSON.parse(dataLines.join('\n')) }; } catch { return null; }
}

export async function streamAssistantReply(
  input: { conversationId?: string; requestId: string; question: string; knowledgeBaseId?: string; forceRoute?: 'pet' | 'rag' },
  events: AssistantStreamEvents,
  signal?: AbortSignal,
): Promise<void> {
  // 注意：/api/assistant/chat 与 cancel 端点不得携带 Idempotency-Key（后端 IdempotencyInterceptor 会做响应级去重，
  // 生成服务已原生实现 (userId, requestId) 幂等），因此这里用原生 fetch，不走可能附加幂等头的 API 封装。
  let response: Response;
  try {
    response = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  } catch (error: any) {
    // signal 在请求未 resolve 时已 abort：fetch 直接 reject AbortError，同样静默结束（与读取阶段一致）
    if (error?.name === 'AbortError') return;
    throw error;
  }
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const payload = await response.json();
      detail = payload?.error || payload?.message || detail;
    } catch { /* keep statusText */ }
    throw new Error(detail);
  }
  if (!response.body) throw new Error('AI service stream unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        const parsed = parseBlock(block);
        if (!parsed) continue;
        switch (parsed.event) {
          case 'started': events.onStarted?.(parsed.data); break;
          case 'status': events.onStatus?.(parsed.data.stage, parsed.data.message); break;
          case 'delta': events.onDelta?.(parsed.data.text); break;
          case 'resume': events.onResume?.(parsed.data); break;
          case 'complete': events.onComplete?.(parsed.data); break;
          case 'cancelled': events.onCancelled?.(parsed.data); break;
          case 'error': events.onError?.(parsed.data.code, parsed.data.message, parsed.data.retryable); break;
        }
      }
    }
  } catch (error: any) {
    // 用户主动停止（AbortSignal）时读取阶段静默结束，不向调用方抛错
    if (error?.name === 'AbortError') return;
    throw error;
  }
}

export async function fetchConversationMessages(conversationId: string, opts?: { afterSeq?: number }): Promise<{ items: AssistantMessageView[] }> {
  const query = new URLSearchParams();
  if (opts?.afterSeq !== undefined) query.set('afterSeq', String(opts.afterSeq));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('会话消息加载失败');
  const payload = await response.json();
  return (payload?.data && typeof payload.data === 'object' && Array.isArray(payload.data.items)) ? payload.data : payload;
}
