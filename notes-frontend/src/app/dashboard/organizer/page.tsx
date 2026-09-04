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
      setMessage('已刷新 stale 状态')
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
    return <div className="page-container"><p>加载中...</p></div>
  }

  return (
    <div className="page-container">
      <header>
        <h1 className="page-heading">只读整理提案</h1>
        <p className="page-description">审阅 AI 建议；此页面不会自动修改笔记、分类或知识库。</p>
      </header>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={runGlobal}>生成全局提案</button>
        <select
          aria-label="选择要分析的笔记"
          value={selectedNoteId}
          onChange={(event) => setSelectedNoteId(event.target.value)}
          disabled={notesLoading || notes.length === 0}
          style={{ minWidth: 260, maxWidth: 380, padding: '4px 8px' }}
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
        <button type="button" onClick={runIncremental} disabled={!selectedNoteId}>生成增量提案</button>
        {activeProposal && <button type="button" onClick={refreshActive}>刷新 stale</button>}
      </div>
      {message && <p>{message}</p>}

      {proposals.length === 0 ? (
        <p>还没有提案。可以先“生成全局提案”，或从上方选择一篇笔记生成增量提案。</p>
      ) : (
        <div style={{ display: 'flex', gap: 16 }}>
          <aside style={{ minWidth: 200 }}>
            <h2>提案列表</h2>
            <ul>
              {proposals.map((proposal) => (
                <li key={proposal.id}>
                  <button type="button" onClick={() => {
                    setActiveProposalId(proposal.id)
                    setSelectedActionIds(proposal.actions.map((action) => action.actionId))
                  }}>
                    {proposal.summary || proposal.id}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <main style={{ flex: 1 }}>
            {activeProposal ? (
              <OrganizerProposalPanel
                proposal={activeProposal}
                selectedActionIds={selectedActionIds}
                onToggleAction={toggleAction}
                onRenameKnowledgeBase={renameAction}
              />
            ) : <p>请选择一个提案。</p>}
          </main>
        </div>
      )}
    </div>
  )
}
