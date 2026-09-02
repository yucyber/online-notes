'use client';

import { X } from 'lucide-react';
import type { ConversationListItem } from '@/lib/assistant-api';
import type { RagCitation } from '@/lib/assistant-stream-client';
import ChunkEvidenceViewer from './ChunkEvidenceViewer';

export type EvidenceTarget = { citation: RagCitation; key: string };

type Props = {
  tab: 'citations' | 'info';
  onTabChange: (tab: 'citations' | 'info') => void;
  // citations 标签的数据源：当前回答的引用列表
  citations: RagCitation[];
  // 已选中待查看原文的引用；非空时在面板内挂载 ChunkEvidenceViewer
  evidence: EvidenceTarget | null;
  conversation: ConversationListItem | null;
  open: boolean;
  onOpenCitation: (citation: RagCitation) => void;
  onBackToCitations: () => void;
  onClosePanel: () => void;
  onLocate: () => void;
};

export default function AssistantContextPanel({ tab, onTabChange, citations, evidence, conversation, open, onOpenCitation, onBackToCitations, onClosePanel, onLocate }: Props) {
  return (
    <aside className={`assistant-workspace-context assistant-context-panel${open ? ' is-open' : ''}`} aria-label="上下文面板">
      <header className="assistant-context-head">
        <div className="assistant-context-tabs" aria-label="上下文标签">
          <button type="button" aria-pressed={tab === 'citations'} className={tab === 'citations' ? 'is-active' : ''} onClick={() => onTabChange('citations')}>引用</button>
          <button type="button" aria-pressed={tab === 'info'} className={tab === 'info' ? 'is-active' : ''} onClick={() => onTabChange('info')}>会话信息</button>
        </div>
        <button type="button" className="assistant-context-close" aria-label="关闭上下文面板" onClick={onClosePanel}><X aria-hidden="true" /></button>
      </header>
      <div className="assistant-context-body">
        {tab === 'citations' ? (
          evidence ? (
            <div className="assistant-context-evidence">
              <button type="button" className="assistant-evidence-back" onClick={onBackToCitations}>← 返回引用列表</button>
              <ChunkEvidenceViewer
                key={evidence.key}
                noteId={evidence.citation.noteId}
                chunkId={evidence.citation.chunkId}
                heading={evidence.citation.headingPath}
                onLocated={onLocate}
              />
            </div>
          ) : citations.length === 0 ? (
            <p className="assistant-evidence-status">选择一条引用查看原文。</p>
          ) : (
            <ul className="assistant-context-citations">
              {citations.map((citation) => (
                <li key={citation.evidenceId}>
                  <button type="button" className="assistant-context-citation" onClick={() => onOpenCitation(citation)}>
                    <strong>{citation.noteTitle}</strong>
                    {citation.headingPath.length > 0 && <span>{citation.headingPath.join(' > ')}</span>}
                    <p>{citation.excerpt}</p>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="assistant-context-info">
            {conversation ? (
              <>
                <h4>{conversation.title || '新对话'}</h4>
                <dl>
                  <div><dt>消息数</dt><dd>{conversation.messageCount}</dd></div>
                  <div><dt>更新时间</dt><dd>{new Date(conversation.updatedAt).toLocaleString()}</dd></div>
                </dl>
              </>
            ) : <p className="assistant-evidence-status">选择左侧会话查看会话信息。</p>}
          </div>
        )}
      </div>
    </aside>
  );
}
