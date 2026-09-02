'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ConversationListItem } from '@/lib/assistant-api';
import {
  type MemoryCandidateView, type MemoryKind, type MemoryScope, type MemoryView,
  batchConfirmMemoryCandidates, confirmMemoryCandidate, deleteMemory, fetchMemories,
  fetchMemoryCandidates, refreshMemoryEvidence, rejectMemoryCandidate, resolveMemoryConflict,
} from '@/lib/assistant-api';
import type { RagCitation } from '@/lib/assistant-stream-client';
import ChunkEvidenceViewer from './ChunkEvidenceViewer';
import { type CandidateEdits, MemoryCandidatesPanel } from './MemoryCandidatesPanel';
import { MemoryTimeline } from './MemoryTimeline';
import { type MemoryConflictAction, type MemoryConflictEntity, MemoryConflictDialog } from './MemoryConflictDialog';

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

// 认知标签数据不依赖某个会话（按用户维度），由面板自行拉取；
// 工作台的 panelTab 仍只管理 citations/info，认知视图在面板内部切换（阶段四 Task 7）
type ConflictPair = { conflict: MemoryConflictEntity; existing: MemoryConflictEntity };

export default function AssistantContextPanel({ tab, onTabChange, citations, evidence, conversation, open, onOpenCitation, onBackToCitations, onClosePanel, onLocate }: Props) {
  const [cognitionOpen, setCognitionOpen] = useState(false);
  const [candidates, setCandidates] = useState<MemoryCandidateView[]>([]);
  const [memories, setMemories] = useState<MemoryView[]>([]);
  const [cognitionLoading, setCognitionLoading] = useState(false);
  const [cognitionError, setCognitionError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictPair | null>(null);
  // 时间线分组选择：subject + scope 聚合（记忆按用户维度、可能跨会话）
  const [activeGroup, setActiveGroup] = useState<string>('');

  // 候选与记忆各自独立降级：一个源失败（如后端记忆端点未落地）不拖垮另一个源
  const loadCognition = useCallback(async () => {
    setCognitionLoading(true);
    setCognitionError(null);
    const [candidateResult, memoryResult] = await Promise.all([
      fetchMemoryCandidates()
        .then((items): { items: MemoryCandidateView[]; error?: string } => ({ items }))
        .catch((): { items: MemoryCandidateView[]; error?: string } => ({ items: [], error: '认知候选加载失败，请稍后重试。' })),
      fetchMemories(true)
        .then((items): { items: MemoryView[]; error?: string } => ({ items }))
        .catch((): { items: MemoryView[]; error?: string } => ({ items: [], error: '认知加载失败，请稍后重试。' })),
    ]);
    setCandidates(candidateResult.items);
    setMemories(memoryResult.items);
    setCognitionError(candidateResult.error ?? memoryResult.error ?? null);
    setCognitionLoading(false);
  }, []);

  // 关闭面板（或切会话由工作台关闭）后认知视图复位到引用标签
  useEffect(() => {
    if (!open) setCognitionOpen(false);
  }, [open]);

  // 上层打开引用（evidence）/外部切换 tab（含导航恢复）时退出认知视图，避免认知遮蔽引用导航
  useEffect(() => {
    if (evidence || tab === 'info') setCognitionOpen(false);
  }, [evidence, tab]);

  const openCognition = () => {
    setCognitionOpen(true);
    void loadCognition();
  };

  const pickCitationsTab = () => { setCognitionOpen(false); onTabChange('citations'); };
  const pickInfoTab = () => { setCognitionOpen(false); onTabChange('info'); };

  const handleConfirmCandidate = (id: string, edits?: CandidateEdits) => {
    void confirmMemoryCandidate(id, edits)
      .then((result) => {
        if (result.conflict) {
          const current = candidates.find((item) => item.id === id);
          // conflict 字段来自服务端：被重叠的既有已确认节点；新结论以确认结果为准
          setConflict({
            conflict: {
              memoryId: result.memoryId || id,
              subject: edits?.subject ?? current?.subject ?? '',
              statement: edits?.statement ?? current?.statement ?? '',
              scope: edits?.scope ?? current?.scope,
            },
            existing: result.conflict,
          });
        }
      })
      .catch(() => setCognitionError('候选确认失败，请稍后重试。'))
      .finally(() => { void loadCognition(); });
  };

  const handleRejectCandidate = (id: string, reason: string) => {
    void rejectMemoryCandidate(id, reason)
      .catch(() => setCognitionError('候选拒绝失败，请稍后重试。'))
      .finally(() => { void loadCognition(); });
  };

  const handleBatchConfirm = (ids: string[], kind: MemoryKind, scope: MemoryScope) => {
    void batchConfirmMemoryCandidates(ids, kind, scope)
      .catch(() => setCognitionError('批量确认失败，请稍后重试。'))
      .finally(() => { void loadCognition(); });
  };

  const handleResolveConflict = (memoryId: string, action: MemoryConflictAction) => {
    setConflict(null);
    if (action.type === 'modify') {
      // 修改新结论：候选此时已被物化确认并挂起（不在 pending 列表），先 resolve reject_memory
      // 让后端删除该记忆并把候选退回 pending，刷新后重新出现在待确认列表供编辑重提
      void resolveMemoryConflict(memoryId, { type: 'reject_memory' })
        .catch(() => setCognitionError('冲突解决失败，请稍后重试。'))
        .finally(() => { void loadCognition(); });
      return;
    }
    void resolveMemoryConflict(memoryId, action)
      .catch(() => setCognitionError('冲突解决失败，请稍后重试。'))
      .finally(() => { void loadCognition(); });
  };

  const handleDeleteMemory = (id: string) => {
    void deleteMemory(id)
      .catch(() => setCognitionError('认知删除失败，请稍后重试。'))
      .finally(() => { void loadCognition(); });
  };

  const handleRefreshEvidence = (id: string) => {
    void refreshMemoryEvidence(id)
      .catch(() => setCognitionError('证据刷新失败，请稍后重试。'))
      .finally(() => { void loadCognition(); });
  };

  // 按 subject + scope 分组时间线；activeGroup 落空时回退到第一组
  const groupKeyOf = (item: MemoryView) => `${item.subject}\u0000${item.scope.type}|${item.scope.id ?? ''}`;
  const groups = new Map<string, { subject: string; scope: MemoryScope; items: MemoryView[] }>();
  for (const item of memories) {
    const key = groupKeyOf(item);
    const group = groups.get(key) ?? { subject: item.subject, scope: item.scope, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const groupEntries = [...groups.entries()];
  const resolvedKey = groupEntries.some(([key]) => key === activeGroup) ? activeGroup : (groupEntries[0]?.[0] ?? '');
  const activeTimeline = resolvedKey ? groupEntries.find(([key]) => key === resolvedKey)?.[1] : undefined;

  const cognitionActive = cognitionOpen;
  const activeTab = cognitionActive ? 'cognition' : tab;

  return (
    <aside className={`assistant-workspace-context assistant-context-panel${open ? ' is-open' : ''}`} aria-label="上下文面板">
      <header className="assistant-context-head">
        <div className="assistant-context-tabs" aria-label="上下文标签">
          <button type="button" aria-pressed={activeTab === 'citations'} className={activeTab === 'citations' ? 'is-active' : ''} onClick={pickCitationsTab}>引用</button>
          <button type="button" aria-pressed={activeTab === 'cognition'} className={activeTab === 'cognition' ? 'is-active' : ''} onClick={openCognition}>
            认知{candidates.length > 0 && <span className="assistant-context-tab-badge">{candidates.length}</span>}
          </button>
          <button type="button" aria-pressed={activeTab === 'info'} className={activeTab === 'info' ? 'is-active' : ''} onClick={pickInfoTab}>会话信息</button>
        </div>
        <button type="button" className="assistant-context-close" aria-label="关闭上下文面板" onClick={onClosePanel}><X aria-hidden="true" /></button>
      </header>
      <div className="assistant-context-body">
        {cognitionActive ? (
          <div className="assistant-context-cognition">
            {conflict && (
              <div className="assistant-context-conflict">
                <MemoryConflictDialog
                  conflict={conflict.conflict}
                  existing={conflict.existing}
                  onResolve={handleResolveConflict}
                />
              </div>
            )}
            {cognitionError && <p className="assistant-message-warning">{cognitionError}</p>}
            <section className="assistant-context-cognition-section">
              <h4 className="assistant-context-cognition-title">待确认候选</h4>
              {cognitionLoading && candidates.length === 0 ? (
                <p className="assistant-evidence-status">候选加载中…</p>
              ) : (
                <MemoryCandidatesPanel
                  items={candidates}
                  onConfirm={handleConfirmCandidate}
                  onReject={handleRejectCandidate}
                  onBatchConfirm={handleBatchConfirm}
                />
              )}
            </section>
            <section className="assistant-context-cognition-section">
              <h4 className="assistant-context-cognition-title">已确认认知</h4>
              {groupEntries.length === 0 ? (
                <p className="assistant-evidence-status">确认的认知将在这里沉淀。</p>
              ) : (
                <>
                  <div className="assistant-context-subject-list" role="group" aria-label="认知主题">
                    {groupEntries.map(([key, group]) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={key === resolvedKey}
                        className={key === resolvedKey ? 'is-active' : ''}
                        onClick={() => setActiveGroup(key)}
                      >{group.subject}</button>
                    ))}
                  </div>
                  {activeTimeline && (
                    <MemoryTimeline
                      subject={activeTimeline.subject}
                      scope={activeTimeline.scope}
                      items={activeTimeline.items}
                      onDelete={handleDeleteMemory}
                      onRefreshEvidence={handleRefreshEvidence}
                    />
                  )}
                </>
              )}
            </section>
          </div>
        ) : tab === 'citations' ? (
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
