'use client';

import { useState } from 'react';
import { type MemoryScope, type MemoryResolveAction } from '@/lib/assistant-api';

export type MemoryConflictEntity = { memoryId: string; subject: string; statement: string; scope?: MemoryScope };

// 'modify' 为前端流动作：返回候选编辑表单，其余动作直接对应后端 resolveConflict
export type MemoryConflictAction = MemoryResolveAction | { type: 'modify' };

type Props = {
  // 新确认时发生冲突的结论；existing 是范围/主题重叠的既有已确认节点
  conflict: MemoryConflictEntity;
  existing: MemoryConflictEntity;
  onResolve: (memoryId: string, action: MemoryConflictAction) => void;
};

const scopeOptions: Array<{ value: MemoryScope['type']; label: string }> = [
  { value: 'global', label: '全局' },
  { value: 'knowledge_base', label: '知识库' },
  { value: 'note', label: '笔记' },
  { value: 'conversation', label: '会话' },
];

export function MemoryConflictDialog({ conflict, existing, onResolve }: Props) {
  const [keepBothOpen, setKeepBothOpen] = useState(false);
  const [chosenScope, setChosenScope] = useState<MemoryScope['type'] | ''>('');
  // 既有节点缺省按全局判定：未改范围直接保留会让后端拒绝 keep_both
  const existingScopeType = existing.scope?.type ?? 'global';
  const canKeepBoth = chosenScope !== '' && chosenScope !== existingScopeType;

  return (
    <div className="assistant-memory-conflict" role="dialog" aria-label="认知冲突解决" data-testid="memory-conflict-dialog">
      <div className="assistant-memory-conflict-pair">
        <section className="assistant-memory-conflict-side" data-side="existing">
          <h5>既有结论</h5>
          <p className="assistant-memory-conflict-statement">{existing.statement}</p>
          <span className="assistant-memory-conflict-subject">{existing.subject}</span>
        </section>
        <section className="assistant-memory-conflict-side" data-side="new">
          <h5>新结论</h5>
          <p className="assistant-memory-conflict-statement">{conflict.statement}</p>
          <span className="assistant-memory-conflict-subject">{conflict.subject}</span>
        </section>
      </div>

      <div className="assistant-memory-conflict-options">
        <button
          type="button"
          onClick={() => onResolve(conflict.memoryId, { type: 'supersede', targetMemoryId: existing.memoryId })}
        >用新结论替代旧结论</button>

        {!keepBothOpen ? (
          <button type="button" onClick={() => setKeepBothOpen(true)}>两者适用不同场景</button>
        ) : (
          <div className="assistant-memory-conflict-scope">
            <p>保留两条需先为新结论调整适用范围</p>
            <label>新结论范围
              <select
                aria-label="新结论范围"
                value={chosenScope}
                onChange={(event) => setChosenScope(event.target.value as MemoryScope['type'])}
              >
                <option value="">请选择范围</option>
                {scopeOptions.map((scope) => <option key={scope.value} value={scope.value}>{scope.label}</option>)}
              </select>
            </label>
            <div>
              <button
                type="button"
                disabled={!canKeepBoth}
                onClick={() => onResolve(conflict.memoryId, { type: 'keep_both' })}
              >按新范围保留两者</button>
              <button type="button" onClick={() => setKeepBothOpen(false)}>取消</button>
            </div>
          </div>
        )}

        <button type="button" onClick={() => onResolve(conflict.memoryId, { type: 'modify' })}>修改新结论</button>
        <button type="button" onClick={() => onResolve(conflict.memoryId, { type: 'reject_memory' })}>拒绝新候选</button>
      </div>
    </div>
  );
}
