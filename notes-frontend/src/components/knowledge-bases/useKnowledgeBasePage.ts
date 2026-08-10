'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { knowledgeBasesAPI } from '@/lib/api'
import type { KnowledgeBase, KnowledgeBaseNoteLink, KnowledgeGraphProposal } from '@/types'

const emptyForm = {
  name: '',
  description: '',
}

export function getKnowledgeBaseErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object') {
    const axiosLikeError = error as { response?: { data?: { message?: string } } }
    if (axiosLikeError.response?.data?.message) return axiosLikeError.response.data.message
  }
  return fallback
}

export function useKnowledgeBasePage() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [links, setLinks] = useState<KnowledgeBaseNoteLink[]>([])
  const [formState, setFormState] = useState(emptyForm)
  const [loadingBases, setLoadingBases] = useState(true)
  const [loadingLinks, setLoadingLinks] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removingNoteId, setRemovingNoteId] = useState('')
  const [graphProposal, setGraphProposal] = useState<KnowledgeGraphProposal | null>(null)
  const [savedGraph, setSavedGraph] = useState<KnowledgeGraphProposal | null>(null)
  const [buildingGraph, setBuildingGraph] = useState(false)
  const [loadingGraph, setLoadingGraph] = useState(false)
  const [savingGraph, setSavingGraph] = useState(false)
  const [error, setError] = useState('')

  const selectedKnowledgeBase = useMemo(
    () => knowledgeBases.find((item) => item.id === selectedId) || null,
    [knowledgeBases, selectedId],
  )
  const visibleGraph = graphProposal || savedGraph
  const graphNodeLabels = useMemo(
    () => new Map((visibleGraph?.nodes || []).map((node) => [node.id, node.label])),
    [visibleGraph],
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
      setError(getKnowledgeBaseErrorMessage(err, '知识库加载失败，请稍后重试'))
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
      setError(getKnowledgeBaseErrorMessage(err, '知识库笔记加载失败，请稍后重试'))
    } finally {
      setLoadingLinks(false)
    }
  }

  const loadGraph = async (knowledgeBaseId: string) => {
    if (!knowledgeBaseId) {
      setSavedGraph(null)
      return
    }

    try {
      setLoadingGraph(true)
      const graph = await knowledgeBasesAPI.getGraph(knowledgeBaseId)
      setSavedGraph(graph)
    } catch (err) {
      console.error('Failed to load knowledge base graph', err)
      setSavedGraph(null)
    } finally {
      setLoadingGraph(false)
    }
  }

  useEffect(() => {
    void loadKnowledgeBases()
  }, [])

  useEffect(() => {
    setGraphProposal(null)
    void loadLinks(selectedId)
    void loadGraph(selectedId)
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
      setError(getKnowledgeBaseErrorMessage(err, '创建知识库失败，请重试'))
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
      setError(getKnowledgeBaseErrorMessage(err, '移除笔记失败，请稍后重试'))
    } finally {
      setRemovingNoteId('')
    }
  }

  const handleBuildGraphProposal = async () => {
    if (!selectedId || links.length === 0) return
    try {
      setBuildingGraph(true)
      setError('')
      const proposal = await knowledgeBasesAPI.buildGraphProposal(selectedId)
      setGraphProposal(proposal)
    } catch (err) {
      console.error('Failed to build knowledge graph proposal', err)
      setError(getKnowledgeBaseErrorMessage(err, '知识图谱提案生成失败，请稍后重试'))
    } finally {
      setBuildingGraph(false)
    }
  }

  const handleSaveGraph = async () => {
    if (!selectedId || !graphProposal) return
    try {
      setSavingGraph(true)
      setError('')
      const saved = await knowledgeBasesAPI.saveGraph(selectedId, {
        nodes: graphProposal.nodes,
        edges: graphProposal.edges,
      })
      setSavedGraph(saved)
      setGraphProposal(null)
    } catch (err) {
      console.error('Failed to save knowledge graph', err)
      setError(getKnowledgeBaseErrorMessage(err, '知识图谱保存失败，请稍后重试'))
    } finally {
      setSavingGraph(false)
    }
  }

  return {
    knowledgeBases,
    selectedId,
    setSelectedId,
    links,
    formState,
    setFormState,
    loadingBases,
    loadingLinks,
    saving,
    removingNoteId,
    graphProposal,
    visibleGraph,
    graphNodeLabels,
    buildingGraph,
    loadingGraph,
    savingGraph,
    error,
    selectedKnowledgeBase,
    loadLinks,
    handleSubmit,
    handleRemoveNote,
    handleBuildGraphProposal,
    handleSaveGraph,
  }
}
