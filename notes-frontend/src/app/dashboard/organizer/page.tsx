'use client'

import { useCallback, useEffect, useState } from 'react'
import OrganizerProposalPanel from '@/components/organizer/OrganizerProposalPanel'
import type { OrganizerProposal } from '@/components/organizer/organizer-types'
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

  useEffect(() => {
    void reload()
    void loadNotes()
  }, [reload, loadNotes])

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
      await reload()
      setActiveProposalId(result.proposal.id)
      setSelectedActionIds(result.proposal.actions.map((action) => action.actionId))
      setMessage('已生成增量提案')
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

  if (loading && proposals.length === 0) {
    return <div className="prototype-loading">加载中...</div>
  }

  return (
    <div className="organizer-page">
      <header className="prototype-section-head">
        <div>
          <p className="product-eyebrow">AI ORGANIZER</p>
          <h1 className="page-heading">只读整理提案</h1>
          <p className="page-description">审阅 AI 建议；此页面不会自动修改笔记、分类或知识库。</p>
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
                  <button
                    key={proposal.id}
                    type="button"
                    className={active ? 'is-active' : ''}
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
    </div>
  )
}
