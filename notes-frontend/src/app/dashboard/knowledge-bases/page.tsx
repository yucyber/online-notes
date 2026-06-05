'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BookOpenCheck, FileText, Loader2, PlusCircle, RefreshCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { knowledgeBasesAPI } from '@/lib/api'
import { formatDate } from '@/utils'
import type { KnowledgeBase, KnowledgeBaseNoteLink } from '@/types'

const emptyForm = {
  name: '',
  description: '',
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object') {
    const axiosLikeError = error as { response?: { data?: { message?: string } } }
    if (axiosLikeError.response?.data?.message) return axiosLikeError.response.data.message
  }
  return fallback
}

export default function KnowledgeBasesPage() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [links, setLinks] = useState<KnowledgeBaseNoteLink[]>([])
  const [formState, setFormState] = useState(emptyForm)
  const [loadingBases, setLoadingBases] = useState(true)
  const [loadingLinks, setLoadingLinks] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removingNoteId, setRemovingNoteId] = useState('')
  const [error, setError] = useState('')

  const selectedKnowledgeBase = useMemo(
    () => knowledgeBases.find((item) => item.id === selectedId) || null,
    [knowledgeBases, selectedId],
  )

  const loadKnowledgeBases = async () => {
    try {
      setLoadingBases(true)
      setError('')
      const data = await knowledgeBasesAPI.getAll()
      setKnowledgeBases(data)
      setSelectedId((current) => {
        if (current && data.some((item) => item.id === current)) return current
        return data[0]?.id || ''
      })
    } catch (err) {
      console.error('Failed to load knowledge bases', err)
      setError(getErrorMessage(err, '知识库加载失败，请稍后重试'))
    } finally {
      setLoadingBases(false)
    }
  }

  const loadLinks = async (knowledgeBaseId: string) => {
    if (!knowledgeBaseId) {
      setLinks([])
      return
    }

    try {
      setLoadingLinks(true)
      setError('')
      const data = await knowledgeBasesAPI.getNotes(knowledgeBaseId)
      setLinks(data)
    } catch (err) {
      console.error('Failed to load knowledge base notes', err)
      setError(getErrorMessage(err, '知识库笔记加载失败，请稍后重试'))
    } finally {
      setLoadingLinks(false)
    }
  }

  useEffect(() => {
    loadKnowledgeBases()
  }, [])

  useEffect(() => {
    loadLinks(selectedId)
  }, [selectedId])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const name = formState.name.trim()
    const description = formState.description.trim()
    if (!name) {
      setError('请输入知识库名称')
      return
    }

    try {
      setSaving(true)
      setError('')
      const created = await knowledgeBasesAPI.create({ name, description })
      setKnowledgeBases((prev) => [created, ...prev])
      setSelectedId(created.id)
      setFormState(emptyForm)
    } catch (err) {
      console.error('Failed to create knowledge base', err)
      setError(getErrorMessage(err, '创建知识库失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveNote = async (noteId: string) => {
    if (!selectedId) return
    try {
      setRemovingNoteId(noteId)
      setError('')
      await knowledgeBasesAPI.removeNote(selectedId, noteId)
      setLinks((prev) => prev.filter((link) => link.noteId !== noteId))
    } catch (err) {
      console.error('Failed to remove note from knowledge base', err)
      setError(getErrorMessage(err, '移除笔记失败，请稍后重试'))
    } finally {
      setRemovingNoteId('')
    }
  }

  if (loadingBases) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
        <RefreshCcw className="mr-2 h-5 w-5 animate-spin" />
        加载知识库...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--on-surface)' }}>
            知识库
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            用知识库划定笔记集合，后续图谱构建会以单个知识库为边界。
          </p>
        </div>
        <Link href="/dashboard/notes">
          <Button variant="outline">
            <FileText className="mr-2 h-4 w-4" />
            从笔记选择
          </Button>
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border px-3 py-2 text-sm text-red-700" style={{ borderColor: '#fecaca', background: '#fef2f2' }}>
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card style={{ borderColor: 'var(--border)' }}>
            <CardHeader>
              <CardTitle className="text-xl">创建知识库</CardTitle>
              <CardDescription>名称描述知识边界，描述记录纳入规则。</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={handleSubmit}>
                <Input
                  value={formState.name}
                  onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="知识库名称"
                  maxLength={80}
                />
                <Textarea
                  value={formState.description}
                  onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="描述这个知识库的边界"
                  maxLength={500}
                  style={{ minHeight: '92px' }}
                />
                <Button type="submit" disabled={saving} className="w-full">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                  创建知识库
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card style={{ borderColor: 'var(--border)' }}>
            <CardHeader>
              <CardTitle className="text-xl">全部知识库</CardTitle>
              <CardDescription>{knowledgeBases.length} 个边界集合</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {knowledgeBases.length === 0 ? (
                <div className="rounded-xl border border-dashed p-5 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                  还没有知识库。先创建一个，再从笔记列表加入内容。
                </div>
              ) : (
                knowledgeBases.map((item) => {
                  const selected = item.id === selectedId
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className="w-full rounded-xl border p-3 text-left transition"
                      style={{
                        borderColor: selected ? 'var(--primary-600)' : 'var(--border)',
                        background: selected ? 'var(--primary-50)' : 'var(--surface-1)',
                        color: 'var(--on-surface)',
                      }}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <BookOpenCheck className="h-4 w-4" />
                        {item.name}
                      </span>
                      {item.description && (
                        <span className="mt-1 block text-xs line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                          {item.description}
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>

        <Card style={{ borderColor: 'var(--border)' }}>
          <CardHeader className="border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-xl">{selectedKnowledgeBase?.name || '知识库笔记'}</CardTitle>
                <CardDescription>
                  {selectedKnowledgeBase?.description || '选择一个知识库查看其中的笔记'}
                </CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => loadLinks(selectedId)} disabled={!selectedId || loadingLinks}>
                {loadingLinks ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                刷新
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {!selectedId ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                创建或选择知识库后，这里会显示纳入的笔记。
              </div>
            ) : loadingLinks ? (
              <div className="flex min-h-[180px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                加载笔记...
              </div>
            ) : links.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                这个知识库还没有笔记。前往“我的笔记”批量选择后加入。
              </div>
            ) : (
              <div className="space-y-3">
                {links.map((link) => (
                  <div
                    key={link.id}
                    className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/dashboard/notes/${link.note.id}`}
                        className="font-semibold hover:text-primary-600"
                        style={{ color: 'var(--on-surface)' }}
                      >
                        {link.note.title || '无标题'}
                      </Link>
                      <p className="mt-1 line-clamp-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {link.note.summary || '暂无摘要'}
                      </p>
                      <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        更新时间：{formatDate(link.note.updatedAt)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`从知识库移除 ${link.note.title || '无标题'}`}
                      title="从知识库移除"
                      disabled={removingNoteId === link.noteId}
                      onClick={() => handleRemoveNote(link.noteId)}
                    >
                      {removingNoteId === link.noteId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
