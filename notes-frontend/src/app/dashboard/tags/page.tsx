'use client'

import { useEffect, useMemo, useState } from 'react'
import { tagsAPI } from '@/lib/api'
import type { Tag } from '@/types'
import { PrototypeGlyph } from '@/components/ui/prototype-glyph'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// 无自定义颜色的标签按名称 hash 到一组分类色，避免色块全部灰成一片；
// 同时剔除接近纯黑的色，避免显示成"黑点"。
const FALLBACK_COLORS = ['#3b7fbd', '#8a63d2', '#2f9e6e', '#e08a3c', '#c45757', '#4a8a72', '#8a7a3a', '#5b6cb0']
const isNearBlack = (hex: string): boolean => {
  const h = hex.replace('#', '')
  if (h.length !== 6) return false
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return r < 40 && g < 40 && b < 40
}
// 后端 schema 的默认色 #6B7280（灰）等同于「未设置」，不应占用哈希色分支，否则所有未选色标签都灰成一片。
const DEFAULT_GRAY = '#6B7280'
const tagColor = (tag: Tag): string => {
  if (tag.color && !isNearBlack(tag.color) && tag.color.toLowerCase() !== DEFAULT_GRAY.toLowerCase()) return tag.color
  let h = 0
  for (let i = 0; i < tag.name.length; i++) h = (h * 31 + tag.name.charCodeAt(i)) >>> 0
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]
}

// Cell 的选择模式：选源（多选）/ 选目标（单选） / 空闲
type PickMode = 'idle' | 'pick-source' | 'pick-target'

export default function TagsManagePage() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [search, setSearch] = useState('')
  const [bulkInput, setBulkInput] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [mergeTarget, setMergeTarget] = useState('')
  const [pickMode, setPickMode] = useState<PickMode>('idle')
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

  // 进入「选目标」模式（合并条里的按钮触发），退出选源模式避免误触
  const startPickTarget = () => {
    if (selected.length === 0) return
    setMergeTarget('')
    setPickMode('pick-target')
  }

  // 退出整个合并流程（取消目标选取 / 取消源选取）
  const resetMerge = () => {
    setSelected([])
    setMergeTarget('')
    setPickMode('idle')
  }

  // 取消最后一个源时，连带清掉目标，避免出现「无源有目标」的孤立态
  const removeSource = (id: string) => {
    setSelected(prev => {
      const next = prev.filter(x => x !== id)
      if (next.length === 0) setMergeTarget('')
      return next
    })
  }

  // tag-cell 单击逻辑：根据当前模式区分行为
  const handleTagClick = (id: string) => {
    if (pickMode === 'pick-target') {
      // 目标单选：再次点击同一项 = 取消目标；点击其他项 = 切换目标。任一情况下都退出选目标态。
      if (mergeTarget === id) {
        setMergeTarget('')
      } else {
        setMergeTarget(id)
      }
      setPickMode('pick-source')
      return
    }
    // pick-source / idle 都视为「多选源」操作
    if (selected.includes(id)) {
      removeSource(id)
    } else {
      setSelected(prev => (prev.length >= 3 ? prev : [...prev, id])) // 限制最多选 3 个源
      setPickMode('pick-source')
    }
  }

  const handleMerge = async () => {
    if (selected.length === 0 || !mergeTarget) return
    await tagsAPI.merge(selected, mergeTarget)
    resetMerge()
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
        <div className={`product-tag-grid ${pickMode === 'pick-target' ? 'is-picking-target' : ''}`}>
                  {filtered.map(tag => {
                    const isSource = selected.includes(tag.id)
                    const isTarget = mergeTarget === tag.id
                    // pick-target 模式下，cell 显示候选目标态（不属于源标签的可点击目标）
                    const isPickableTarget = pickMode === 'pick-target' && !isSource
                    return (
                      <button key={tag.id} className={`prototype-tag-cell ${isSource ? 'is-selected' : ''} ${isTarget ? 'is-target' : ''} ${isPickableTarget ? 'is-pickable-target' : ''}`} onClick={() => handleTagClick(tag.id)}><span><i style={{ background: tagColor(tag) }}/><b contentEditable suppressContentEditableWarning onBlur={(event) => handleRename(tag.id, event.currentTarget.textContent || '')}>{tag.name}</b></span><small>{tag.noteCount ?? 0} 篇</small><input aria-label={`${tag.name}颜色`} type="color" value={tagColor(tag)} onClick={(event) => event.stopPropagation()} onChange={(event) => handleUpdateColor(tag.id, event.target.value)}/><span role="button" aria-label={`删除${tag.name}`} onClick={(event) => { event.stopPropagation(); handleDelete(tag.id) }}>×</span></button>
                    )
                  })}
        </div>
        <div className={`product-merge-bar ${pickMode !== 'idle' ? 'is-visible' : ''}`}>
          {pickMode === 'pick-target' ? (
            <>
              <span className="merge-count">已选择 <span className="merge-count__num">{selected.length}</span> 个源标签</span>
              <span className="merge-arrow"><PrototypeGlyph name="chevron-right" /></span>
              {mergeTarget ? (
                <span className="merge-target-slot has-target">
                  <i style={{ background: (tags.find(t => t.id === mergeTarget) && tagColor(tags.find(t => t.id === mergeTarget)!)) || 'var(--product-accent)' }} />
                  <b>{tags.find(t => t.id === mergeTarget)?.name}</b>
                </span>
              ) : (
                <span className="merge-target-slot"><span className="merge-target-slot__placeholder">请在下方选择一个目标</span></span>
              )}
              <span className="merge-spacer" />
              <button className="prototype-button" onClick={() => { setMergeTarget(''); setPickMode(selected.length ? 'pick-source' : 'idle') }}>上一步</button>
            </>
          ) : (
            <>
              <span className="merge-count">已选择 <span className="merge-count__num">{selected.length}</span> 个源标签</span>
              <span className="merge-arrow"><PrototypeGlyph name="chevron-right" /></span>
              {mergeTarget ? (
                <span className="merge-target-slot has-target">
                  <i style={{ background: (tags.find(t => t.id === mergeTarget) && tagColor(tags.find(t => t.id === mergeTarget)!)) || 'var(--product-accent)' }} />
                  <b>{tags.find(t => t.id === mergeTarget)?.name}</b>
                </span>
              ) : (
                <span className="merge-target-slot"><span className="merge-target-slot__placeholder">尚未选择目标</span></span>
              )}
              <span className="merge-spacer" />
              {mergeTarget ? (
                <button className="prototype-button prototype-button--primary" onClick={handleMerge}>合并 {selected.length} → {tags.find(t => t.id === mergeTarget)?.name}</button>
              ) : (
                <button className="prototype-button prototype-button--primary" onClick={startPickTarget} disabled={selected.length === 0}>选择目标 →</button>
              )}
            </>
          )}
        </div>
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
