'use client'

import { useEffect, useMemo, useState } from 'react'
import { tagsAPI } from '@/lib/api'
import type { Tag } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Plus, Trash2, RefreshCcw, Merge } from 'lucide-react'

export default function TagsManagePage() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [search, setSearch] = useState('')
  const [bulkInput, setBulkInput] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [mergeTarget, setMergeTarget] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? tags.filter(t => t.name.toLowerCase().includes(q)) : tags
  }, [tags, search])

  const handleBulkCreate = async () => {
    const parts = Array.from(new Set(bulkInput.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)))
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
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
        <RefreshCcw className="h-5 w-5 animate-spin" />
        <span className="ml-2">加载中...</span>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        {errorMessage && (
          <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2">
            {errorMessage}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold">标签管理</h1>
          <p className="text-gray-600">创建、重命名、配色、删除与合并标签，支持批量创建与限制合并源数。</p>
        </div>

        <Card className="shadow-md" style={{ borderColor: 'var(--border)' }}>
          <CardHeader>
            <CardTitle className="text-xl font-bold">快速操作</CardTitle>
            <CardDescription className="mt-1 text-sm">批量创建与搜索</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="搜索标签..."
                  className="flex-1 border rounded-md p-2 text-sm placeholder-muted"
                  style={{ borderColor: 'var(--interactive-border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
                />
                <Button variant="outline" size="sm" className="whitespace-nowrap" onClick={() => setSearch('')}>清空</Button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={bulkInput}
                  onChange={e => setBulkInput(e.target.value)}
                  placeholder="批量创建：输入多个名称，逗号/空格分隔"
                  className="flex-1 border rounded-md p-2 text-sm placeholder-muted"
                  style={{ borderColor: 'var(--interactive-border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
                  onKeyDown={e => { if (e.key === 'Enter') handleBulkCreate() }}
                />
                <Button className="whitespace-nowrap" onClick={handleBulkCreate}><Plus className="h-4 w-4 mr-1" />创建</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-md">
          <CardHeader>
            <CardTitle className="text-xl font-bold">全部标签</CardTitle>
            <CardDescription className="mt-1 text-sm">点击选择源（最多 3 个），选择目标进行合并</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="md:col-span-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filtered.map(tag => {
                    const isSource = selected.includes(tag.id)
                    const isTarget = mergeTarget === tag.id
                    return (
                      <div key={tag.id} className="border rounded-xl p-3 flex flex-col gap-2 transition" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', boxShadow: 'var(--shadow-sm)' }}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="inline-block h-4 w-4 rounded-full ring-2" style={{ backgroundColor: tag.color || '#6B7280' }} />
                            <input defaultValue={tag.name} className="bg-transparent border border-transparent rounded px-2 py-1 text-sm focus:outline-none" style={{ color: 'var(--on-surface)' }} onBlur={e => handleRename(tag.id, e.target.value)} />
                          </div>
                          <div className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{tag.noteCount ?? 0} 条笔记</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="color" value={tag.color || '#6B7280'} onChange={e => handleUpdateColor(tag.id, e.target.value)} className="h-7 w-9 rounded" />
                        </div>
                        <div className="grid grid-cols-2 gap-2 w-full">
                          <Button variant={isSource ? 'default' : 'outline'} size="sm" className="w-full" onClick={() => toggleSelect(tag.id)}>
                            {isSource ? '已选源' : '选源'}
                          </Button>
                          <Button variant={isTarget ? 'default' : 'outline'} size="sm" className="w-full" onClick={() => setMergeTarget(tag.id)}>
                            {isTarget ? '已目标' : '设目标'}
                          </Button>
                        </div>
                        <Button aria-label="删除标签" title="删除标签" variant="destructive" size="icon" className="absolute top-2 right-2 h-8 w-8 rounded-full shadow-sm" onClick={() => handleDelete(tag.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div className="text-sm text-gray-600">已选源：{selected.length}/3</div>
                <div className="flex flex-wrap gap-2">
                  {selected.map(id => {
                    const t = tags.find(x => x.id === id)
                    return <span key={id} className="px-2 py-1 text-xs border rounded bg-blue-50 text-blue-700">{t?.name || id}</span>
                  })}
                </div>
                <div className="text-sm text-gray-600">目标：{(tags.find(x => x.id === mergeTarget)?.name) || '未选择'}</div>
                <Button disabled={selected.length === 0 || !mergeTarget} className="whitespace-nowrap" onClick={handleMerge}>
                  <Merge className="h-4 w-4 mr-1" /> 合并到目标
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      {pendingDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--overlay)' }}>
          <div className="rounded-xl shadow-xl w-[92%] max-w-md p-5 border" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', color: 'var(--on-surface)' }}>
            <h3 className="text-lg font-semibold mb-2">确认删除标签</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>删除后将从所有相关笔记中移除该标签，且不可恢复。</p>
            <div className="flex justify-end gap-3">
              <button className="px-4 py-2 rounded border" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }} onClick={cancelDelete}>取消</button>
              <button className="px-4 py-2 rounded" style={{ background: 'var(--primary-600)', color: '#fff' }} onClick={confirmDelete}>确认删除</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
