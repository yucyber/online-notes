'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { knowledgeBasesAPI, type KnowledgeGraphEvidence, type KnowledgeGraphEvidenceResult } from '@/lib/api/knowledge-bases'

type KnowledgeGraphEvidenceListProps = {
  knowledgeBaseId: string
  kind: 'node' | 'edge'
  graphItemId: string
}

export function KnowledgeGraphEvidenceList({ knowledgeBaseId, kind, graphItemId }: KnowledgeGraphEvidenceListProps) {
  const [result, setResult] = useState<KnowledgeGraphEvidenceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedChunkIds, setExpandedChunkIds] = useState<Set<string>>(() => new Set())
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    let active = true
    setLoading(true)
    setError('')
    setResult(null)
    setExpandedChunkIds(new Set())

    const request = kind === 'node'
      ? knowledgeBasesAPI.getNodeEvidence(knowledgeBaseId, graphItemId)
      : knowledgeBasesAPI.getEdgeEvidence(knowledgeBaseId, graphItemId)
    void request
      .then((next) => {
        // node、edge 或 KB 已切换时，旧请求只能自然结束，不能覆盖当前选择。
        if (!active || requestId !== requestIdRef.current) return
        setResult(next)
      })
      .catch(() => {
        if (!active || requestId !== requestIdRef.current) return
        setError('证据加载失败，请稍后重试。')
      })
      .finally(() => {
        if (!active || requestId !== requestIdRef.current) return
        setLoading(false)
      })

    return () => { active = false }
  }, [graphItemId, kind, knowledgeBaseId])

  if (loading) return <p className="knowledge-evidence-status">正在加载证据…</p>
  if (error) return <p className="knowledge-evidence-status" role="alert">{error}</p>
  if (!result || result.items.length === 0) {
    const message = result?.compatibility === 'legacy_graph_without_evidence'
      ? '当前图谱版本没有可定位的原文证据。'
      : '当前项目没有可访问的原文证据。'
    return <p className="knowledge-evidence-status">{message}</p>
  }

  return <div className="knowledge-evidence-list">
    {result.items.map((item) => <EvidenceItem
      key={item.chunkId}
      item={item}
      expanded={expandedChunkIds.has(item.chunkId)}
      onToggle={() => setExpandedChunkIds((current) => {
        const next = new Set(current)
        if (next.has(item.chunkId)) next.delete(item.chunkId)
        else next.add(item.chunkId)
        return next
      })}
    />)}
  </div>
}

function EvidenceItem({ item, expanded, onToggle }: {
  item: KnowledgeGraphEvidence
  expanded: boolean
  onToggle: () => void
}) {
  const heading = item.headingPath.join(' > ')
  const href = `/dashboard/notes/${item.noteId}?chunkId=${encodeURIComponent(item.chunkId)}&heading=${encodeURIComponent(heading)}`
  return <article className="knowledge-evidence-item">
    <header><strong>{item.noteTitle || '无标题笔记'}</strong>{heading ? <span>{heading}</span> : null}</header>
    <p>{expanded ? item.content : item.preview}</p>
    <footer>
      {item.content !== item.preview ? <button type="button" onClick={onToggle}>{expanded ? '收起' : '展开更多'}</button> : <span />}
      <Link href={href}>定位到原文</Link>
    </footer>
  </article>
}
