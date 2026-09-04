'use client'

import { useCallback, useEffect, useState } from 'react'
import OrganizerProposalPanel from '@/components/organizer/OrganizerProposalPanel'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { OrganizerExecution, OrganizerProposal } from '@/components/organizer/organizer-types'
import type { Note } from '@/types'
import { notesAPI } from '@/lib/api/notes'
import { organizerAPI } from '@/lib/api/organizer'

export default function OrganizerPage() {
  const [proposals, setProposals] = useState<OrganizerProposal[]>([])
  const [activeProposalId, setActiveProposalId] = useState<string>('')
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [notesLoading, setNotesLoading] = useState(true)
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedNoteId, setSelectedNoteId] = useState('')
  const [message, setMessage] = useState('')
  const [deletingProposalId, setDeletingProposalId] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [executions, setExecutions] = useState<OrganizerExecution[]>([])
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null)
  const [undoingExecutionId, setUndoingExecutionId] = useState('')
  const [undoConflicts, setUndoConflicts] = useState<Array<{ noteId: string; message: string }>>([])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await organizerAPI.listProposals()
      setProposals(data)
      if (!activeProposalId || !data.some((item) => item.id === activeProposalId)) {
        const first = data[0]
        setActiveProposalId(first?.id || '')
        setSelectedActionIds(first?.actions?.map((action) => action.actionId) || [])
      }
    } catch (error: any) {
      setMessage(error?.message || '加载提案失败')
    } finally {
      setLoading(false)
    }
  }, [activeProposalId])

  const loadNotes = useCallback(async () => {
    setNotesLoading(true)
    try {
      const data = await notesAPI.getAll({ size: 50 })
      setNotes(data.items)
      setSelectedNoteId((current) => current || data.items[0]?.id || '')
    } catch (error: any) {
      setMessage(error?.message || '加载笔记列表失败')
    } finally {
      setNotesLoading(false)
    }
  }, [])

  const loadExecutions = useCallback(async () => {
    try {
      const data = await organizerAPI.listExecutions()
      setExecutions(data)
    } catch (error: any) {
      setMessage(error?.message || '加载执行记录失败')
    }
  }, [])

  useEffect(() => {
    void reload()
    void loadNotes()
    void loadExecutions()
  }, [reload, loadNotes, loadExecutions])

  const activeProposal = proposals.find((item) => item.id === activeProposalId)

  const runGlobal = async () => {
    setLoading(true)
    setMessage('')
    try {
      const result = await organizerAPI.createGlobal()
      if (result.generated && result.proposal) {
        setMessage('已生成全局提案')
        await reload()
        setActiveProposalId(result.proposal.id)
        setSelectedActionIds(result.proposal.actions.map((action) => action.actionId))
      } else {
        setMessage(result.reason === 'below_threshold' ? '笔记数量未达到全局提案阈值' : '没有可生成的建议')
      }
    } catch (error: any) {
      setMessage(error?.message || '生成全局提案失败')
    } finally {
      setLoading(false)
    }
  }

  const runIncremental = async () => {
    if (!selectedNoteId) {
      setMessage('请先选择要分析的笔记')
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const result = await organizerAPI.createIncremental(selectedNoteId)
      if (result.generated && result.proposal) {
        await reload()
        setActiveProposalId(result.proposal.id)
        setSelectedActionIds(result.proposal.actions.map((action) => action.actionId))
        setMessage('已生成增量提案')
      } else {
        setMessage(result.reason === 'already_organized' ? '该笔记已有知识库归属，无需生成增量提案' : '没有可生成的建议')
      }
    } catch (error: any) {
      setMessage(error?.message || '生成增量提案失败')
    } finally {
      setLoading(false)
    }
  }

  const refreshActive = async () => {
    if (!activeProposalId) return
    try {
      const updated = await organizerAPI.refreshStale(activeProposalId)
      setProposals((current) => current.map((item) => item.id === updated.id ? updated : item))
      setMessage('已刷新过期状态')
    } catch (error: any) {
      setMessage(error?.message || '刷新失败')
    }
  }

  const deleteProposal = async () => {
    const id = pendingDeleteId
    if (!id) return
    setDeletingProposalId(id)
    setMessage('')
    try {
      await organizerAPI.deleteProposal(id)
      const next = proposals.filter((item) => item.id !== id)
      setProposals(next)
      if (activeProposalId === id) {
        const first = next[0]
        setActiveProposalId(first?.id || '')
        setSelectedActionIds(first?.actions?.map((action) => action.actionId) || [])
      }
      setPendingDeleteId(null)
      setMessage('已删除提案')
    } catch (error: any) {
      setMessage(error?.message || '删除提案失败')
    } finally {
      setDeletingProposalId('')
    }
  }

  const executeSelected = async () => {
    const proposal = activeProposal
    const actionIds = selectedActionIds
    if (!proposal || actionIds.length === 0) return
    setExecuting(true)
    setMessage('')
    try {
      await organizerAPI.executeProposal(proposal.id, actionIds, `organizer-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
      setExecuteDialogOpen(false)
      setMessage('执行完成，可在 30 天内整批撤销')
      await Promise.all([loadExecutions(), reload()])
    } catch (error: any) {
      setMessage(error?.message || '执行失败')
    } finally {
      setExecuting(false)
    }
  }

  const undoExecution = async () => {
    const id = pendingUndoId
    if (!id) return
    setUndoingExecutionId(id)
    setMessage('')
    setUndoConflicts([])
    try {
      const result = await organizerAPI.undoExecution(id, `organizer-undo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
      if (result.ok) {
        setPendingUndoId(null)
        setMessage('已整批撤销该次执行')
      } else {
        setUndoConflicts(result.conflicts || [])
        setMessage(`撤销被阻止，共 ${result.conflicts?.length || 0} 个冲突需要人工处理`)
      }
      await Promise.all([loadExecutions(), reload()])
    } catch (error: any) {
      setMessage(error?.message || '撤销失败')
    } finally {
      setUndoingExecutionId('')
    }
  }

  const toggleAction = (actionId: string, checked: boolean) => {
    setSelectedActionIds((current) => checked
      ? Array.from(new Set([...current, actionId]))
      : current.filter((id) => id !== actionId))
  }

  const renameAction = (actionId: string, name: string) => {
    setProposals((current) => current.map((proposal) => proposal.id === activeProposalId ? {
      ...proposal,
      actions: proposal.actions.map((action) => action.actionId === actionId ? { ...action, knowledgeBaseName: name } : action),
    } : proposal))
  }

  const selectedActions = activeProposal?.actions.filter((action) => selectedActionIds.includes(action.actionId)) || []
  const selectedHasHighRisk = selectedActions.some((action) => action.riskLevel === 'high')

  if (loading && proposals.length === 0) {
    return <div className="prototype-loading">加载中...</div>
  }

  return (
    <div className="organizer-page">
      <header className="prototype-section-head">
        <div>
          <p className="product-eyebrow">AI ORGANIZER</p>
          <h1 className="page-heading">只读整理提案</h1>
          <p className="page-description">审阅 AI 建议；确认后可逐条执行，并支持在 30 天内整批撤销。</p>
        </div>
      </header>

      <div className="organizer-toolbar">
        <button type="button" className="prototype-button prototype-button--primary" onClick={runGlobal} disabled={loading}>生成全局提案</button>
        <label className="organizer-note-picker">
          <span>分析笔记</span>
          <select
            aria-label="选择要分析的笔记"
            value={selectedNoteId}
            onChange={(event) => setSelectedNoteId(event.target.value)}
            disabled={notesLoading || notes.length === 0}
          >
            {notesLoading ? (
              <option value="">笔记加载中...</option>
            ) : notes.length === 0 ? (
              <option value="">暂无可用笔记</option>
            ) : (
              notes.map((note) => (
                <option key={note.id} value={note.id}>{note.title || '未命名笔记'}</option>
              ))
            )}
          </select>
        </label>
        <button type="button" className="prototype-button" onClick={runIncremental} disabled={!selectedNoteId || loading}>生成增量提案</button>
        {activeProposal && <button type="button" className="prototype-button" onClick={refreshActive} disabled={loading}>刷新过期状态</button>}
      </div>

      {message && <p className={`organizer-message ${/失败|错误/.test(message) ? 'organizer-message--error' : ''}`} role="status">{message}</p>}

      {executions.length > 0 && (
        <div className="organizer-execution-history prototype-panel">
          <header className="prototype-panel-head padded">
            <h2>执行记录</h2>
            <span>{executions.length} 条</span>
          </header>
          <div className="organizer-execution-list">
            {executions.map((execution) => {
              const canUndo = execution.status === 'executed' && Boolean(execution.undoDeadline) && new Date(execution.undoDeadline as string) > new Date()
              const undoDisabled = Boolean(undoingExecutionId) || !canUndo
              return (
                <div key={execution.id} className={`organizer-execution-item organizer-execution-item--${execution.status}`}>
                  <div className="organizer-execution-summary">
                    <b>执行 #{execution.id.slice(-6)}</b>
                    <small>提案 #{execution.proposalId.slice(-6)} · Revision {execution.proposalRevision} · {execution.actions.length} 条动作</small>
                  </div>
                  <div className="organizer-execution-status">
                    {execution.status === 'undone' ? (
                      <em className="proposal-status proposal-status-confirmed">已撤销</em>
                    ) : execution.undoDeadline ? (
                      <em className="proposal-status proposal-status-pending">可撤销至 {new Date(execution.undoDeadline).toLocaleString()}</em>
                    ) : (
                      <em className="proposal-status proposal-status-pending">已执行</em>
                    )}
                  </div>
                  {canUndo && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={undoDisabled}
                      onClick={() => setPendingUndoId(execution.id)}
                    >
                      {undoingExecutionId === execution.id ? '撤销中...' : '整批撤销'}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {proposals.length === 0 ? (
        <div className="organizer-empty prototype-empty-focus">
          <strong>还没有整理提案</strong>
          <span>可以先“生成全局提案”，或从上方选择一篇笔记生成增量提案。</span>
        </div>
      ) : (
        <div className="organizer-layout">
          <aside className="organizer-proposal-list prototype-panel">
            <header className="prototype-panel-head padded">
              <h2>提案列表</h2>
              <span>{proposals.length} 个</span>
            </header>
            <div className="organizer-proposal-list__items">
              {proposals.map((proposal) => {
                const active = proposal.id === activeProposalId
                return (
                  <div key={proposal.id} className="organizer-proposal-list__item">
                    <button
                      type="button"
                      className={`organizer-proposal-list__select ${active ? 'is-active' : ''}`}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        setActiveProposalId(proposal.id)
                        setSelectedActionIds(proposal.actions.map((action) => action.actionId))
                      }}
                    >
                      <span className="organizer-proposal-list__summary">
                        <b>{proposal.summary || proposal.id}</b>
                        <small>Revision {proposal.revision}</small>
                      </span>
                      <em className={`proposal-status proposal-status-${proposal.status}`}>{proposal.status === 'stale' ? '需刷新' : proposal.status === 'confirmed' ? '已确认' : '待处理'}</em>
                    </button>
                    <button
                      type="button"
                      className="organizer-proposal-delete"
                      aria-label={`删除提案：${proposal.summary || proposal.id}`}
                      title="删除提案"
                      disabled={deletingProposalId === proposal.id}
                      onClick={() => setPendingDeleteId(proposal.id)}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          </aside>

          <main className="organizer-proposal-detail">
            {activeProposal ? (
              <OrganizerProposalPanel
                proposal={activeProposal}
                selectedActionIds={selectedActionIds}
                onToggleAction={toggleAction}
                onRenameKnowledgeBase={renameAction}
                onExecute={() => setExecuteDialogOpen(true)}
                executing={executing}
              />
            ) : (
              <div className="organizer-empty prototype-empty-focus">
                <strong>请选择一个提案</strong>
                <span>在左侧选择后，可在这里审阅每条 AI 整理建议。</span>
              </div>
            )}
          </main>
        </div>
      )}

      <Dialog open={executeDialogOpen} onOpenChange={(open) => { if (!open && !executing) setExecuteDialogOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认执行所选建议</DialogTitle>
            <DialogDescription>
              将执行 {selectedActions.length} 条建议
              {selectedHasHighRisk ? '，其中包含高风险动作，执行后可在 30 天内整批撤销。' : '，执行后可在 30 天内整批撤销。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" disabled={executing} onClick={() => setExecuteDialogOpen(false)}>取消</Button>
            <Button disabled={executing || selectedActions.length === 0} onClick={() => void executeSelected()}>
              {executing ? '执行中...' : '确认执行'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingUndoId)} onOpenChange={(open) => { if (!open && !undoingExecutionId) setPendingUndoId(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认整批撤销</DialogTitle>
            <DialogDescription>会撤销该次执行涉及的全部动作。如果相关笔记在这之后被你编辑过，系统会阻止覆盖并提示冲突。</DialogDescription>
          </DialogHeader>
          {undoConflicts.length > 0 && (
            <div className="organizer-conflict-list">
              {undoConflicts.map((conflict) => (
                <p key={conflict.noteId} className="organizer-conflict-item">笔记 {conflict.noteId}：{conflict.message}</p>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" disabled={Boolean(undoingExecutionId)} onClick={() => { setPendingUndoId(null); setUndoConflicts([]) }}>取消</Button>
            <Button disabled={Boolean(undoingExecutionId) || undoConflicts.length > 0} onClick={() => void undoExecution()}>
              {undoingExecutionId ? '撤销中...' : '确认撤销'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingDeleteId)} onOpenChange={(open) => { if (!open && !deletingProposalId) setPendingDeleteId(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除提案</DialogTitle>
            <DialogDescription>删除后不可恢复，确定要删除该提案吗？</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" disabled={Boolean(deletingProposalId)} onClick={() => setPendingDeleteId(null)}>取消</Button>
            <Button variant="destructive" disabled={Boolean(deletingProposalId)} onClick={() => void deleteProposal()}>
              {deletingProposalId ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
