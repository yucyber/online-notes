'use client'

import { useRef, useState } from 'react'

export function SummaryPreview({ summary, fallback }: { summary?: string; fallback: string }) {
  const [isVisible, setIsVisible] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const handleMouseEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setIsVisible(true), 500)
  }

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setIsVisible(false), 200)
  }

  return (
    <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <div className="text-sm line-clamp-3 mb-4 leading-relaxed cursor-default" style={{ color: 'var(--on-surface)' }}>
        {summary || fallback}
      </div>
      {summary && isVisible && (
        <div
          className="absolute bottom-full left-0 mb-2 w-80 p-4 rounded-xl shadow-2xl z-50 text-sm leading-relaxed animate-in fade-in zoom-in duration-200"
          style={{
            background: 'var(--surface-2)',
            color: 'var(--on-surface)',
            border: '1px solid var(--border)',
            backdropFilter: 'blur(12px)',
            maxHeight: '300px',
            overflowY: 'auto',
            pointerEvents: 'auto',
          }}
          onMouseEnter={() => {
            if (timerRef.current) clearTimeout(timerRef.current)
          }}
          onMouseLeave={handleMouseLeave}
        >
          {summary}
        </div>
      )}
    </div>
  )
}
