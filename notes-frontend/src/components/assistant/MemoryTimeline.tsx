'use client';

import { useState } from 'react';
import { type MemoryScope, type MemoryView, memoryKindLabel, memoryScopeLabel } from '@/lib/assistant-api';

type Props = {
  subject?: string;
  scope?: MemoryScope;
  items: MemoryView[];
  // 删除 / 刷新证据（仅当前有效条目；stale 时显示刷新入口）
  onDelete?: (id: string) => void;
  onRefreshEvidence?: (id: string) => void;
};

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function MemoryTimeline({ subject, scope, items, onDelete, onRefreshEvidence }: Props) {
  // 默认只读"当前有效"；切换到"演进过程"展示完整链
  const [mode, setMode] = useState<'current' | 'history'>('current');

  const current = items.filter((item) => item.status === 'confirmed');
  const history = [...items].sort((a, b) => String(a.validFrom ?? '').localeCompare(String(b.validFrom ?? '')));

  return (
    <div className="assistant-memory-timeline" aria-label={subject ? `${subject} 认知时间线` : '认知时间线'}>
      <div className="assistant-memory-timeline-head">
        {subject && <h4>{subject}{scope ? `（${memoryScopeLabel(scope)}）` : ''}</h4>}
        <div className="assistant-memory-timeline-tabs" role="group" aria-label="时间线视图">
          <button
            type="button"
            aria-pressed={mode === 'current'}
            onClick={() => setMode('current')}
          >当前有效</button>
          <button
            type="button"
            aria-pressed={mode === 'history'}
            onClick={() => setMode('history')}
          >演进过程</button>
        </div>
      </div>

      {mode === 'current' ? (
        current.length === 0 ? (
          <p className="assistant-evidence-status">当前暂无有效认知</p>
        ) : (
          <ul className="assistant-memory-current-list">
            {current.map((item) => (
              <li key={item.id} className="assistant-memory-current">
                <div className="assistant-memory-current-main">
                  <span className="assistant-memory-kind">{memoryKindLabel(item.kind)}</span>
                  <p className="assistant-memory-statement">{item.statement}</p>
                  {item.evidenceStatus === 'stale' && (
                    <span className="assistant-memory-stale" style={{
                      display: 'inline-block', padding: '1px 8px', borderRadius: 999,
                      background: 'var(--product-danger-soft)', color: 'var(--product-danger)',
                      fontSize: 10, fontWeight: 600,
                    }}>证据待复核</span>
                  )}
                </div>
                <div className="assistant-memory-current-actions">
                  {item.evidenceStatus === 'stale' && onRefreshEvidence && (
                    <button type="button" onClick={() => onRefreshEvidence(item.id)}>刷新证据</button>
                  )}
                  {onDelete && <button type="button" onClick={() => onDelete(item.id)}>删除</button>}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className="assistant-memory-history-list">
          {history.map((item) => (
            <li key={item.id} className="assistant-memory-history">
              <div className="assistant-memory-history-main">
                <span className="assistant-memory-kind">{memoryKindLabel(item.kind)}</span>
                <p className="assistant-memory-statement">{item.statement}</p>
                {item.status === 'superseded' && (
                  <span className="assistant-memory-superseded" style={{
                    display: 'inline-block', padding: '1px 8px', borderRadius: 999,
                    background: 'var(--product-surface-hover)', color: 'var(--product-muted)',
                    fontSize: 10, fontWeight: 600,
                  }}>已被替代</span>
                )}
              </div>
              <span className="assistant-memory-history-meta">
                {formatDate(item.validFrom)}{item.validTo ? ` → ${formatDate(item.validTo)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
