'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import OrganizerProposalPanel from '@/components/organizer/OrganizerProposalPanel'
import type { OrganizerExecution, OrganizerProposal, OrganizerProposalAction } from '@/components/organizer/organizer-types'
import { noteLabel, noteListLabel, type NoteTitleMap } from '@/components/organizer/organizer-note-names'
import { notesAPI } from '@/lib/api/notes'
import { organizerAPI } from '@/lib/api/organizer'

const ACTION_TYPE_LABELS: Record<OrganizerProposalAction['type'], string> = {
  create_knowledge_base: '创建知识库并归属笔记',
  move_note: '移入知识库',
  add_tag: '添加标签',
  set_category: '设置分类',
  merge_notes: '归档来源并合并',
  split_note: '归档原笔记并拆分',
  rewrite_note: '改写笔记内容',
}

function apiErrorMessage(error: any, fallback: string) {
  return String(error?.response?.data?.message || error?.message || fallback)
}

function requestIdOf(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

type DialogStep = 'review' | 'execute-confirm' | 'undo-confirm'

export default function AssistantOrganizerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [step, setStep] = useState<DialogStep>('review')
  const [proposals, setProposals] = useState<OrganizerProposal[]>([])
  const [activeProposalId, setActiveProposalId] = useState('')
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([])
  const [executions, setExecutions] = useState<OrganizerExecution[]>([])
  const [noteTitles, setNoteTitles] = useState<NoteTitleMap>({})
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [undoingExecutionId, setUndoingExecutionId] = useState('')
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null)
  const [undoConflicts, setUndoConflicts] = useState<Array<{ noteId: string; message: string }>>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const fetchedTitleIdsRef = useRef<Set<string>>(new Set())
  const activeProposalIdRef = useRef('')

  useEffect(() => { activeProposalIdRef.current = activeProposalId }, [activeProposalId])

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [proposalList, executionList] = await Promise.all([
        organizerAPI.listProposals(),
        organizerAPI.listExecutions(),
      ])
      setProposals(proposalList)
      setExecutions(executionList)
      const currentId = activeProposalIdRef.current
      const nextActive = currentId && proposalList.some((item) => item.id === currentId)
        ? currentId
        : proposalList[0]?.id || ''
      setActiveProposalId(nextActive)
      const active = proposalList.find((item) => item.id === nextActive)
      setSelectedActionIds(active?.actions?.map((action) => action.actionId) || [])
    } catch (err: any) {
      setError(apiErrorMessage(err, '加载整理提案失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setStep('review')
    setError('')
    setMessage('')
    setUndoConflicts([])
    void loadAll()
  }, [open, loadAll])

  // 提案里只有 noteId，按 ids 拉标题，界面上显示笔记名称而不是裸 ID。
  useEffect(() => {
    const wanted = new Set<string>()
    proposals.forEach((proposal) => proposal.actions.forEach((action) => {
      action.noteIds.forEach((id) => wanted.add(id))
      if (action.targetNoteId) wanted.add(action.targetNoteId)
      if (action.sourceNoteId) wanted.add(action.sourceNoteId)
    }))
    const missing = [...wanted].filter((id) => !noteTitles[id] && !fetchedTitleIdsRef.current.has(id))
    if (missing.length === 0) return
    missing.forEach((id) => fetchedTitleIdsRef.current.add(id))
    notesAPI.getAll({ ids: missing, size: Math.max(100, missing.length) }).then((data) => {
      setNoteTitles((current) => {
        const next = { ...current }
        data.items.forEach((note) => { next[note.id] = note.title || note.id })
        return next
      })
    }).catch(() => undefined)
  }, [proposals, noteTitles])

  const activeProposal = proposals.find((item) => item.id === activeProposalId)
  const selectedActions = activeProposal?.actions.filter((action) => selectedActionIds.includes(action.actionId)) || []
  const selectedHasHighRisk = selectedActions.some((action) => action.riskLevel === 'high')

  const runAgentNow = async () => {
    setGenerating(true)
    setMessage('')
    setError('')
    try {
      const result = await organizerAPI.runAgent()
      if (result.generated && result.proposal) {
        setMessage('小助手已生成新的整理提案')
        activeProposalIdRef.current = result.proposal.id
        await loadAll()
      } else {
        setMessage(result.reason === 'pending_exists'
          ? '已有一条待确认提案，先处理它再生成新的'
          : '暂时没有可生成的整理建议')
      }
    } catch (err: any) {
      setError(apiErrorMessage(err, '生成整理提案失败'))
    } finally {
      setGenerating(false)
    }
  }

  const toggleAction = (actionId: string, checked: boolean) => {
    setSelectedActionIds((current) => checked
      ? Array.from(new Set([...current, actionId]))
      : current.filter((id) => id !== actionId))
  }

  const executeSelected = async () => {
    const proposal = activeProposal
    if (!proposal || selectedActionIds.length === 0) return
    setExecuting(true)
    setError('')
    try {
      await organizerAPI.executeProposal(proposal.id, selectedActionIds, requestIdOf('assistant-organizer-exec'))
      setMessage('整理已执行，可在 30 天内整批撤销')
      setStep('review')
      await loadAll()
    } catch (err: any) {
      const errText = apiErrorMessage(err, '执行失败')
      const staleBlocked = /updated after proposal|stale/i.test(errText)
      setError(staleBlocked
        ? `${errText}。相关笔记在提案生成后已被编辑，请重新生成提案后再执行。`
        : errText)
      if (staleBlocked) await loadAll()
    } finally {
      setExecuting(false)
    }
  }

  const undoExecution = async () => {
    const id = pendingUndoId
    if (!id) return
    setUndoingExecutionId(id)
    setError('')
    setUndoConflicts([])
    try {
      const result = await organizerAPI.undoExecution(id, requestIdOf('assistant-organizer-undo'))
      if (result.ok) {
        setMessage('已整批撤销该次整理')
        setStep('review')
        setPendingUndoId(null)
      } else {
        setUndoConflicts(result.conflicts || [])
        setMessage(`撤销被阻止，共 ${result.conflicts?.length || 0} 个冲突需要人工处理`)
      }
      await loadAll()
    } catch (err: any) {
      setError(apiErrorMessage(err, '撤销失败'))
    } finally {
      setUndoingExecutionId('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !executing && !undoingExecutionId) onOpenChange(next) }}>
      <DialogContent className="assistant-organizer-dialog max-w-2xl">
        <DialogHeader>
          <DialogTitle>小助手整理提案</DialogTitle>
          <DialogDescription>
            {step === 'execute-confirm'
              ? '请再次确认本次整理范围，执行后可在 30 天内整批撤销。'
              : step === 'undo-confirm'
                ? '撤销会恢复执行前的笔记状态；若笔记之后被你编辑过，会列出冲突而不是覆盖。'
                : '小助手可定期生成整理提案；执行前需要你在这里确认，不会自动修改笔记。'}
          </DialogDescription>
        </DialogHeader>

        {message && <p className="assistant-organizer-message" data-testid="assistant-organizer-message">{message}</p>}
        {error && <p className="organizer-execute-error" data-testid="assistant-organizer-error" role="alert">{error}</p>}

        {step === 'review' && (
          <div className="assistant-organizer-body">
            <div className="assistant-organizer-toolbar">
              <Button variant="outline" size="sm" disabled={generating || loading} onClick={() => void runAgentNow()}>
                {generating ? '生成中...' : '立即生成提案'}
              </Button>
              <span className="assistant-organizer-toolbar__meta">
                {loading ? '加载中...' : `${proposals.length} 条提案 / ${executions.length} 条执行记录`}
              </span>
            </div>

            {proposals.length > 1 && (
              <select
                className="assistant-organizer-proposal-select"
                value={activeProposalId}
                onChange={(event) => {
                  const nextId = event.target.value
                  setActiveProposalId(nextId)
                  const next = proposals.find((item) => item.id === nextId)
                  setSelectedActionIds(next?.actions.map((action) => action.actionId) || [])
                }}
                aria-label="选择整理提案"
              >
                {proposals.map((proposal) => (
                  <option key={proposal.id} value={proposal.id}>
                    {proposal.summary || proposal.id}
                  </option>
                ))}
              </select>
            )}

            {activeProposal ? (
              <OrganizerProposalPanel
                proposal={activeProposal}
                selectedActionIds={selectedActionIds}
                noteTitles={noteTitles}
                onToggleAction={toggleAction}
                onExecute={() => { setError(''); setStep('execute-confirm') }}
                executing={executing}
              />
            ) : (
              <div className="organizer-empty prototype-empty-focus">
                <strong>暂无整理提案</strong>
                <span>点击“立即生成提案”，或等待小助手定期生成。</span>
              </div>
            )}

            {executions.length > 0 && (
              <div className="organizer-execution-history">
                <h3>执行记录</h3>
                <ul>
                  {executions.map((execution) => (
                    <li key={execution.id} data-testid={`assistant-execution-${execution.id}`}>
                      <span>
                        {new Date(execution.createdAt || '').toLocaleString()} · {execution.actions.length} 条动作
                        {execution.status === 'undone' ? ' · 已撤销' : ''}
                      </span>
                      {execution.status !== 'undone' && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={Boolean(undoingExecutionId)}
                          onClick={() => {
                            setPendingUndoId(execution.id)
                            setUndoConflicts([])
                            setError('')
                            setStep('undo-confirm')
                          }}
                        >
                          整批撤销
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {step === 'execute-confirm' && (
          <div className="assistant-organizer-body">
            {selectedActions.length > 0 && (
              <div className="organizer-execute-scope" data-testid="assistant-execute-scope">
                <span className="organizer-execute-scope__title">本次会执行：</span>
                <ul>
                  {selectedActions.map((action) => (
                    <li key={action.actionId} data-testid={`assistant-execute-scope-${action.actionId}`}>
                      <strong>{ACTION_TYPE_LABELS[action.type]}</strong>
                      <span>涉及笔记：{noteListLabel(action.noteIds, noteTitles) || '无'}</span>
                      {action.targetNoteId ? <span>目标笔记：{noteLabel(action.targetNoteId, noteTitles)}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" disabled={executing} onClick={() => setStep('review')}>返回修改</Button>
              <Button disabled={executing || selectedActions.length === 0} onClick={() => void executeSelected()}>
                {executing ? '执行中...' : selectedHasHighRisk ? '确认执行（含高风险）' : '确认执行'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'undo-confirm' && (
          <div className="assistant-organizer-body">
            {undoConflicts.length > 0 && (
              <div className="organizer-conflict-list">
                {undoConflicts.map((conflict) => (
                  <p key={conflict.noteId} className="organizer-conflict-item">笔记 {noteLabel(conflict.noteId, noteTitles)}：{conflict.message}</p>
                ))}
              </div>
            )}
            <p className="assistant-organizer-hint">确认后将恢复执行前的笔记状态，已创建的知识库/标签也会按执行日志回滚。</p>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" disabled={Boolean(undoingExecutionId)} onClick={() => { setStep('review'); setPendingUndoId(null); setUndoConflicts([]) }}>返回</Button>
              <Button disabled={Boolean(undoingExecutionId) || undoConflicts.length > 0} onClick={() => void undoExecution()}>
                {undoingExecutionId ? '撤销中...' : '确认撤销'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
