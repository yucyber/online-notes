'use client';

export const ASSISTANT_NAVIGATION_KEY = 'assistant_navigation_snapshot_v1';

export type AssistantNavigationSnapshot = {
  conversationId: string;
  messageId?: string;
  citationId?: string;
  contextPanelTab: 'citations' | 'info';
  expandedChunkIds: string[];
  scrollAnchorMessageId?: string;
  savedAt: string;
};

export function saveAssistantNavigation(snapshot: AssistantNavigationSnapshot) {
  try { sessionStorage.setItem(ASSISTANT_NAVIGATION_KEY, JSON.stringify(snapshot)); } catch { /* storage 不可用时忽略 */ }
}

export function peekAssistantNavigation(): AssistantNavigationSnapshot | null {
  return read();
}

export function consumeAssistantNavigation(): AssistantNavigationSnapshot | null {
  const snapshot = read();
  if (snapshot) clearAssistantNavigation();
  return snapshot;
}

export function clearAssistantNavigation() {
  try { sessionStorage.removeItem(ASSISTANT_NAVIGATION_KEY); } catch { /* ignore */ }
}

function read(): AssistantNavigationSnapshot | null {
  try {
    const raw = sessionStorage.getItem(ASSISTANT_NAVIGATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.conversationId !== 'string') return null;
    return {
      conversationId: parsed.conversationId,
      messageId: typeof parsed.messageId === 'string' ? parsed.messageId : undefined,
      citationId: typeof parsed.citationId === 'string' ? parsed.citationId : undefined,
      contextPanelTab: parsed.contextPanelTab === 'info' ? 'info' : 'citations',
      expandedChunkIds: Array.isArray(parsed.expandedChunkIds) ? parsed.expandedChunkIds.filter((id: unknown) => typeof id === 'string') : [],
      scrollAnchorMessageId: typeof parsed.scrollAnchorMessageId === 'string' ? parsed.scrollAnchorMessageId : undefined,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    };
  } catch { return null; }
}
