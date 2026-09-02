'use client';

import { BookOpen, Square } from 'lucide-react';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  generating: boolean;
  forceNotes: boolean;
  onToggleForceNotes: () => void;
  placeholder?: string;
};

export default function AssistantCompose({ value, onChange, onSend, onStop, generating, forceNotes, onToggleForceNotes, placeholder = '问问小助手…' }: Props) {
  return (
    <div className="ink-compose-wrap">
      <button type="button" className="ink-note-toggle" aria-pressed={forceNotes} onClick={onToggleForceNotes}>
        <BookOpen aria-hidden="true" />搜索笔记
      </button>
      <div className="ink-compose-real">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend(); }
          }}
          placeholder={placeholder}
        />
        {generating && onStop
          ? <button type="button" onClick={onStop} aria-label="停止生成"><Square aria-hidden="true" /></button>
          : <button type="button" onClick={onSend} disabled={!value.trim()} aria-label="发送">↑</button>}
      </div>
    </div>
  );
}
