'use client'

import Link from 'next/link'
import { Fragment, useState } from 'react'
import type { SemanticChunkHit } from '@/lib/api/semantic'

function HighlightedText({ text, query }: { text: string; query?: string }) {
  const term = query?.trim()
  if (!term) return <>{text}</>
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'))
  return <>{parts.map((part, index) => (
    part.toLocaleLowerCase() === term.toLocaleLowerCase()
      ? <mark key={`${part}-${index}`}>{part}</mark>
      : <Fragment key={`${part}-${index}`}>{part}</Fragment>
  ))}</>
}

export function SearchHitEvidence({
  noteId,
  hit,
  additionalCount,
  additionalHits = [],
  query,
}: {
  noteId: string
  hit: SemanticChunkHit
  additionalCount: number
  additionalHits?: SemanticChunkHit[]
  query?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const path = hit.headingPath.length > 0 ? hit.headingPath.join(' / ') : '正文命中'
  const visibleExtras = additionalHits.slice(0, 3)

  return (
    <div className="search-hit-evidence" data-testid="search-hit-evidence">
      <Link className="search-hit-evidence__main" href={`/dashboard/notes/${noteId}`}>
        <div className="search-hit-evidence__heading">
          <strong>{path}</strong>
          <span>{hit.matchType === 'semantic' ? '语义相关' : '关键词命中'}</span>
        </div>
        <p title={hit.content}>
          {hit.matchType === 'keyword'
            ? <HighlightedText text={hit.content} query={query} />
            : hit.content}
        </p>
      </Link>
      {additionalCount > 0 ? (
        <button
          type="button"
          className="search-hit-evidence__more"
          aria-expanded={expanded}
          aria-label={`${expanded ? '收起' : '展开'}另外命中 ${additionalCount} 处`}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : `另外命中 ${additionalCount} 处`} ›
        </button>
      ) : null}
      {expanded && visibleExtras.length > 0 ? (
        <div className="search-hit-evidence__extras">
          {visibleExtras.map((extra) => (
            <Link key={extra.chunkId} href={`/dashboard/notes/${noteId}`}>
              <strong>{extra.headingPath.length > 0 ? extra.headingPath.join(' / ') : '正文命中'}</strong>
              <p>{extra.content}</p>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
