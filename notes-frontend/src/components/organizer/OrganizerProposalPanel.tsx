'use client';

import { useId } from 'react';
import type { OrganizerProposal, OrganizerProposalAction } from './organizer-types';
import OrganizerActionDiff from './OrganizerActionDiff';

export interface OrganizerProposalPanelProps {
  proposal: OrganizerProposal;
  selectedActionIds?: string[];
  onToggleAction?: (actionId: string, checked: boolean) => void;
  onRenameKnowledgeBase?: (actionId: string, name: string) => void;
  onRework?: (actionId: string) => void;
}

export default function OrganizerProposalPanel({
  proposal,
  selectedActionIds = [],
  onToggleAction,
  onRenameKnowledgeBase,
  onRework,
}: OrganizerProposalPanelProps) {
  const titleId = useId();
  const selected = new Set(selectedActionIds);

  return (
    <section className="organizer-proposal-panel" aria-labelledby={titleId} data-testid="organizer-proposal-panel">
      <header>
        <h2 id={titleId}>{proposal.summary || '整理提案'}</h2>
        <div className="organizer-proposal-meta">
          <span>Revision {proposal.revision}</span>
          <span className={`proposal-status-${proposal.status}`} data-testid="proposal-status">{proposal.status}</span>
        </div>
      </header>

      {proposal.status === 'stale' && (
        <p className="organizer-warning">部分笔记已更新，执行前需要返工。</p>
      )}

      <div className="organizer-action-list">
        {proposal.actions.map((action) => (
          <OrganizerProposalActionRow
            key={action.actionId}
            action={action}
            checked={selected.has(action.actionId)}
            onToggle={onToggleAction}
            onRename={onRenameKnowledgeBase}
            onRework={onRework}
          />
        ))}
      </div>

      {proposal.actions.length > 0 && !onRework && (
        <p className="organizer-readonly-hint" data-testid="no-execute-hint">此页面只生成确认清单，不会自动执行任何修改。</p>
      )}
    </section>
  );
}

function OrganizerProposalActionRow({
  action,
  checked,
  onToggle,
  onRename,
  onRework,
}: {
  action: OrganizerProposalAction;
  checked: boolean;
  onToggle?: (actionId: string, checked: boolean) => void;
  onRename?: (actionId: string, name: string) => void;
  onRework?: (actionId: string) => void;
}) {
  const checkboxId = `organizer-check-${action.actionId}`;
  return (
    <article className="organizer-action-card" data-testid={`proposal-action-${action.actionId}`}>
      <div className="organizer-action-header">
        <input
          id={checkboxId}
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle?.(action.actionId, event.target.checked)}
          disabled={!onToggle}
        />
        <label htmlFor={checkboxId}>{action.actionId}</label>
        {action.type === 'create_knowledge_base' && onRename && (
          <input
            aria-label="知识库名称"
            className="organizer-kb-name"
            defaultValue={action.knowledgeBaseName || ''}
            onBlur={(event) => onRename(action.actionId, event.target.value)}
          />
        )}
        {action.type === 'create_knowledge_base' && !onRename && action.knowledgeBaseName && (
          <strong>{action.knowledgeBaseName}</strong>
        )}
        {onRework && <button type="button" onClick={() => onRework(action.actionId)}>返工</button>}
      </div>

      <OrganizerActionDiff action={action} />

      {action.evidenceChunkIds.length > 0 && (
        <div className="organizer-evidence">
          <span>证据：</span>
          {action.evidenceChunkIds.map((chunkId) => <code key={chunkId} data-testid="evidence-chunk">{chunkId}</code>)}
        </div>
      )}
    </article>
  );
}
