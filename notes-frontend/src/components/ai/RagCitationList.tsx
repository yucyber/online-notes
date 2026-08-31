'use client';

import Link from 'next/link';
import type { RagCitation } from '@/lib/ai-client';

export default function RagCitationList({ citations }: { citations: RagCitation[] }) {
  if (citations.length === 0) return null;
  return <div className="mt-3 space-y-2 border-t border-[var(--product-line)] pt-3" aria-label="笔记引用">
    <p className="text-xs font-medium text-[var(--product-text-secondary)]">基于你的笔记</p>
    {citations.map((citation) => {
      const heading = citation.headingPath.join(' > ');
      const params = new URLSearchParams({ chunk: citation.chunkId, ...(heading ? { heading } : {}) });
      return <Link key={citation.evidenceId} href={`/dashboard/notes/${citation.noteId}?${params.toString()}`} className="block rounded-md border border-[var(--product-line)] p-2 text-xs hover:bg-[var(--product-panel-soft)]">
        <span className="font-medium text-[var(--product-text-primary)]">{citation.noteTitle}</span>
        {heading && <span className="ml-1 text-[var(--product-text-secondary)]">{heading}</span>}
        <p className="mt-1 line-clamp-2 text-[var(--product-text-secondary)]">{citation.excerpt}</p>
      </Link>;
    })}
  </div>;
}
