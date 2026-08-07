'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getDraft, putDraft, removeDraft } from '@/lib/draftStore'

type Props = {
  initialContent: string
  initialTitle: string
  onSave: (title: string, content: string) => Promise<void>
  isNew: boolean
  draftKey?: string
  onContentChange?: (content: string, title: string) => void
}

export function useMarkdownEditor({ initialContent, initialTitle, onSave, isNew, draftKey, onContentChange }: Props) {
  const [content, setContent] = useState(initialContent)
  const [title, setTitle] = useState(initialTitle)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit')
  const [wordCount, setWordCount] = useState(0)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [restoreBanner, setRestoreBanner] = useState<{ title: string; content: string; updatedAt: number } | null>(null)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const localSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const storageKey = draftKey ? `draft:${draftKey}` : undefined

  useEffect(() => { setWordCount(content.trim().split(/\s+/).filter(Boolean).length) }, [content])
  useEffect(() => { try { onContentChange?.(content, title) } catch {} }, [content, title, onContentChange])

  const handleSave = useCallback(async (isAutoSave = false) => {
    if (!title.trim()) { if (!isAutoSave) alert('请输入笔记标题'); return }
    if (isSaving) return
    try { setIsSaving(true); await onSave(title, content); setLastSaved(new Date().toLocaleTimeString('zh-CN')) }
    catch (error) { console.error('保存失败:', error); if (!isAutoSave) alert('保存失败，请重试') }
    finally { setIsSaving(false) }
  }, [title, content, isSaving, onSave])

  useEffect(() => {
    // isNew 时不自动保存，避免把空笔记标题提交到服务端；30s 节流防止高频写入。
    if (isNew || isSaving || (content === initialContent && title === initialTitle)) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => { if (title.trim()) void handleSave(true) }, 30000)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  }, [content, title, isNew, isSaving, initialContent, initialTitle, handleSave])

  useEffect(() => {
    if (!storageKey) return
    if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current)
    localSaveTimerRef.current = setTimeout(() => {
      const payload = { title, content, updatedAt: Date.now() }
      try { localStorage.setItem(storageKey, JSON.stringify(payload)) }
      // localStorage 失败（容量或隐私模式）时降级到 IndexedDB；两者都失败则草稿丢失但不中断编辑。
      catch (error) { console.warn('保存本地草稿到 localStorage 失败，将尝试 IndexedDB 兜底', error); putDraft({ key: storageKey, ...payload }).catch((idbError) => console.warn('保存本地草稿到 IndexedDB 也失败', idbError)); try { localStorage.removeItem(storageKey) } catch {} }
    }, 1000)
    return () => { if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current) }
  }, [title, content, storageKey])

  useEffect(() => {
    if (!storageKey) return
    let cancelled = false
    const loadDraft = async () => {
      try {
        const raw = localStorage.getItem(storageKey)
        if (raw) { const parsed = JSON.parse(raw) as { title: string; content: string; updatedAt: number }; if (!cancelled && (parsed.title !== initialTitle || parsed.content !== initialContent)) setRestoreBanner(parsed); return }
      } catch (error) { console.warn('读取 localStorage 草稿失败，将尝试 IndexedDB', error) }
      try { const draft = await getDraft(storageKey); if (draft && !cancelled && (draft.title !== initialTitle || draft.content !== initialContent)) setRestoreBanner({ title: draft.title, content: draft.content, updatedAt: draft.updatedAt }) }
      catch (error) { console.warn('读取 IndexedDB 草稿失败', error) }
    }
    void loadDraft()
    return () => { cancelled = true }
  }, [storageKey, initialContent, initialTitle])

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      // 重新上线时，若本地草稿与当前编辑内容一致，立即同步到服务端，避免用户手动触发。
      const trySync = async () => {
        if (!storageKey) return
        let draft: { title: string; content: string } | null = null
        try { const raw = localStorage.getItem(storageKey); if (raw) draft = JSON.parse(raw) }
        catch {}
        if (!draft) { try { const idbDraft = await getDraft(storageKey); if (idbDraft) draft = { title: idbDraft.title, content: idbDraft.content } } catch {} }
        if (!draft || draft.title !== title || draft.content !== content || !title.trim()) return
        void handleSave(true).then(() => { try { localStorage.removeItem(storageKey) } catch {}; void removeDraft(storageKey).catch(() => {}) }).catch(() => {})
      }
      void trySync()
    }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline); window.addEventListener('offline', handleOffline)
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline) }
  }, [storageKey, title, content, handleSave])

  const restoreDraft = async (doSync: boolean) => {
    if (!restoreBanner) return
    setTitle(restoreBanner.title); setContent(restoreBanner.content); setRestoreBanner(null)
    if (doSync && isOnline) { try { await handleSave(); if (storageKey) { try { localStorage.removeItem(storageKey) } catch {}; void removeDraft(storageKey).catch(() => {}) } } catch (error) { console.warn('恢复并同步失败，将保留本地草稿以便稍后重试', error) } }
  }
  const clearLocalDraftAfterSave = () => { try { if (storageKey) localStorage.removeItem(storageKey) } catch {}; if (storageKey) void removeDraft(storageKey).catch(() => {}) }
  const handleKeyDown = (event: React.KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); void handleSave().then(clearLocalDraftAfterSave) } }

  return { content, setContent, title, setTitle, isSaving, lastSaved, activeTab, setActiveTab, wordCount, isOnline, restoreBanner, setRestoreBanner, restoreDraft, clearLocalDraftAfterSave, handleKeyDown, handleSave }
}
