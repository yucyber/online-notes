'use client'

import { useEffect, useMemo, useState } from 'react'
import { tagsAPI } from '@/lib/api'
import type { Tag } from '@/types'
import { PrototypeGlyph } from '@/components/ui/prototype-glyph'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export default function TagsManagePage() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [search, setSearch] = useState('')
  const [bulkInput, setBulkInput] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [mergeTarget, setMergeTarget] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      const data = await tagsAPI.getAll().catch(() => [])
      setTags(data)
      setErrorMessage('')
    } catch {
      setErrorMessage('加载标签失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSync = async () => {
    try {
      setSyncing(true)
      await tagsAPI.syncCounts()
      await load()
    } catch {
      setErrorMessage('同步失败')
    } finally {
      setSyncing(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? tags.filter(t => t.name.toLowerCase().includes(q)) : tags
  }, [tags, search])

  const handleBulkCreate = async () => {
    const parts = Array.from(new Set(bulkInput.split(/[\s,,，]+/).map(s => s.trim()).filter(Boolean)))
    if (parts.length === 0) return
    await tagsAPI.bulkCreate(parts)
    setBulkInput('')
    await load()
  }

  const handleUpdateColor = async (id: string, color: string) => {
    await tagsAPI.update(id, { color })
    await load()
  }

  const handleRename = async (id: string, name: string) => {
    if (!name.trim()) return
    await tagsAPI.update(id, { name: name.trim() })
    await load()
  }

  const handleDelete = (id: string) => {
    setPendingDeleteId(id)
  }

  const confirmDelete = async () => {
    if (!pendingDeleteId) return
    await tagsAPI.delete(pendingDeleteId)
    setPendingDeleteId(null)
    await load()
  }

  const cancelDelete = () => setPendingDeleteId(null)

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      return next.slice(0, 3) // 限制最多选择 3 个源标签
    })
  }

  const handleMerge = async () => {
    if (selected.length === 0 || !mergeTarget) return
    await tagsAPI.merge(selected, mergeTarget)
    setSelected([])
    setMergeTarget('')
    await load()
  }

  if (loading) {
    return <div className="prototype-loading">加载标签...</div>
  }

  return (
    <>
      <div>
        {errorMessage && <div className="prototype-error">{errorMessage}</div>}
        <header className="prototype-section-head"><div><p className="product-eyebrow">ONLINE NOTES</p><h1 className="page-heading">标签管理</h1><p className="page-description">让关键词保持清晰、稳定并便于检索。</p></div><button className="prototype-button" onClick={handleSync} disabled={syncing}><PrototypeGlyph name="redo" />{syncing ? '同步中...' : '同步计数'}</button></header>
        <div className="prototype-toolbar">
              <label className="prototype-search">
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="搜索标签"
                />
              </label>
                <input
                  value={bulkInput}
                  onChange={e => setBulkInput(e.target.value)}
                  placeholder="输入多个名称，逗号分隔"
                  className="prototype-field"
                  onKeyDown={e => { if (e.key === 'Enter') handleBulkCreate() }}
                />
                <button className="prototype-button prototype-button--primary" onClick={handleBulkCreate}><PrototypeGlyph name="plus" />创建</button>
        </div>
        <div className="product-tag-grid">
                  {filtered.map(tag => {
                    const isSource = selected.includes(tag.id)
                    return (
                      <button key={tag.id} className={`prototype-tag-cell ${isSource ? 'is-selected' : ''}`} onClick={() => toggleSelect(tag.id)} onDoubleClick={() => setMergeTarget(tag.id)}><span><i style={{ background: tag.color || 'var(--product-accent)' }}/><b contentEditable suppressContentEditableWarning onBlur={(event) => handleRename(tag.id, event.currentTarget.textContent || '')}>{tag.name}</b></span><small>{tag.noteCount ?? 0} 篇</small><input aria-label={`${tag.name}颜色`} type="color" value={tag.color || '#6B7280'} onClick={(event) => event.stopPropagation()} onChange={(event) => handleUpdateColor(tag.id, event.target.value)}/><span role="button" aria-label={`删除${tag.name}`} onClick={(event) => { event.stopPropagation(); handleDelete(tag.id) }}>×</span></button>
                    )
                  })}
        </div>
        <div className={`product-merge-bar ${selected.length ? 'is-visible' : ''}`}><span>已选择 <b>{selected.length}</b> 个标签</span><select value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}><option value="">选择目标</option>{tags.filter((tag) => !selected.includes(tag.id)).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><button className="prototype-button" disabled={!mergeTarget} onClick={handleMerge}>合并到目标</button></div>
      </div>
      {pendingDeleteId && (
        <Dialog open onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>确认删除标签</DialogTitle>
              <DialogDescription>删除后将从所有相关笔记中移除该标签，且不可恢复。</DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={cancelDelete}>取消</Button>
              <Button variant="destructive" onClick={confirmDelete}>确认删除</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
