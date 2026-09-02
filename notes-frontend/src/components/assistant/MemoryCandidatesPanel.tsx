'use client';

import { useState } from 'react';
import {
  type MemoryCandidateView, type MemoryKind, type MemoryScope, MEMORY_KIND_OPTIONS, memoryKindLabel, memoryScopeLabel,
} from '@/lib/assistant-api';

export type CandidateEdits = {
  kind?: MemoryKind; subject?: string; statement?: string; scope?: MemoryScope; validFrom?: string;
};

type Props = {
  items: MemoryCandidateView[];
  // 确认走服务端二次裁决（冲突时由上层弹 MemoryConflictDialog），因此以 (id, edits) 形式回调
  onConfirm: (id: string, edits?: CandidateEdits) => void;
  onReject: (id: string, reason: string) => void;
  onBatchConfirm?: (ids: string[], kind: MemoryKind, scope: MemoryScope) => void;
};

type Draft = { kind: MemoryKind; subject: string; statement: string; scopeType: MemoryScope['type']; scopeId: string };

function sourceLabel(type: string): string {
  return type === 'note_chunk' ? '来自笔记' : '来自对话';
}

const scopeTypes: Array<{ value: MemoryScope['type']; label: string }> = [
  { value: 'global', label: '全局' },
  { value: 'knowledge_base', label: '知识库' },
  { value: 'note', label: '笔记' },
  { value: 'conversation', label: '会话' },
];

export function MemoryCandidatesPanel({ items, onConfirm, onReject, onBatchConfirm }: Props) {
  // 展开的"查看依据"证据（key = candidate id）
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // 修改后确认的内联草稿（key = candidate id，null 表示未打开）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // 拒绝原因输入（key = candidate id）
  const [rejectOpen, setRejectOpen] = useState<Record<string, boolean>>({});
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  // 批量确认预览（key = 分组签名）
  const [batchOpen, setBatchOpen] = useState<Record<string, boolean>>({});

  // 同 kind + 同 scope 的候选聚为一组；仅 ≥2 条才提供批量入口
  const groups = new Map<string, { kind: MemoryKind; scope: MemoryScope; items: MemoryCandidateView[] }>();
  for (const item of items) {
    const key = `${item.kind}|${item.scope.type}|${item.scope.id ?? ''}`;
    const group = groups.get(key) ?? { kind: item.kind, scope: item.scope, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const batchGroups = [...groups.values()].filter((group) => group.items.length >= 2);

  const startEdit = (item: MemoryCandidateView) => {
    setEditingId(item.id);
    setDrafts((prev) => ({ ...prev, [item.id]: {
      kind: item.kind, subject: item.subject, statement: item.statement,
      scopeType: item.scope.type, scopeId: item.scope.id ?? '',
    } }));
  };

  const saveEdit = (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    const edits: CandidateEdits = {
      kind: draft.kind, subject: draft.subject, statement: draft.statement,
      scope: draft.scopeType === 'global' ? { type: 'global' } : { type: draft.scopeType, id: draft.scopeId || undefined },
    };
    onConfirm(id, edits);
    setEditingId(null);
  };

  return (
    <div className="assistant-memory-candidates" data-testid="memory-candidates-panel">
      {batchGroups.map((group) => {
        const key = `${group.kind}|${group.scope.type}|${group.scope.id ?? ''}`;
        const open = Boolean(batchOpen[key]);
        const ids = group.items.map((item) => item.id);
        return (
          <section key={key} className="assistant-memory-batch" aria-label="批量确认候选">
            <p className="assistant-memory-batch-line">
              {group.items.length} 条待确认（{memoryKindLabel(group.kind)} · {memoryScopeLabel(group.scope)}）可批量确认
            </p>
            {!open ? (
              <button type="button" onClick={() => setBatchOpen((prev) => ({ ...prev, [key]: true }))}>批量确认</button>
            ) : (
              <div className="assistant-memory-batch-preview">
                <p className="assistant-memory-batch-preview-title">{`将写入以下 ${group.items.length} 条认知`}</p>
                <ul>
                  {group.items.map((item) => <li key={item.id}>{item.statement}</li>)}
                </ul>
                <div className="assistant-memory-batch-actions">
                  <button type="button" onClick={() => onBatchConfirm?.(ids, group.kind, group.scope)}>
                    确认写入 {group.items.length} 条
                  </button>
                  <button type="button" onClick={() => setBatchOpen((prev) => ({ ...prev, [key]: false }))}>取消</button>
                </div>
              </div>
            )}
          </section>
        );
      })}

      {items.length === 0 ? (
        <p className="assistant-evidence-status">暂无待确认的认知候选</p>
      ) : (
        <ul className="assistant-memory-candidate-list">
          {items.map((item) => {
            const isEditing = editingId === item.id;
            const draft = drafts[item.id];
            return (
              <li key={item.id} className="assistant-memory-candidate">
                <span className="assistant-memory-kind">{memoryKindLabel(item.kind)}</span>
                <div className="assistant-memory-candidate-head">
                  <strong>{item.subject}</strong>
                  <span className="assistant-memory-meta">
                    <span>置信度 {Math.round(item.confidence * 100)}%</span> · <em>{sourceLabel(item.evidence[0]?.type ?? 'message')}</em>
                  </span>
                </div>
                <p className="assistant-memory-statement">{item.statement}</p>

                {expanded[item.id] && (
                  <ul className="assistant-memory-evidence">
                    {item.evidence.map((evidence, index) => (
                      <li key={`${evidence.type}-${index}`}>{evidence.excerpt}</li>
                    ))}
                  </ul>
                )}

                <div className="assistant-memory-candidate-actions">
                  <button type="button" onClick={() => onConfirm(item.id, {})}>确认</button>
                  <button type="button" onClick={() => (isEditing ? setEditingId(null) : startEdit(item))}>修改后确认</button>
                  <button type="button" onClick={() => onReject(item.id, rejectReasons[item.id] ?? '')}>拒绝</button>
                  <button
                    type="button"
                    aria-expanded={Boolean(expanded[item.id])}
                    onClick={() => setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                  >查看依据</button>
                  {!rejectOpen[item.id] ? (
                    <button type="button" onClick={() => setRejectOpen((prev) => ({ ...prev, [item.id]: true }))}>
                      填写拒绝原因
                    </button>
                  ) : (
                    <span className="assistant-memory-reject-inline">
                      <textarea
                        aria-label="拒绝原因"
                        value={rejectReasons[item.id] ?? ''}
                        onChange={(event) => setRejectReasons((prev) => ({ ...prev, [item.id]: event.target.value }))}
                      />
                      <button type="button" onClick={() => { onReject(item.id, rejectReasons[item.id] ?? ''); setRejectOpen((prev) => ({ ...prev, [item.id]: false })); }}>
                        确认拒绝
                      </button>
                    </span>
                  )}
                </div>

                {isEditing && draft && (
                  <div className="assistant-memory-edit" role="group" aria-label="修改后确认表单">
                    <label>类型
                      <select
                        aria-label="类型"
                        value={draft.kind}
                        onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, kind: event.target.value as MemoryKind } }))}
                      >
                        {MEMORY_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label>主题
                      <input
                        aria-label="主题"
                        value={draft.subject}
                        onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, subject: event.target.value } }))}
                      />
                    </label>
                    <label>表述
                      <textarea
                        aria-label="表述"
                        value={draft.statement}
                        onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, statement: event.target.value } }))}
                      />
                    </label>
                    <label>适用范围
                      <select
                        aria-label="适用范围"
                        value={draft.scopeType}
                        onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, scopeType: event.target.value as MemoryScope['type'] } }))}
                      >
                        {scopeTypes.map((scope) => <option key={scope.value} value={scope.value}>{scope.label}</option>)}
                      </select>
                    </label>
                    {draft.scopeType !== 'global' && (
                      <label>范围 ID
                        <input
                          aria-label="范围 ID"
                          value={draft.scopeId}
                          onChange={(event) => setDrafts((prev) => ({ ...prev, [item.id]: { ...draft, scopeId: event.target.value } }))}
                        />
                      </label>
                    )}
                    <div className="assistant-memory-edit-actions">
                      <button type="button" onClick={() => saveEdit(item.id)}>保存修改</button>
                      <button type="button" onClick={() => setEditingId(null)}>取消</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
