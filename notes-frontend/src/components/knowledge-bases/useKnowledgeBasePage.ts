'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { knowledgeBasesAPI } from '@/lib/api'
import { aiRunsAPI, type AiRunStage } from '@/lib/api/ai-runs'
import type { KnowledgeGraphBuildResponse } from '@/lib/api/knowledge-bases'
import type { KnowledgeBase, KnowledgeBaseNoteLink, KnowledgeGraphProposal } from '@/types'

const emptyForm = {
  name: '',
  description: '',
}

export interface KnowledgeGraphTimingSummary {
  durationMs?: number
  stages: AiRunStage[]
}

function inlineGraphTiming(response: KnowledgeGraphBuildResponse): KnowledgeGraphTimingSummary {
  const durationMs = response.timing?.durationMs ?? response.durationMs
  const stages = response.timing?.stages ?? response.stages ?? []
  return { durationMs, stages }
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
  const [graphTiming, setGraphTiming] = useState<KnowledgeGraphTimingSummary | null>(null)
  const [error, setError] = useState('')
  const linksRequestRef = useRef(0)
  const graphRequestRef = useRef(0)
  const graphBuildRequestRef = useRef(0)

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
    const requestId = ++linksRequestRef.current
    if (!knowledgeBaseId) {
      setLinks([])
      return
    }

    try {
      setLoadingLinks(true)
      setError('')
      const data = await knowledgeBasesAPI.getNotes(knowledgeBaseId)
      if (requestId === linksRequestRef.current) setLinks(data)
    } catch (err) {
      if (requestId === linksRequestRef.current) {
        console.error('Failed to load knowledge base notes', err)
        setError(getKnowledgeBaseErrorMessage(err, '知识库笔记加载失败，请稍后重试'))
      }
    } finally {
      if (requestId === linksRequestRef.current) setLoadingLinks(false)
    }
  }

  const loadGraph = async (knowledgeBaseId: string) => {
    const requestId = ++graphRequestRef.current
    if (!knowledgeBaseId) {
      setSavedGraph(null)
      return
    }

    try {
      setLoadingGraph(true)
      const graph = await knowledgeBasesAPI.getGraph(knowledgeBaseId)
      if (requestId === graphRequestRef.current) setSavedGraph(graph)
    } catch (err) {
      if (requestId === graphRequestRef.current) {
        console.error('Failed to load knowledge base graph', err)
        setSavedGraph(null)
        setError(getKnowledgeBaseErrorMessage(err, '知识图谱加载失败，请重试'))
      }
    } finally {
      if (requestId === graphRequestRef.current) setLoadingGraph(false)
    }
  }

  useEffect(() => {
    void loadKnowledgeBases()
  }, [])

  useEffect(() => {
    setGraphProposal(null)
    setGraphTiming(null)
    setBuildingGraph(false)
    graphBuildRequestRef.current += 1
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
    // 生成期间切换知识库时，旧 proposal 和 timing 都不能落到新知识库。
    const requestId = ++graphBuildRequestRef.current
    try {
      setBuildingGraph(true)
      setGraphTiming(null)
      setError('')
      const proposal = await knowledgeBasesAPI.buildGraphProposal(selectedId)
      if (requestId !== graphBuildRequestRef.current) return
      setGraphProposal(proposal)
      setBuildingGraph(false)
      const inlineTiming = inlineGraphTiming(proposal)
      if (!proposal.runId) {
        setGraphTiming(inlineTiming)
        return
      }
      try {
        const run = await aiRunsAPI.getRun(proposal.runId)
        if (requestId === graphBuildRequestRef.current) {
          setGraphTiming({ durationMs: run.durationMs ?? inlineTiming?.durationMs, stages: run.stages })
        }
      } catch {
        if (requestId === graphBuildRequestRef.current) {
          setGraphTiming(inlineTiming)
        }
      }
    } catch {
      if (requestId === graphBuildRequestRef.current) {
        setGraphTiming(null)
        setError('知识图谱提案生成失败，请稍后重试')
      }
    } finally {
      if (requestId === graphBuildRequestRef.current) setBuildingGraph(false)
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

  const retrySelectedKnowledgeBase = async () => {
    if (!selectedId) return
    await Promise.all([loadLinks(selectedId), loadGraph(selectedId)])
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
    graphTiming,
    error,
    selectedKnowledgeBase,
    loadLinks,
    handleSubmit,
    handleRemoveNote,
    handleBuildGraphProposal,
    handleSaveGraph,
    retrySelectedKnowledgeBase,
  }
}
