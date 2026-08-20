'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { categoriesAPI, savedFiltersAPI, tagsAPI } from '@/lib/api'
import type { Category, SavedFilter, Tag } from '@/types'

export function useSearchFilterBar() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isOpen, setIsOpen] = useState(false)
  const [isSemanticOpen, setIsSemanticOpen] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])
  const [keyword, setKeyword] = useState(searchParams.get('keyword') || '')
  const [categoryId, setCategoryId] = useState(searchParams.get('categoryId') || '')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [tagsMode, setTagsMode] = useState<'any' | 'all'>((searchParams.get('tagsMode') as 'any' | 'all') || 'any')
  const [startDate, setStartDate] = useState(searchParams.get('startDate') || '')
  const [endDate, setEndDate] = useState(searchParams.get('endDate') || '')
  const [status, setStatus] = useState(searchParams.get('status') || '')
  const [nlqEnabled, setNlqEnabled] = useState(searchParams.get('nlq') === '1')
  const [nlqMode, setNlqMode] = useState<'keyword' | 'vector' | 'hybrid'>((searchParams.get('mode') as 'keyword' | 'vector' | 'hybrid') || 'hybrid')
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [newFilterName, setNewFilterName] = useState('')

  const loadCategories = async () => { try { setCategories(await categoriesAPI.getAll()) } catch (error) { console.error('Failed to load categories', error) } }
  const loadTags = async () => { try { setTags(await tagsAPI.getAll()) } catch (error) { console.error('Failed to load tags', error) } }
  const loadSavedFilters = async () => { try { setSavedFilters(await savedFiltersAPI.getAll()) } catch (error) { console.error('Failed to load saved filters', error) } }

  useEffect(() => { void Promise.all([loadCategories(), loadTags(), loadSavedFilters()]) }, [])
  useEffect(() => {
    // tagIds 有两种历史格式：多值 ?tagIds=a&tagIds=b 和旧版逗号分隔 ?tagIds=a,b，两者都需解析。
    const tagIds = searchParams.getAll('tagIds').filter((id) => id !== 'undefined' && id !== 'null' && id !== '')
    setSelectedTagIds(tagIds.length > 0 ? tagIds : (searchParams.get('tagIds') || '').split(',').filter(Boolean))
    setKeyword(searchParams.get('keyword') || '')
    setCategoryId(searchParams.get('categoryId') || '')
    setStartDate(searchParams.get('startDate') || '')
    setEndDate(searchParams.get('endDate') || '')
    setStatus(searchParams.get('status') || '')
    setTagsMode((searchParams.get('tagsMode') as 'any' | 'all') || 'any')
    setNlqEnabled(searchParams.get('nlq') === '1')
    setNlqMode((searchParams.get('mode') as 'keyword' | 'vector' | 'hybrid') || 'hybrid')
  }, [searchParams])
  // 选中多个标签时自动切换为 all 模式；单个标签恢复 any，避免用户手动调整。
  useEffect(() => { const next = selectedTagIds.length > 1 ? 'all' : 'any'; if (tagsMode !== next) setTagsMode(next) }, [selectedTagIds, tagsMode])

  const buildParams = (overrides?: { nlqEnabled?: boolean; nlqMode?: 'keyword' | 'vector' | 'hybrid' }) => {
    const params = new URLSearchParams()
    if (keyword) params.set('keyword', keyword)
    if (categoryId) params.set('categoryId', categoryId)
    Array.from(new Set(selectedTagIds.filter(Boolean))).forEach((id) => params.append('tagIds', id))
    if (selectedTagIds.length > 0) params.set('tagsMode', tagsMode)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (status) params.set('status', status)
    if (overrides?.nlqEnabled ?? nlqEnabled) { params.set('nlq', '1'); params.set('mode', overrides?.nlqMode ?? nlqMode) }
    return params
  }

  const handleSearch = (source: 'button' | 'debounce' | 'enter' = 'button') => {
    const nextQuery = buildParams().toString()
    const currentQuery = typeof window !== 'undefined' ? window.location.search.replace(/^\?/, '') : ''
    const searchId = `s_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    try { sessionStorage.setItem('lastSearchId', searchId) } catch {}
    document.dispatchEvent(new CustomEvent('search:trigger', { detail: { searchId, source, keyword, categoryId, tagIds: Array.from(new Set(selectedTagIds.filter(Boolean))), tagsMode, startDate, endDate, status, nlqEnabled, nlqMode, nextQuery, time: new Date().toISOString() } }))
    document.dispatchEvent(new CustomEvent('rum', { detail: { type: 'ui:search_trigger', name: 'Search', value: 1, meta: { searchId, source } } }))
    if (nextQuery !== currentQuery) router.push(`/dashboard/notes?${nextQuery}`)
  }

  const handleFilterToggle = () => { setIsOpen((open) => !open); setIsSemanticOpen(false) }
  const handleSemanticSearch = () => { setIsSemanticOpen((open) => !open); setIsOpen(false) }

  const handleSemanticMode = (mode: 'keyword' | 'vector' | 'hybrid') => {
    setNlqEnabled(true)
    setNlqMode(mode)
    setIsSemanticOpen(false)
    const nextQuery = buildParams({ nlqEnabled: true, nlqMode: mode }).toString()
    router.push(`/dashboard/notes?${nextQuery}`)
  }

  const handleDisableSemanticSearch = () => {
    setNlqEnabled(false)
    setIsSemanticOpen(false)
    const nextQuery = buildParams({ nlqEnabled: false }).toString()
    router.push(nextQuery ? `/dashboard/notes?${nextQuery}` : '/dashboard/notes')
  }

  const handleClear = () => { setKeyword(''); setCategoryId(''); setSelectedTagIds([]); setStartDate(''); setEndDate(''); setStatus(''); setTagsMode('any'); setNlqEnabled(false); setNlqMode('hybrid'); router.push('/dashboard/notes') }
  const handleSaveFilter = async () => {
    if (!newFilterName) return
    try { await savedFiltersAPI.create({ name: newFilterName, criteria: { keyword, categoryId, tagIds: selectedTagIds, startDate, endDate, status: status as 'published' | 'draft' | undefined } }); setNewFilterName(''); setIsSaveModalOpen(false); await loadSavedFilters() } catch (error) { console.error('Failed to save filter', error) }
  }
  const applySavedFilter = (filter: SavedFilter) => {
    const criteria = filter.criteria
    setKeyword(criteria.keyword || ''); setCategoryId(criteria.categoryId || ''); setSelectedTagIds(criteria.tagIds || []); setStartDate(criteria.startDate || ''); setEndDate(criteria.endDate || ''); setStatus(criteria.status || ''); setTagsMode((criteria.tagsMode as 'any' | 'all') || 'any')
    const params = new URLSearchParams()
    if (criteria.keyword) params.set('keyword', criteria.keyword)
    if (criteria.categoryId) params.set('categoryId', criteria.categoryId)
    criteria.tagIds?.forEach((id) => params.append('tagIds', id))
    if (criteria.tagsMode) params.set('tagsMode', criteria.tagsMode)
    if (criteria.startDate) params.set('startDate', criteria.startDate)
    if (criteria.endDate) params.set('endDate', criteria.endDate)
    if (criteria.status) params.set('status', criteria.status)
    router.push(`/dashboard/notes?${params.toString()}`)
  }
  const toggleTag = (tagId: string) => setSelectedTagIds((prev) => prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId])
  const setLastWeek = () => { const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 7); setStartDate(start.toISOString().split('T')[0]); setEndDate(end.toISOString().split('T')[0]) }
  const setLastMonth = () => { const end = new Date(); const start = new Date(); start.setMonth(start.getMonth() - 1); setStartDate(start.toISOString().split('T')[0]); setEndDate(end.toISOString().split('T')[0]) }

  return { isOpen, setIsOpen, isSemanticOpen, categories, tags, savedFilters, keyword, setKeyword, categoryId, setCategoryId, selectedTagIds, setSelectedTagIds, tagsMode, setTagsMode, startDate, setStartDate, endDate, setEndDate, status, setStatus, nlqEnabled, setNlqEnabled, nlqMode, setNlqMode, isSaveModalOpen, setIsSaveModalOpen, newFilterName, setNewFilterName, handleSearch, handleFilterToggle, handleSemanticSearch, handleSemanticMode, handleDisableSemanticSearch, handleClear, handleSaveFilter, applySavedFilter, toggleTag, setLastWeek, setLastMonth }
}
