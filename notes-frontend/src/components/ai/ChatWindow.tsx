'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Maximize2, Sparkles, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { appToast } from '@/lib/app-toast';
import {
  AssistantMessageView, AssistantRoute, streamAssistantReply, fetchConversationMessages,
} from '@/lib/assistant-stream-client';
import { routeAssistantMessage } from './assistant-history';
import RagCitationList from './RagCitationList';

const CURRENT_CONVERSATION_KEY = 'assistant_current_conversation_id';

function requestId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type LocalMessage = AssistantMessageView;

interface ChatWindowProps { isOpen: boolean; onClose: () => void }

export default function ChatWindow({ isOpen, onClose }: ChatWindowProps) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [forceNotes, setForceNotes] = useState(false);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const activeRequestIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 挂载时按本地保存的会话 ID 从服务端恢复消息；服务端不可用时保持空态
  useEffect(() => {
    let active = true;
    const conversationId = localStorage.getItem(CURRENT_CONVERSATION_KEY);
    if (!conversationId) return;
    void fetchConversationMessages(conversationId)
      .then((result) => {
        if (!active) return;
        conversationIdRef.current = conversationId;
        setMessages(result.items);
      })
      .catch(() => { /* 服务端不可用时保持空态 */ });
    return () => { active = false; };
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, generating]);

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
          setMessages((prev) => prev.map((m) => (m.id === data.messageId ? { ...m, status: 'completed', citations: data.citations, warnings: data.warnings } : m)));
        },
        onCancelled: (data) => {
          setMessages((prev) => prev.map((m) => (m.id === data.messageId ? { ...m, status: 'cancelled', content: data.text } : m)));
        },
        onError: () => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: 'failed' } : m)));
        },
      },
    ).catch(() => {
      // 请求级失败：保留占位消息标记 failed，提供"重新回答"（新 requestId 重发同一问题）
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, status: 'failed' } : m)));
      appToast.error({
        id: `assistant:${currentRequestId}`, title: '小助手请求失败', message: '请检查网络后重试。', persistent: true,
        action: { label: '重新回答', onClick: () => { send(content, route); } },
      });
    }).finally(() => {
      activeRequestIdRef.current = null;
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
          <button type="button" title="展开全屏工作台" aria-label="展开全屏工作台"><Maximize2 aria-hidden="true" /></button>
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
      <div className="ink-compose-wrap">
        <button type="button" className="ink-note-toggle" aria-pressed={forceNotes} onClick={() => setForceNotes((current) => !current)}><BookOpen aria-hidden="true" />搜索笔记</button>
        <div className="ink-compose-real">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSend(); } }} placeholder="问问小助手…" />
          {generating
            ? <button type="button" onClick={handleStop} aria-label="停止生成"><Square aria-hidden="true" /></button>
            : <button type="button" onClick={handleSend} disabled={!input.trim()} aria-label="发送">↑</button>}
        </div>
      </div>
    </aside>
  );
}
