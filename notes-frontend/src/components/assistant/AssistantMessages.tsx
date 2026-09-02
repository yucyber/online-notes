'use client';

import { useEffect, useRef } from 'react';
import { BookOpen, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { AssistantMessageView, RagCitation } from '@/lib/assistant-stream-client';

type Props = {
  messages: AssistantMessageView[];
  generating: boolean;
  onRetry: (messageId: string) => void;
  onOpenCitation: (citation: RagCitation) => void;
  // 搜索结果/导航快照的消息定位锚点：命中后滚动到对应消息行并回调清除
  anchorMessageId?: string | null;
  onAnchorHandled?: () => void;
};

function SourceLabel({ route }: { route: 'pet' | 'rag' }) {
  return (
    <div className={`assistant-message-source ${route}`}>
      {route === 'rag' ? <BookOpen aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
      {route === 'rag' ? '基于你的笔记' : '轻松聊聊'}
    </div>
  );
}

export default function AssistantMessages({ messages, generating, onRetry, onOpenCitation, anchorMessageId = null, onAnchorHandled }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // 新消息/流式内容到达时跟随到底部
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, generating]);

  // 搜索结果消息命中：等目标消息行渲染后滚动定位（搜索下拉给出的 messageId 在会话内必然存在）
  useEffect(() => {
    if (!anchorMessageId) return;
    const list = listRef.current;
    if (!list) return;
    const node = Array.from(list.querySelectorAll<HTMLElement>('[data-message-id]')).find(
      (el) => el.dataset.messageId === anchorMessageId,
    );
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    onAnchorHandled?.();
  }, [anchorMessageId, messages, onAnchorHandled]);

  if (messages.length === 0) {
    return (
      <div className="assistant-messages" ref={listRef}>
        <div className="assistant-empty-state">
          <span className="assistant-empty-mark"><Sparkles aria-hidden="true" /></span>
          <h4>今天想聊点什么？</h4>
          <p>直接聊天，或让我从你有权限访问的笔记里寻找依据。</p>
        </div>
        {generating && <p className="assistant-typing"><Loader2 aria-hidden="true" />小助手正在思考…</p>}
        <div ref={endRef} />
      </div>
    );
  }

  return (
    <div className="assistant-messages" ref={listRef}>
      {messages.map((item) => (
        <article
          key={item.id}
          data-message-id={item.id}
          className={`assistant-message-row ${item.role === 'user' ? 'is-user' : 'is-assistant'} ${item.status === 'failed' ? 'is-failed' : ''}`}
        >
          {item.role === 'assistant' && <SourceLabel route={item.route} />}
          {item.role === 'user' && <div className="assistant-message-user-tag">我</div>}
          <div className="assistant-message-bubble">
            <div className="assistant-message-content">
              <ReactMarkdown>{item.content || ''}</ReactMarkdown>
            </div>
            {item.status === 'failed' && (
              <div className="assistant-message-error">
                <p>回答生成中断，请重试。</p>
                <button type="button" aria-label="重新回答" onClick={() => onRetry(item.id)}>重新回答</button>
              </div>
            )}
            {item.citations.length > 0 && (
              <div className="assistant-message-citations" aria-label="笔记引用">
                <p className="assistant-citations-label">引用来源</p>
                <div className="assistant-citations-grid">
                  {item.citations.map((citation) => (
                    <button
                      key={citation.evidenceId}
                      type="button"
                      aria-label={`查看引用 ${citation.noteTitle}`}
                      onClick={() => onOpenCitation(citation)}
                    >
                      <strong>{citation.noteTitle}</strong>
                      {citation.headingPath.length > 0 && <span>{citation.headingPath.join(' > ')}</span>}
                      <em>{citation.excerpt}</em>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {item.memoryCitations && item.memoryCitations.length > 0 && (
              <div className="assistant-message-memory" aria-label="已确认认知引用">
                <p className="assistant-citations-label">来自已确认认知</p>
                <ul className="assistant-memory-citation-list" style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
                  {item.memoryCitations.map((citation) => (
                    <li
                      key={citation.memoryId}
                      className="assistant-memory-citation"
                      style={{
                        display: 'inline-flex', alignItems: 'baseline', gap: 6,
                        maxWidth: '100%', padding: '5px 9px', margin: '2px 6px 2px 0',
                        border: '1px dashed var(--product-accent-line)',
                        borderRadius: 8, background: 'var(--product-accent-soft)',
                        color: 'var(--product-text)', fontSize: 11, lineHeight: 1.5,
                      }}
                    >
                      <strong style={{
                        flex: 'none', color: 'var(--product-accent)', fontWeight: 650,
                        fontVariantNumeric: 'tabular-nums',
                      }}>[{citation.marker.replace(/^\[|\]$/g, '')}]</strong>
                      <span>{citation.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {item.warnings.map((warning) => <p key={warning} className="assistant-message-warning">{warning}</p>)}
          </div>
        </article>
      ))}
      {generating && <p className="assistant-typing"><Loader2 aria-hidden="true" />小助手正在思考…</p>}
      <div ref={endRef} />
    </div>
  );
}
