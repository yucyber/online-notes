'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createNote, createTag, fetchCategories, fetchNotes, fetchTags } from '@/lib/api'
import type { Category, Note, Tag } from '@/types'
import { mergeTagIds } from './new-note-utils'
import { resolveTagIdsByNames } from '@/lib/tag-utils'

export function useNewNotePage() {
  const router = useRouter()
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [directoryNotes, setDirectoryNotes] = useState<Note[]>([])
  const [directorySearch, setDirectorySearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [metaLoading, setMetaLoading] = useState(true)
  const [metaError, setMetaError] = useState('')
  const [editorMode, setEditorMode] = useState<'rich' | 'markdown'>('markdown')
  const [newTitle, setNewTitle] = useState('')
  const [currentContent, setCurrentContent] = useState('<p></p>')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const savingRef = useRef(false)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const loadMeta = async () => {
      try {
        setMetaLoading(true)
        const [categoryData, tagData] = await Promise.all([fetchCategories(), fetchTags()])
        setCategories(categoryData)
        setTags(tagData)
        setMetaError('')
      } catch (error) {
        console.error('Failed to load categories or tags:', error)
        setMetaError('无法加载分类或标签，请稍后重试')
      } finally { setMetaLoading(false) }
    }
    void loadMeta()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void fetchNotes({ page: 1, size: 100 }, controller.signal)
      .then((result) => setDirectoryNotes(result.items))
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  const handleToggleFullscreen = useCallback(() => {
    const target = editorContainerRef.current || document.documentElement
    if (document.fullscreenElement) {
      try { void document.exitFullscreen() } catch { /* browser API is optional */ }
      setIsFullscreen(false)
      document.body.style.overflow = ''
      return
    }
    try {
      const request = (target as any).requestFullscreen || (document.documentElement as any).requestFullscreen || (document as any).webkitRequestFullscreen
      if (typeof request === 'function') Promise.resolve(request.call(target)).catch(() => {})
    } catch { /* browser API is optional */ }
    window.setTimeout(() => {
      if (!document.fullscreenElement) {
        setIsFullscreen(true)
        document.body.style.overflow = 'hidden'
      }
    }, 200)
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement)
      setIsFullscreen(active)
      document.body.style.overflow = active ? 'hidden' : ''
      if (active) (document.getElementById('fullscreen-button') as HTMLButtonElement | null)?.focus()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.fullscreenElement) { event.stopPropagation(); try { void document.exitFullscreen() } catch {} }
        else if (isFullscreen) { setIsFullscreen(false); document.body.style.overflow = '' }
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); handleToggleFullscreen() }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('editor:toggleFullscreen', handleToggleFullscreen)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('editor:toggleFullscreen', handleToggleFullscreen)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [handleToggleFullscreen, isFullscreen])

  const resolveCategoryId = (category: Category) => category.id
  const resolveTagId = (tag: Tag) => tag.id
  const toggleTag = (tagId: string) => setSelectedTags((prev) => prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId])

  const addTagsByNames = async (names: string[]) => {
    const result = await resolveTagIdsByNames(names, tags, async (name) => {
      try {
        return await createTag(name)
      } catch {
        // 单个标签失败不能阻断其余标签和笔记保存。
        return null
      }
    })
    if (result.created.length > 0) setTags((prev) => [...result.created, ...prev])
    if (result.ids.length > 0) setSelectedTags((prev) => mergeTagIds(prev, result.ids))
    return result.ids
  }

  const saveNote = async (title: string, content: string, status?: 'draft') => {
    if (savingRef.current) return
    if (!title.trim()) throw new Error('请输入笔记标题')
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    try {
      // 创建页不暴露公开开关，避免用户在尚未进入分享流程时误将内容公开给所有账号。
      const note = await createNote({ title: title.trim(), content: content.trim(), categoryId: selectedCategory || undefined, tags: mergeTagIds(selectedTags, []), ...(status ? { status } : {}), visibility: 'private' })
      router.push(`/dashboard/notes/${note.id}`)
    } catch (error) {
      console.error(status ? 'Failed to create draft note:' : 'Failed to create note:', error)
      const message = status ? '保存草稿失败，请重试' : '创建笔记失败，请重试'
      setSaveError(message)
      throw new Error(message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const confirmLeave = () => window.confirm('确定要放弃编辑吗？未保存的内容将丢失。')

  return { categories, tags, directoryNotes, directorySearch, setDirectorySearch, selectedCategory, setSelectedCategory, selectedTags, setSelectedTags, tagInput, setTagInput, metaLoading, metaError, editorMode, setEditorMode, newTitle, setNewTitle, currentContent, setCurrentContent, saving, saveError, selection, setSelection, isFullscreen, editorContainerRef, resolveCategoryId, resolveTagId, toggleTag, addTagsByNames, handleToggleFullscreen, handleSave: (title: string, content: string) => saveNote(title, content), handleSaveDraft: (title: string, content: string) => saveNote(title, content, 'draft'), handleOpenNote: (id: string) => { if (confirmLeave()) router.push(`/dashboard/notes/${id}/edit`) }, handleCancel: () => { if (confirmLeave()) router.back() } }
}
