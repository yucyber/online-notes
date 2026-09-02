'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { fetchChunkEvidence, type ChunkEvidence, type ChunkNeighbor } from '@/lib/assistant-api';

type Props = { noteId: string; chunkId: string; heading?: string[]; onLocated?: () => void };

export default function ChunkEvidenceViewer({ noteId, chunkId, heading, onLocated }: Props) {
  const [target, setTarget] = useState({ noteId, chunkId });
  const [evidence, setEvidence] = useState<ChunkEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showContext, setShowContext] = useState(false);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    let active = true;
    const requestSeq = ++requestSeqRef.current;
    setLoading(true);
    setError('');
    setEvidence(null);
    // heading 由调用方内联数组传入时每次渲染引用都变，只有切换查看目标才需重新拉取，故不进依赖数组。
    void fetchChunkEvidence(target.noteId, target.chunkId, { before: 1, after: 1, ...(heading?.length ? { heading } : {}) })
      .then((next) => { if (active && requestSeq === requestSeqRef.current) setEvidence(next); })
      .catch(() => { if (active && requestSeq === requestSeqRef.current) setError('证据加载失败，请稍后重试。'); })
      .finally(() => { if (active && requestSeq === requestSeqRef.current) setLoading(false); });
    return () => { active = false; };
  }, [target.noteId, target.chunkId]);

  if (loading) return <p className="assistant-evidence-status">正在加载原文…</p>;
  if (error) return <p className="assistant-evidence-status" role="alert">{error}</p>;
  if (!evidence) return null;

  const openNeighbor = (neighbor: ChunkNeighbor) => { setTarget({ noteId: evidence.noteId, chunkId: neighbor.chunkId }); setShowContext(false); };
  const headingPath = evidence.headingPath.length ? evidence.headingPath : heading || [];
  const query = new URLSearchParams();
  query.set('chunkId', evidence.chunkId);
  if (headingPath.length) query.set('heading', headingPath.join(' > '));
  const href = `/dashboard/notes/${evidence.noteId}?${query.toString()}`;

  return (
    <article className="assistant-evidence" aria-label="引用原文">
      <header className="assistant-evidence-head">
        <strong>{evidence.noteTitle}</strong>
        {headingPath.length > 0 && <span className="assistant-evidence-path">{headingPath.join(' > ')}</span>}
        {evidence.relocated && <span className="assistant-evidence-badge">已重新定位</span>}
      </header>
      <p className="assistant-evidence-content">{evidence.content}</p>
      <button type="button" className="assistant-evidence-toggle" onClick={() => setShowContext((v) => !v)}>
        {showContext ? '收起上下文' : '展开上下文'}
      </button>
      {showContext && (
        <div className="assistant-evidence-neighbors">
          {evidence.neighbors.before.map((n) => (
            <button key={n.chunkId} type="button" onClick={() => openNeighbor(n)}>
              <span aria-hidden="true">↑ </span>{n.excerpt}
            </button>
          ))}
          {evidence.neighbors.after.map((n) => (
            <button key={n.chunkId} type="button" onClick={() => openNeighbor(n)}>
              {n.excerpt}<span aria-hidden="true"> ↓</span>
            </button>
          ))}
        </div>
      )}
      <footer className="assistant-evidence-foot">
        <span>更新于 {new Date(evidence.noteUpdatedAt).toLocaleDateString()}</span>
        <Link href={href} onClick={() => onLocated?.()}>定位到原文</Link>
      </footer>
    </article>
  );
}
