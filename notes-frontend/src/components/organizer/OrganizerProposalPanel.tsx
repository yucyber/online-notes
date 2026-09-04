'use client';

import { useId } from 'react';
import type { OrganizerProposal, OrganizerProposalAction } from './organizer-types';
import OrganizerActionDiff from './OrganizerActionDiff';
import type { NoteTitleMap } from './organizer-note-names';

const ACTION_TYPE_LABELS: Record<OrganizerProposalAction['type'], string> = {
  create_knowledge_base: '创建知识库',
  move_note: '移入知识库',
  add_tag: '添加标签',
  set_category: '设置分类',
  merge_notes: '合并笔记',
  split_note: '拆分笔记',
  rewrite_note: '改写内容',
};

const PROPOSAL_STATUS_LABELS: Record<OrganizerProposal['status'], string> = {
  pending: '待处理',
  stale: '需刷新',
  confirmed: '已确认',
};

export interface OrganizerProposalPanelProps {
  proposal: OrganizerProposal;
  selectedActionIds?: string[];
  noteTitles?: NoteTitleMap;
  onToggleAction?: (actionId: string, checked: boolean) => void;
  onRenameKnowledgeBase?: (actionId: string, name: string) => void;
  onRework?: (actionId: string) => void;
  onExecute?: () => void;
  executing?: boolean;
}

export default function OrganizerProposalPanel({
  proposal,
  selectedActionIds = [],
  noteTitles,
  onToggleAction,
  onRenameKnowledgeBase,
  onRework,
  onExecute,
  executing = false,
}: OrganizerProposalPanelProps) {
  const titleId = useId();
  const selected = new Set(selectedActionIds);
  const selectedActions = proposal.actions.filter((action) => selected.has(action.actionId));
  const highRiskCount = selectedActions.filter((action) => action.riskLevel === 'high').length;

  return (
    <section className="organizer-proposal-panel" aria-labelledby={titleId} data-testid="organizer-proposal-panel">
      <header>
        <h2 id={titleId}>{proposal.summary || '整理提案'}</h2>
        <div className="organizer-proposal-meta">
          <span>Revision {proposal.revision}</span>
          <span className={`proposal-status proposal-status-${proposal.status}`} data-testid="proposal-status"><span className="organizer-status-raw">{proposal.status}</span>{PROPOSAL_STATUS_LABELS[proposal.status]}</span>
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
            noteTitles={noteTitles}
            onToggle={onToggleAction}
            onRename={onRenameKnowledgeBase}
            onRework={onRework}
          />
        ))}
      </div>

      {onExecute && proposal.actions.length > 0 ? (
        <div className="organizer-execute-bar">
          <button
            type="button"
            className="prototype-button prototype-button--primary"
            disabled={executing || proposal.status !== 'pending' || selectedActions.length === 0}
            onClick={onExecute}
          >
            {executing ? '执行中...' : '执行所选建议'}
          </button>
          <span className="organizer-execute-meta">
            已选 {selectedActions.length} 条
            {highRiskCount > 0 ? `，其中 ${highRiskCount} 条高风险需二次确认` : ''}
            {proposal.status === 'stale' ? '，提案已过期需先返工' : ''}
            {proposal.status === 'confirmed' ? '，该提案已执行过，不能再执行' : ''}
          </span>
        </div>
      ) : proposal.actions.length > 0 && !onRework && (
        <p className="organizer-readonly-hint" data-testid="no-execute-hint">此页面只生成确认清单，不会自动执行任何修改。</p>
      )}
    </section>
  );
}

function OrganizerProposalActionRow({
  action,
  checked,
  noteTitles,
  onToggle,
  onRename,
  onRework,
}: {
  action: OrganizerProposalAction;
  checked: boolean;
  noteTitles?: NoteTitleMap;
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
        <label htmlFor={checkboxId} className="organizer-action-id">{action.actionId}</label>
        <span className="organizer-action-kind">{ACTION_TYPE_LABELS[action.type]}</span>
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

      <OrganizerActionDiff action={action} noteTitles={noteTitles} />

      {action.evidenceChunkIds.length > 0 && (
        <div className="organizer-evidence">
          <span>证据：</span>
          {action.evidenceChunkIds.map((chunkId) => <code key={chunkId} data-testid="evidence-chunk">{chunkId}</code>)}
        </div>
      )}
    </article>
  );
}
