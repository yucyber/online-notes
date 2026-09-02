'use client';

import Link from 'next/link';
import type { RagCitation } from '@/lib/assistant-stream-client';

export default function RagCitationList({ citations }: { citations: RagCitation[] }) {
  if (citations.length === 0) return null;
  return <div className="ink-citations" aria-label="笔记引用">
    <p className="ink-citations-title">引用来源</p>
    {citations.map((citation) => {
      const heading = citation.headingPath.join(' > ');
      const params = new URLSearchParams({ chunkId: citation.chunkId, ...(heading ? { heading } : {}) });
      return <Link key={citation.evidenceId} href={`/dashboard/notes/${citation.noteId}?${params.toString()}`} className="ink-citation-card">
        <span className="ink-citation-title">{citation.noteTitle}</span>
        {heading && <span className="ink-citation-heading">{heading}</span>}
        <p>{citation.excerpt}</p>
      </Link>;
    })}
  </div>;
}
