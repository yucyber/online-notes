'use client';

import type { OrganizerProposalAction } from './organizer-types';

const TYPE_LABELS: Record<OrganizerProposalAction['type'], string> = {
  create_knowledge_base: '创建知识库',
  move_note: '移入知识库',
  add_tag: '添加标签',
  set_category: '设置分类',
  merge_notes: '合并笔记',
  split_note: '拆分笔记',
  rewrite_note: '改写内容',
};

function formatText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export default function OrganizerActionDiff({ action }: { action: OrganizerProposalAction }) {
  const payload = action.payload || {};
  return (
    <div className="organizer-action-diff" data-testid={`diff-${action.actionId}`}>
      <div className="organizer-diff-heading">
        <strong>{TYPE_LABELS[action.type]}</strong>
        <span className={`risk-${action.riskLevel}`}>{action.riskLevel === 'high' ? '高风险' : '低风险'}</span>
      </div>
      <p className="organizer-reason">{action.reason || '无补充说明'}</p>

      {action.type === 'rewrite_note' && (
        <div className="organizer-diff-content">
          <p><strong>建议正文：</strong></p>
          <pre data-testid="rewrite-body">{formatText(payload.body, formatText(payload.suggestion, '（未提供正文草案）'))}</pre>
        </div>
      )}

      {action.type === 'split_note' && (
        <div className="organizer-diff-content">
          <p><strong>拆分去向：</strong></p>
          <ul>
            {(Array.isArray(payload.sections) ? payload.sections : []).map((section: any, index: number) => (
              <li key={`${action.actionId}-section-${index}`}>{formatText(section?.title, `片段 ${index + 1}`)}：{formatText(section?.summary, '')}</li>
            ))}
          </ul>
        </div>
      )}

      {action.type === 'merge_notes' && (
        <div className="organizer-diff-content">
          <p><strong>合并目标：</strong>{formatText(payload.targetTitle, action.targetNoteId || '待定')}</p>
          <p><strong>来源笔记：</strong>{action.noteIds.join('、')}</p>
        </div>
      )}

      {['add_tag', 'set_category', 'move_note', 'create_knowledge_base'].includes(action.type) && (
        <div className="organizer-diff-content">
          {action.type === 'add_tag' && <p><strong>标签：</strong>{action.tagName || action.tagId || '待定'}</p>}
          {action.type === 'set_category' && <p><strong>分类：</strong>{action.categoryName || action.categoryId || '待定'}</p>}
          {(action.type === 'move_note' || action.type === 'create_knowledge_base') && (
            <p><strong>知识库：</strong>{action.knowledgeBaseName || action.knowledgeBaseId || '新建知识库'}</p>
          )}
          <p><strong>涉及笔记：</strong>{action.noteIds.join('、')}</p>
        </div>
      )}
    </div>
  );
}
