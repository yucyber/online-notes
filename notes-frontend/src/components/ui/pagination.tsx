'use client'

import { PrototypeGlyph } from './prototype-glyph'

export function Pagination({ page, size, total, onPageChange }: { page: number; size: number; total: number; onPageChange: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / Math.max(1, size)))
  const canPrev = page > 1
  const canNext = page < totalPages
  const goto = (next: number) => onPageChange(Math.min(totalPages, Math.max(1, next)))
  return <nav aria-label="分页导航" className="prototype-pager-buttons">
    <button className="prototype-page-button" onClick={() => goto(page - 1)} disabled={!canPrev} aria-label="上一页"><PrototypeGlyph name="chevron-left" /></button>
    <button className="prototype-page-button current" aria-current="page">{page}</button>
    {totalPages > 1 && page !== totalPages && <button className="prototype-page-button" onClick={() => goto(totalPages)}>{totalPages}</button>}
    <button className="prototype-page-button" onClick={() => goto(page + 1)} disabled={!canNext} aria-label="下一页"><PrototypeGlyph name="chevron-right" /></button>
  </nav>
}

export function PageSizeSelect({ size, onSizeChange, options = [10, 20, 50] }: { size: number; onSizeChange: (s: number) => void; options?: number[] }) {
  return <label className="prototype-page-size"><span>共用分页 · 每页</span><select value={size} onChange={(event) => onSizeChange(Number(event.target.value))} aria-label="每页数量">{options.map((option) => <option key={option} value={option}>{option}</option>)}</select><span>篇</span></label>
}
