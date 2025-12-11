'use client'
import React from 'react'

export function Pagination({ page, size, total, onPageChange }: { page: number; size: number; total: number; onPageChange: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / Math.max(1, size)))
  const canPrev = page > 1
  const canNext = page < totalPages
  const goto = (p: number) => onPageChange(Math.min(totalPages, Math.max(1, p)))

  return (
    <nav aria-label="分页导航" className="flex items-center gap-2">
      <button className="px-2 py-1 border rounded" onClick={() => goto(1)} disabled={!canPrev} aria-label="第一页">«</button>
      <button className="px-2 py-1 border rounded" onClick={() => goto(page - 1)} disabled={!canPrev} aria-label="上一页">‹</button>
      <span className="text-sm">第 {page} / {totalPages} 页</span>
      <button className="px-2 py-1 border rounded" onClick={() => goto(page + 1)} disabled={!canNext} aria-label="下一页">›</button>
      <button className="px-2 py-1 border rounded" onClick={() => goto(totalPages)} disabled={!canNext} aria-label="最后一页">»</button>
    </nav>
  )
}

export function PageSizeSelect({ size, onSizeChange, options = [10, 20, 50] }: { size: number; onSizeChange: (s: number) => void; options?: number[] }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>每页</span>
      <select
        className="rounded text-sm"
        value={size}
        onChange={(e) => onSizeChange(parseInt(e.target.value, 10))}
        aria-label="每页数量"
        style={{ minHeight: 44, padding: '0 12px', backgroundColor: 'var(--surface-2)', color: 'var(--on-surface)', border: '1px solid var(--border)', outlineOffset: 2 }}
      >
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </label>
  )
}
