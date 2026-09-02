'use client';

import { Plus } from 'lucide-react';
import type { ConversationListItem } from '@/lib/assistant-api';

type Props = {
  items: ConversationListItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  // 合并自计划 2 Task 8：管理操作（重命名弹 prompt；归档/删除直接触发，父级刷新）
  onRename?: (id: string, title: string) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
};

function groupLabel(updatedAt: string, now: number): '今天' | '最近 7 天' | '更早' {
  const diff = now - Date.parse(updatedAt);
  if (diff < 86_400_000) return '今天';
  if (diff < 7 * 86_400_000) return '最近 7 天';
  return '更早';
}

function handleRename(item: ConversationListItem, onRename?: (id: string, title: string) => void) {
  if (!onRename) return;
  const title = window.prompt('重命名会话', item.title || '')?.trim();
  if (title) onRename(item.id, title);
}

export function ConversationList({ items, activeId, onSelect, onNew, onRename, onArchive, onDelete }: Props) {
  const now = Date.now();
  const groups: Array<['今天' | '最近 7 天' | '更早', ConversationListItem[]]> = [['今天', []], ['最近 7 天', []], ['更早', []]];
  for (const item of items) groups.find(([label]) => label === groupLabel(item.updatedAt, now))![1].push(item);

  return (
    <nav className="assistant-conversations" aria-label="会话列表">
      <button type="button" className="assistant-new-conversation" onClick={onNew}><Plus aria-hidden="true" />新建会话</button>
      {groups.map(([label, group]) => group.length === 0 ? null : (
        <section key={label} className="assistant-conversation-group">
          <h4>{label}</h4>
          {group.map((item) => (
            <div key={item.id} className="assistant-conversation-row" data-active={item.id === activeId || undefined}>
              <button
                type="button"
                className="assistant-conversation-select"
                aria-current={item.id === activeId ? 'true' : undefined}
                onClick={() => onSelect(item.id)}
              >
                <span>{item.title || '新对话'}</span>
                <small>{item.messageCount} 条</small>
              </button>
              {(onRename || onArchive || onDelete) && (
                <span className="assistant-conversation-actions">
                  {onRename && <button type="button" aria-label={`重命名 ${item.title || '新对话'}`} onClick={() => handleRename(item, onRename)}>✎</button>}
                  {onArchive && <button type="button" aria-label={`归档 ${item.title || '新对话'}`} onClick={() => onArchive(item.id)}>🗂</button>}
                  {onDelete && <button type="button" aria-label={`删除 ${item.title || '新对话'}`} onClick={() => onDelete(item.id)}>🗑</button>}
                </span>
              )}
            </div>
          ))}
        </section>
      ))}
    </nav>
  );
}
