'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Download, PanelRight, Search } from 'lucide-react';
import {
  type AssistantSearchResult, type ConversationListItem, exportConversation, fetchConversations, renameConversation, searchAssistant, setConversationStatus,
} from '@/lib/assistant-api';
import {
  type AssistantMessageView, type AssistantRoute, type RagCitation, fetchConversationMessages, streamAssistantReply,
} from '@/lib/assistant-stream-client';
import { routeAssistantMessage } from '../ai/assistant-history';
import { type AssistantNavigationSnapshot, consumeAssistantNavigation, saveAssistantNavigation } from './assistant-navigation';
import AssistantCompose from './AssistantCompose';
import AssistantContextPanel, { type EvidenceTarget } from './AssistantContextPanel';
import { ConversationList } from './ConversationList';
import AssistantMessages from './AssistantMessages';

const CURRENT_CONVERSATION_KEY = 'assistant_current_conversation_id';
const SEARCH_DEBOUNCE_MS = 300;

function requestId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// stream-client 入参类型未声明 retryOfMessageId（后端已支持重试追溯），在工作台调用侧扩展，不改共享客户端
type StreamReplyInput = Parameters<typeof streamAssistantReply>[0] & { retryOfMessageId?: string };

type SearchHitMessage = AssistantSearchResult['messages'][number];

export function AssistantWorkspace({ initialConversationId }: { initialConversationId?: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [activeId, setActiveId] = useState<string>(() => initialConversationId || searchParams?.get('conversation') || '');
  const [messages, setMessages] = useState<AssistantMessageView[]>([]);
  // 已加载消息的会话 id：避免重复拉取覆盖流式中的乐观消息
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [forceNotes, setForceNotes] = useState(false);
  const [generating, setGenerating] = useState(false);
  // <768px 单栏视图：会话 / 对话 / 上下文 三标签
  const [layoutTab, setLayoutTab] = useState<'conversations' | 'chat' | 'context'>('chat');
  // 上下文面板内部标签（citations/info）——与移动布局标签相互独立，勿混用
  const [panelTab, setPanelTab] = useState<'citations' | 'info'>('citations');
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [citationTarget, setCitationTarget] = useState<EvidenceTarget | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AssistantSearchResult | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // 搜索消息命中 / 导航快照恢复：消息行渲染后滚动定位
  const [anchorMessageId, setAnchorMessageId] = useState<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const stoppingRef = useRef(false);
  const debounceTimerRef = useRef<number | null>(null);
  // 搜索在途响应防串：query 变化即自增，晚到的旧响应不再打开结果面板
  const searchSeqRef = useRef(0);
  // 返回本页时消费一次导航快照（引用/面板/滚动恢复）
  const navSnapshotRef = useRef<AssistantNavigationSnapshot | null>(null);

  const refreshConversations = useCallback(() => {
    void fetchConversations()
      .then((items) => setConversations(items.filter((item) => item.status === 'active')))
      .catch(() => undefined);
  }, []);

  useEffect(() => { refreshConversations(); }, [refreshConversations]);

  // 当前会话与地址栏双向一致：切换/新建/清除会话都 replace（不 push，避免历史栈膨胀），
  // 使刷新、复制链接、从浮层"展开"均落到正在查看的会话；空会话去掉 ?conversation 参数。
  // 首次挂载也执行一次，把 initialConversationId 归一进 URL（浮层展开带参进入时参数本就一致，replace 幂等）。
  useEffect(() => {
    router.replace(activeId ? `/dashboard/assistant?conversation=${encodeURIComponent(activeId)}` : '/dashboard/assistant');
  }, [activeId, router]);

  // 会话消息加载：仅在 activeId 变化且未加载过该会话时拉取。
  // 历史快照只在列表仍为空时应用：切会话后若已乐观发送，晚到的历史不得覆盖乐观消息（评审 P2-2）
  useEffect(() => {
    if (!activeId || loadedConversationId === activeId) return;
    let cancelled = false;
    setMessages([]);
    void fetchConversationMessages(activeId)
      .then((result) => {
        if (cancelled) return;
        setMessages((prev) => (prev.length === 0 ? result.items : prev));
        setLoadedConversationId(activeId);
      })
      // 历史拉取失败：保留当前（空态或已乐观发送的）列表，不强制清空乐观消息（评审 P3-a）
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeId, loadedConversationId]);

  // 消息加载完成后检测进行中的生成并自动重连续接（C 方案最小实现：进程内刷新重连）。
  // 场景：用户在生成进行中刷新页面/离开再回来，历史消息 API 返回 status=streaming/pending 的 assistant 消息
  // + requestId → 后端仍在运行（running 未清）时用同 requestId 重新发起 POST chat 命中 attach，
  // 收到 resume 快照覆盖气泡后续收剩余 delta，恢复打字机；若生成已结束则命中 stale 路径补发 complete，状态收敛。
  useEffect(() => {
    if (!loadedConversationId) return;
    const inflight = messages.find(
      (m) => m.role === 'assistant' && (m.status === 'streaming' || m.status === 'pending') && m.requestId,
    );
    if (!inflight || !inflight.requestId) return;
    if (generating) return; // 已有进行中的生成（如用户主动发送），不重复重连
    const reconnectRequestId = inflight.requestId;
    // 找对应的 user 提问（紧挨着 inflight 消息的前一条）
    const idx = messages.indexOf(inflight);
    const userMsg = idx > 0 ? messages[idx - 1] : null;
    const question = userMsg?.role === 'user' ? userMsg.content : '';
    let assistantId = inflight.id;
    activeRequestIdRef.current = reconnectRequestId;
    setGenerating(true);
    void streamAssistantReply(
      { conversationId: loadedConversationId, requestId: reconnectRequestId, question },
      {
        onResume: (data) => {
          // resume 快照：用全量已生成 content 覆盖气泡（非追加），作为后续 delta 的起点；
          // 只按 assistantMessageId 精确匹配，避免误匹配列表里其他带同 requestId 的消息造成重复 key。
          assistantId = data.assistantMessageId;
          setMessages((prev) => prev.map((m) =>
            m.id === data.assistantMessageId
              ? { ...m, content: data.content, status: 'streaming' }
              : m,
          ));
        },
        onDelta: (text) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text, status: 'streaming' } : m)));
        },
        onComplete: (data) => {
          setMessages((prev) => prev.map((m) => (m.id === data.messageId
            ? { ...m, status: 'completed', citations: data.citations, warnings: data.warnings, memoryCitations: data.memoryCitations ?? [] }
            : m)));
          refreshConversations();
        },
        onCancelled: (data) => {
          setMessages((prev) => prev.map((m) => (m.id === data.messageId ? { ...m, status: 'cancelled', content: data.text } : m)));
        },
        onError: (code) => {
          if (code === 'CANCELLED') return;
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: 'failed' } : m)));
        },
      },
    ).then(() => {
      setMessages((prev) => prev.map((m) => (
        m.id === assistantId && (m.status === 'pending' || m.status === 'streaming')
          ? { ...m, status: 'failed' } : m
      )));
    }).catch(() => {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: 'failed' } : m)));
    }).finally(() => {
      if (activeRequestIdRef.current === reconnectRequestId) activeRequestIdRef.current = null;
      setGenerating(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedConversationId]); // 仅在消息加载完成时检测一次，不依赖 messages 避免重复触发
  useEffect(() => {
    const snapshot = consumeAssistantNavigation();
    if (snapshot) navSnapshotRef.current = snapshot;
  }, []);

  useEffect(() => {
    const snapshot = navSnapshotRef.current;
    if (!snapshot) return;
    if (activeId === '') { setActiveId(snapshot.conversationId); return; }
    if (loadedConversationId !== activeId) return;
    navSnapshotRef.current = null;
    setPanelTab(snapshot.contextPanelTab === 'info' ? 'info' : 'citations');
    if (snapshot.expandedChunkIds.length > 0 || snapshot.citationId) {
      setContextPanelOpen(true);
      setLayoutTab('context');
    }
    if (snapshot.citationId) {
      const citation = messages.flatMap((m) => m.citations).find((c) => c.evidenceId === snapshot.citationId);
      if (citation) setCitationTarget({ citation, key: `restore-${citation.evidenceId}` });
    }
    if (snapshot.scrollAnchorMessageId) setAnchorMessageId(snapshot.scrollAnchorMessageId);
  }, [activeId, loadedConversationId, messages]);

  // 搜索防抖：300ms 无新输入才调 searchAssistant；输入清空即收起结果。
  // 每次 query 变化自增 seq：在途响应晚到（已清空/已输入新词）时丢弃，不复活旧结果面板（评审 P3-1）
  useEffect(() => {
    if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
    const query = searchQuery.trim();
    const seq = ++searchSeqRef.current;
    if (!query) {
      setSearchOpen(false);
      setSearchResults(null);
      return;
    }
    debounceTimerRef.current = window.setTimeout(() => {
      void searchAssistant(query)
        .then((result) => {
          if (searchSeqRef.current !== seq) return;
          setSearchResults(result);
          setSearchOpen(true);
        })
        .catch(() => { if (searchSeqRef.current === seq) setSearchOpen(false); });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
    };
  }, [searchQuery]);

  const closeSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults(null);
    setSearchOpen(false);
  }, []);

  const openConversation = (id: string) => {
    if (generating) return;
    setCitationTarget(null);
    setContextPanelOpen(false);
    setPanelTab('citations');
    setLayoutTab('chat');
    setAnchorMessageId(null);
    if (id === activeId) return;
    setActiveId(id);
    setLoadedConversationId(null);
    // 切换会话同步 localStorage：浮窗（ChatWindow）常驻 layout、只在重新打开时复查 localStorage，
    // 不同步会让浮窗下次打开仍停在旧会话而不是刚切换的这个。
    localStorage.setItem(CURRENT_CONVERSATION_KEY, id);
  };

  const handleNewConversation = () => {
    if (generating) return;
    clearConversation();
  };

  // 清空当前选择（不含 generating 守卫）：新建按钮走守卫版；归档/删除当前会话需先停流再清空
  const clearConversation = () => {
    localStorage.removeItem(CURRENT_CONVERSATION_KEY);
    setActiveId('');
    setLoadedConversationId(null);
    setMessages([]);
    setInput('');
    setCitationTarget(null);
    setAnchorMessageId(null);
    setContextPanelOpen(false);
    setLayoutTab('chat');
  };

  const openCitation = useCallback((citation: RagCitation) => {
    setCitationTarget({ citation, key: `${citation.evidenceId}-${Date.now()}` });
    setPanelTab('citations');
    setContextPanelOpen(true);
    setLayoutTab('context');
  }, []);

  // 引用列表标签上的"上一级"按钮：回到 citations 列表（保留打开状态）
  const backToCitations = useCallback(() => {
    setCitationTarget(null);
    setPanelTab('citations');
  }, []);

  const closeContextPanel = useCallback(() => {
    setContextPanelOpen(false);
    setLayoutTab('chat');
  }, []);

  // 打开引用前保存导航快照（定位原文由 ChunkEvidenceViewer 的 Link 跳转），返回时按快照恢复
  const handleLocate = useCallback(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;
    const snapshot: AssistantNavigationSnapshot = {
      conversationId: activeId || lastAssistant.conversationId,
      messageId: lastAssistant.id,
      citationId: citationTarget?.citation.evidenceId,
      contextPanelTab: panelTab,
      expandedChunkIds: citationTarget ? [citationTarget.citation.chunkId] : [],
      scrollAnchorMessageId: lastAssistant.id,
      savedAt: new Date().toISOString(),
    };
    saveAssistantNavigation(snapshot);
  }, [activeId, messages, citationTarget, panelTab]);

  // 复用 ChatWindow 的统一流式协议；工作台内失败消息内联提供"重新回答"，无需浮层 toast
  const startReply = (question: string, route: AssistantRoute, retryOfMessageId?: string) => {
    if (!question.trim() || generating) return;
    const currentRequestId = requestId();
    activeRequestIdRef.current = currentRequestId;
    setGenerating(true);
    const localUserMessageId = `local-user-${currentRequestId}`;
    const localAssistantId = `local-assistant-${currentRequestId}`;
    const now = new Date().toISOString();
    setMessages((prev) => [...prev,
      { id: localUserMessageId, conversationId: '', seq: 0, role: 'user', route, content: question, status: 'completed', citations: [], warnings: [], createdAt: now },
      { id: localAssistantId, conversationId: '', seq: 0, role: 'assistant', route, content: '', status: 'pending', citations: [], warnings: [], createdAt: now },
    ]);
    let assistantId = localAssistantId;
    const payload: StreamReplyInput = {
      conversationId: activeId || undefined,
      requestId: currentRequestId,
      question,
      forceRoute: route,
      ...(retryOfMessageId ? { retryOfMessageId } : {}),
    };
    // 是否本次才新建会话：发送时无归属会话（activeId 为空 → payload.conversationId 为 undefined）才会让后端
    // 新建会话并返回新 conversationId。只有在新建场景才需要 onStarted 刷新侧栏让新会话出现；在既有会话续聊时
    // 标题/最后消息仍在生成中，此刻刷新拿不到新值，是多余请求，故用发送时的值在闭包内快照，避免 onStarted
    // 里读已 setActiveId 后的最新值导致误判为新建。
    const isNewConversation = !payload.conversationId
    void streamAssistantReply(payload, {
      onStarted: (data) => {
        setActiveId(data.conversationId);
        setLoadedConversationId(data.conversationId);
        localStorage.setItem(CURRENT_CONVERSATION_KEY, data.conversationId);
        assistantId = data.assistantMessageId;
        setMessages((prev) => prev.map((m) => (m.id === localAssistantId
          ? { ...m, id: data.assistantMessageId, conversationId: data.conversationId, status: 'streaming' }
          : m)));
        // 新建会话已落库：刷新列表让侧栏出现新会话（既有会话续聊不刷，见 isNewConversation）
        if (isNewConversation) refreshConversations();
      },
      onDelta: (text) => {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text, status: 'streaming' } : m)));
      },
      onComplete: (data) => {
        setMessages((prev) => prev.map((m) => (m.id === data.messageId
          ? { ...m, status: 'completed', citations: data.citations, warnings: data.warnings, memoryCitations: data.memoryCitations ?? [] }
          : m)));
        // 回答完成：后端已重命名标题（renameIfDefault）并更新 lastMessageAt/messageCount，
        // 此刻刷新侧栏才能拿到准确的最新元数据（onStarted 时标题仍是"新对话"占位）。
        // 取消/失败（onCancelled/onError）后端不重命名，无需在此刷新。
        refreshConversations();
      },
      onCancelled: (data) => {
        setMessages((prev) => prev.map((m) => (m.id === data.messageId ? { ...m, status: 'cancelled', content: data.text } : m)));
      },
      onError: (code) => {
        // cancel 会先发 error(CANCELLED) 随后发 cancelled 事件标记终态：忽略避免闪烁 failed
        if (code === 'CANCELLED') return;
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: 'failed' } : m)));
      },
    }).then(() => {
      // 流正常结束但消息仍非终态（服务端提前断开）：兜底标 failed；主动停止除外
      if (stoppingRef.current) return;
      setMessages((prev) => prev.map((m) => (m.id === assistantId && (m.status === 'pending' || m.status === 'streaming')
        ? { ...m, status: 'failed' }
        : m)));
    }).catch(() => {
      // 已点停止的断开不算失败（服务端落库 cancelled）
      if (stoppingRef.current) return;
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: 'failed' } : m)));
    }).finally(() => {
      activeRequestIdRef.current = null;
      stoppingRef.current = false;
      setGenerating(false);
    });
  };

  const handleSend = () => {
    const content = input.trim();
    if (!content || generating) return;
    setInput('');
    startReply(content, routeAssistantMessage(content, forceNotes));
  };

  const cancelActiveRequest = () => {
    const current = activeRequestIdRef.current;
    if (!current) return;
    stoppingRef.current = true;
    // cancel 端点与 /chat 一样豁免 Idempotency-Key：原生 fetch 不附加该头
    void fetch(`/api/assistant/generations/${encodeURIComponent(current)}/cancel`, { method: 'POST' }).catch(() => undefined);
  };

  const handleStop = () => { cancelActiveRequest(); };

  // failed 回答重试：question 取前一条 user 消息（缺省用失败内容）。
  // - 服务端落库消息（id 非 local-*、已有会话）：带 retryOfMessageId 走血缘重试；
  // - request 级失败消息仍是 local-* 占位（onStarted 未发生，服务端无此消息）：
  //   传 local id 会让服务端 createPlaceholder 因非法 ObjectId 抛错且 appendUser 先落重复 user 消息，
  //   故对占位消息作普通重发（同 ChatWindow send 路径，不传 retryOfMessageId）。
  // 点击即移除原消息 failed 标记：避免成功后该气泡仍可重复点击造成重复追加（评审 P3-2/P3-c）
  const handleRetry = (messageId: string) => {
    if (generating) return;
    const index = messages.findIndex((m) => m.id === messageId);
    if (index < 0) return;
    const failed = messages[index];
    if (failed.role !== 'assistant') return;
    let question = failed.content || '';
    for (let i = index - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') { question = messages[i].content; break; }
    }
    if (!question.trim()) return;
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, status: 'completed' } : m)));
    const isLocalPlaceholder = failed.id.startsWith('local-') || !failed.conversationId;
    startReply(question, failed.route, isLocalPlaceholder ? undefined : messageId);
  };

  const handleRename = (id: string, title: string) => {
    void renameConversation(id, title).then(refreshConversations).catch(() => undefined);
  };

  const handleArchive = (id: string) => {
    // 归档生成中的当前会话：先取消在途流，再清空选择（handleNewConversation 的 generating 守卫会吞掉此路径）
    if (generating && id === activeId) cancelActiveRequest();
    void setConversationStatus(id, 'archive').then(() => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === activeId) clearConversation();
    }).catch(() => undefined);
  };

  const handleDelete = (id: string) => {
    if (generating && id === activeId) cancelActiveRequest();
    void setConversationStatus(id, 'delete').then(() => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === activeId) clearConversation();
    }).catch(() => undefined);
  };

  const handleExport = () => {
    if (!activeId) return;
    void exportConversation(activeId).catch(() => undefined);
  };

  const pickConversationHit = (id: string) => {
    openConversation(id);
    closeSearch();
  };

  const pickMessageHit = (hit: SearchHitMessage) => {
    openConversation(hit.conversationId);
    setAnchorMessageId(hit.messageId);
    closeSearch();
  };

  // 当前回答引用：右侧面板 citations 标签数据源（取最近一条 assistant 消息）
  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant');
  const panelCitations = lastAssistantMessage?.citations ?? [];
  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;

  const conversationTitleOf = (id: string) => conversations.find((c) => c.id === id)?.title || '会话';

  const hasSearchResults = Boolean(searchOpen && searchResults && (searchResults.conversations.length > 0 || searchResults.messages.length > 0));

  return (
    <div className="assistant-workspace" data-layout={layoutTab}>
      <header className="assistant-workspace-topbar">
        <div className="assistant-workspace-title"><span className="assistant-workspace-mark" aria-hidden="true">✦</span>小助手工作台</div>
        <div className="assistant-search">
          <Search aria-hidden="true" className="assistant-search-icon" />
          <input
            type="text"
            aria-label="搜索会话与消息"
            placeholder="搜索会话与消息"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {hasSearchResults && searchResults && (
            <div className="assistant-search-results">
              {searchResults.conversations.length > 0 && (
                <section className="assistant-search-group">
                  <p className="assistant-search-group-title">标题命中</p>
                  {searchResults.conversations.map((hit) => (
                    <button key={hit.id} type="button" className="assistant-search-hit" onClick={() => pickConversationHit(hit.id)}>
                      <strong>{hit.title || '新对话'}</strong>
                    </button>
                  ))}
                </section>
              )}
              {searchResults.messages.length > 0 && (
                <section className="assistant-search-group">
                  <p className="assistant-search-group-title">消息命中</p>
                  {searchResults.messages.map((hit) => (
                    <button key={hit.messageId} type="button" className="assistant-search-hit" onClick={() => pickMessageHit(hit)}>
                      <strong>{conversationTitleOf(hit.conversationId)} · 第 {hit.seq} 条消息</strong>
                      <span>{hit.snippet}</span>
                    </button>
                  ))}
                </section>
              )}
            </div>
          )}
        </div>
        <div className="assistant-workspace-actions">
          <button
            type="button"
            className="assistant-context-toggle"
            aria-label="查看引用"
            aria-pressed={contextPanelOpen}
            title="查看引用"
            onClick={() => { setContextPanelOpen((v) => !v); setLayoutTab('context'); }}
          >
            <PanelRight aria-hidden="true" />
          </button>
          {activeId && (
            <button type="button" className="assistant-export-button" aria-label="导出会话" title="导出会话" onClick={handleExport}>
              <Download aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      <div className="assistant-mobile-tabs" aria-label="工作台视图">
        {([['conversations', '会话'], ['chat', '对话'], ['context', '上下文']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={layoutTab === key}
            className={layoutTab === key ? 'is-active' : ''}
            onClick={() => { setLayoutTab(key); if (key === 'chat') setContextPanelOpen(false); }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="assistant-workspace-grid">
        <aside className="assistant-workspace-side">
          <ConversationList
            items={conversations}
            activeId={activeId || undefined}
            onSelect={openConversation}
            onNew={handleNewConversation}
            onRename={handleRename}
            onArchive={handleArchive}
            onDelete={handleDelete}
          />
        </aside>

        <main className="assistant-workspace-main">
          <AssistantMessages
            messages={messages}
            generating={generating}
            onRetry={handleRetry}
            onOpenCitation={openCitation}
            anchorMessageId={anchorMessageId}
            onAnchorHandled={() => setAnchorMessageId(null)}
          />
          <AssistantCompose
            value={input}
            onChange={setInput}
            onSend={handleSend}
            onStop={handleStop}
            generating={generating}
            forceNotes={forceNotes}
            onToggleForceNotes={() => setForceNotes((v) => !v)}
          />
        </main>

        <AssistantContextPanel
          tab={panelTab}
          onTabChange={setPanelTab}
          citations={panelCitations}
          evidence={citationTarget}
          conversation={activeConversation}
          open={contextPanelOpen}
          onOpenCitation={openCitation}
          onBackToCitations={backToCitations}
          onClosePanel={closeContextPanel}
          onLocate={handleLocate}
        />
      </div>
    </div>
  );
}
