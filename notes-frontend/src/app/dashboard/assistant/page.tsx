'use client';

import { Suspense } from 'react';
import { AssistantWorkspace } from '@/components/assistant/AssistantWorkspace';
import '@/styles/assistant-workspace.css';

export default function AssistantPage() {
  return (
    <Suspense fallback={<div className="assistant-workspace-loading">正在打开小助手工作台…</div>}>
      <AssistantWorkspace />
    </Suspense>
  );
}
