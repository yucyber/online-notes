'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Maximize2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { appToast } from '@/lib/app-toast';
import {
  AssistantMessageView, AssistantRoute, streamAssistantReply, fetchConversationMessages,
} from '@/lib/assistant-stream-client';
import { routeAssistantMessage } from './assistant-history';
import RagCitationList from './RagCitationList';
import AssistantCompose from '../assistant/AssistantCompose';

const CURRENT_CONVERSATION_KEY = 'assistant_current_conversation_id';

function requestId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type LocalMessage = AssistantMessageView;

interface ChatWindowProps { isOpen: boolean; onClose: () => void }

export default function ChatWindow({ isOpen, onClose }: ChatWindowProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [forceNotes, setForceNotes] = useState(false);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const activeRequestIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  // 挂载恢复正在/已完成 fetch 的会话 id：重开 effect 对同一会话跳过，避免并发 fetch 覆盖重连内容。
  const restoringRef = useRef<string | null>(null);
  // 用户已点停止：后续 SSE 断开/报错不算失败，不标 failed、不弹 toast（服务端会落库 cancelled）
  const stoppingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 挂载时按本地保存的会话 ID 从服务端恢复消息；服务端不可用时保持空态
  useEffect(() => {
    let active = true;
    const conversationId = localStorage.getItem(CURRENT_CONVERSATION_KEY);
    if (!conversationId) return;
    // 标记恢复中的会话：重开 effect（isOpen false→true）不得对同一会话并发 fetch，
    // 避免旧 DB 快照覆盖恢复触发的重连实时内容（两个 fetch 竞态）。
    restoringRef.current = conversationId;
    void fetchConversationMessages(conversationId)
      .then((result) => {
        if (!active) return;
        // 只在消息列表仍为空时填充恢复快照（函数式更新）：发送已乐观追加消息时
        // 不覆盖，覆盖"发送后、onStarted 到达前"ref 仍为 null 的窗口
        setMessages((prev) => (prev.length === 0 ? result.items : prev));
        // 无活动发送且未建立会话时才记录恢复的会话 ID，避免改回用户新会话
        if (conversationIdRef.current === null && activeRequestIdRef.current === null) {
          conversationIdRef.current = conversationId;
        }
        // 检测进行中的生成并自动重连（C 方案）：同 AssistantWorkspace 的重连逻辑
        if (!active) return;
        const inflight = result.items.find(
          (m) => m.role === 'assistant' && (m.status === 'streaming' || m.status === 'pending') && m.requestId,
        );
        if (!inflight || !inflight.requestId || activeRequestIdRef.current !== null) return;
        const reconnectRequestId = inflight.requestId;
        const idx = result.items.indexOf(inflight);
        const userMsg = idx > 0 ? result.items[idx - 1] : null;
        const question = userMsg?.role === 'user' ? userMsg.content : '';
        let assistantId = inflight.id;
        activeRequestIdRef.current = reconnectRequestId;
        setGenerating(true);
        void streamAssistantReply(
          { conversationId, requestId: reconnectRequestId, question },
          {
            onResume: (data) => {
              // resume 快照：只按 assistantMessageId 精确匹配，避免误匹配列表里其他带同 requestId 的消息造成重复 key。
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
          if (!active) return;
          setMessages((prev) => prev.map((m) => (
            m.id === assistantId && (m.status === 'pending' || m.status === 'streaming')
              ? { ...m, status: 'failed' } : m
          )));
        }).catch(() => {
          if (!active) return;
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: 'failed' } : m)));
        }).finally(() => {
          if (activeRequestIdRef.current === reconnectRequestId) activeRequestIdRef.current = null;
          setGenerating(false);
        });
      })
      .catch(() => { /* 服务端不可用时保持空态 */ })
      .finally(() => {
        if (restoringRef.current === conversationId) restoringRef.current = null;
      });
    return () => { active = false; };
  }, []);

  // 每次从收起状态重新打开（isOpen false→true）复查 localStorage 的最新会话：
  // 浮窗常驻 dashboard layout，去全屏工作台切会话/对话后 localStorage 已更新，但浮窗恢复只发生一次（挂载），
  // 不复查会永远停在旧会话。生成中（activeRequestIdRef 非空）不切换，避免打断进行中的回答。
  const prevOpenRef = useRef(isOpen);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = isOpen;
    if (!isOpen || wasOpen) return;
    // 首挂即打开（isOpen=true）由上面的挂载恢复负责，这里只处理关闭后再打开
    if (activeRequestIdRef.current !== null) return;
    const conversationId = localStorage.getItem(CURRENT_CONVERSATION_KEY);
    if (!conversationId || conversationId === conversationIdRef.current) return;
    // 挂载恢复正在/已完成同一会话的 fetch（含触发重连）：不重复拉取，避免旧快照覆盖实时内容。
    if (restoringRef.current === conversationId) return;
    let active = true;
    void fetchConversationMessages(conversationId)
      .then((result) => {
        if (!active) return;
        // 挂载恢复可能已在此途中发起重连（同会话 streaming 消息）：此时以重连实时更新为准，
        // 不再用 DB 旧快照覆盖——无条件覆盖会把 resume/delta 已写入的内容打回旧值（表现为内容倒退/断流）。
        if (activeRequestIdRef.current !== null) return;
        setMessages(result.items);
        conversationIdRef.current = conversationId;
      })
      .catch(() => { /* 服务端不可用时保持空态 */ });
    return () => { active = false; };
  }, [isOpen]);

  // 消息变化（发送/流式/恢复）时滚到底部；isOpen 变化也要触发：组件常驻 layout（AIPet 仅靠 isOpen 显隐），
  // 历史消息常在浮窗打开前就恢复进 state，打开瞬间 messages 无变化、滚动不触发，会停在顶部首条而非底部最新。
  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, generating, isOpen]);

  const send = (content: string, route: AssistantRoute) => {
    const currentRequestId = requestId();
    activeRequestIdRef.current = currentRequestId;
    setGenerating(true);
    setMessages((prev) => [...prev, {
      id: `local-user-${currentRequestId}`, conversationId: '', seq: 0, role: 'user', route,
      content, status: 'completed', citations: [], warnings: [], createdAt: new Date().toISOString(),
    }]);
    // 先本地乐观追加占位消息，onStarted 后替换为服务端消息 ID
    const localAssistantId = `local-assistant-${currentRequestId}`;
    setMessages((prev) => [...prev, {
      id: localAssistantId, conversationId: '', seq: 0, role: 'assistant', route,
      content: '', status: 'pending', citations: [], warnings: [], createdAt: new Date().toISOString(),
    }]);
    let assistantId = localAssistantId;
    void streamAssistantReply(
      { conversationId: conversationIdRef.current || undefined, requestId: currentRequestId, question: content, forceRoute: route },
      {
        onStarted: (data) => {
          conversationIdRef.current = data.conversationId;
          localStorage.setItem(CURRENT_CONVERSATION_KEY, data.conversationId);
          setMessages((prev) => prev.map((m) => (m.id === localAssistantId
            ? { ...m, id: data.assistantMessageId, conversationId: data.conversationId, status: 'streaming' }
            : m)));
          assistantId = data.assistantMessageId;
        },
        onDelta: (text) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text, status: 'streaming' } : m)));
        },
        onComplete: (data) => {
          setMessages((prev) => prev.map((m) => (m.id === data.messageId ? { ...m, status: 'completed', citations: data.citations, warnings: data.warnings, memoryCitations: data.memoryCitations ?? [] } : m)));
        },
        onCancelled: (data) => {
          setMessages((prev) => prev.map((m) => (m.id === data.messageId ? { ...m, status: 'cancelled', content: data.text } : m)));
        },
        onError: (code) => {
          // cancel 会先发 error(CANCELLED) 随后发 cancelled 事件标记终态：这里忽略，避免短暂把消息标 failed 闪烁"回答生成中断"
          if (code === 'CANCELLED') return;
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: 'failed' } : m)));
        },
      },
    ).then(() => {
      // 流正常结束但消息仍非终态（如服务端提前断开未发终态事件）：兜底标 failed；主动停止除外
      if (stoppingRef.current) return;
      setMessages((prev) => prev.map((m) => (m.id === assistantId && (m.status === 'pending' || m.status === 'streaming')
        ? { ...m, status: 'failed' }
        : m)));
    }).catch(() => {
      // 已点停止的断开不算失败：服务端会落库 cancelled，避免误弹失败 toast
      if (stoppingRef.current) return;
      // 请求级失败：保留占位消息标记 failed，提供"重新回答"（新 requestId 重发同一问题）
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: 'failed' } : m)));
      appToast.error({
        id: `assistant:${currentRequestId}`, title: '小助手请求失败', message: '请检查网络后重试。', persistent: true,
        action: { label: '重新回答', onClick: () => { send(content, route); } },
      });
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
    send(content, routeAssistantMessage(content, forceNotes));
  };

  const handleStop = () => {
    const current = activeRequestIdRef.current;
    if (!current) return;
    stoppingRef.current = true;
    // cancel 端点与 /chat 一样豁免 Idempotency-Key：原生 fetch 不附加该头
    void fetch(`/api/assistant/generations/${encodeURIComponent(current)}/cancel`, { method: 'POST' }).catch(() => undefined);
  };

  const handleNewConversation = () => {
    localStorage.removeItem(CURRENT_CONVERSATION_KEY);
    conversationIdRef.current = null;
    setMessages([]);
  };

  if (!isOpen) return null;
  return (
    <aside className="ink-panel-real" aria-label="小助手">
      <div className="ink-head-real">
        <div className="ink-head-title"><span className="ink-head-mark"><Sparkles aria-hidden="true" /></span><div><h3>小助手</h3><p>闲聊，或从你的笔记中寻找答案</p></div></div>
        <div className="ink-head-actions">
          {/* 全屏工作台（/dashboard/assistant）：带当前会话 id 展开，工作台按 ?conversation 直接定位该会话。
              展开前先收起浮窗：dashboard layout 共享 AIPet，路由跳转不会卸载浮窗，不关闭会与全屏工作台并存。 */}
          <button
            type="button"
            title="展开全屏工作台"
            aria-label="展开全屏工作台"
            onClick={() => {
              onClose();
              router.push(`/dashboard/assistant${conversationIdRef.current ? `?conversation=${encodeURIComponent(conversationIdRef.current)}` : ''}`);
            }}
          >
            <Maximize2 aria-hidden="true" />
          </button>
          <button type="button" onClick={handleNewConversation} title="新建对话">新建</button>
          <button type="button" onClick={onClose} aria-label="关闭小助手">×</button>
        </div>
      </div>
      <div className="ink-body-real">
        {messages.length === 0 && <div className="ink-empty-real"><span><Sparkles aria-hidden="true" /></span><h4>今天想聊点什么？</h4><p>直接聊天，或让我从你有权限访问的笔记里寻找依据。</p><div>{['帮我理清今天的想法', '找找我之前踩过的坑'].map((action) => <button key={action} type="button" onClick={() => setInput(action)}>{action}</button>)}</div></div>}
        {messages.map((message) => <div key={message.id} className={`ink-message-real ${message.role}`}>
          {message.role === 'assistant' && <div className={`ink-message-source ${message.route}`}>{message.route === 'rag' ? <BookOpen aria-hidden="true" /> : <Sparkles aria-hidden="true" />}{message.route === 'rag' ? '基于你的笔记' : '轻松聊聊'}</div>}
          <div className="prose dark:prose-invert max-w-none text-sm"><ReactMarkdown>{message.content}</ReactMarkdown></div>
          {message.status === 'failed' && <p className="ink-message-warning">回答生成中断，请重试。</p>}
          {message.citations.length > 0 && <RagCitationList citations={message.citations} />}
          {message.warnings.map((warning) => <p key={warning} className="ink-message-warning">{warning}</p>)}
        </div>)}
        <div ref={messagesEndRef} />
      </div>
      {/* 输入区收敛到共享组件 AssistantCompose：ChatWindow 与全屏工作台同构，避免重复维护 */}
      <AssistantCompose
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onStop={handleStop}
        generating={generating}
        forceNotes={forceNotes}
        onToggleForceNotes={() => setForceNotes((current) => !current)}
      />
    </aside>
  );
}
