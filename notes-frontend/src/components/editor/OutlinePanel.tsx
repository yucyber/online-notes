"use client"
import { useEffect, useMemo, useRef, useState } from 'react'

type TocItem = { id: string; text: string; level: number; children?: TocItem[] }

function buildToc(html: string): TocItem[] {
  const doc = new DOMParser().parseFromString(html || '<p></p>', 'text/html')
  const hs = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLHeadingElement[]
  const items = hs.map((h, i) => {
    const id = h.id || ((h.textContent || '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-') + '-' + i)
    h.id = id
    return { id, text: h.textContent || '', level: Number(h.tagName.substring(1)) }
  })
  const root: TocItem[] = []
  const stack: TocItem[] = []
  items.forEach(it => {
    while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop()
    const node = { ...it, children: [] as TocItem[] }
    if (!stack.length) root.push(node)
    else stack[stack.length - 1].children!.push(node)
    stack.push(node)
  })
  return root
}

export default function OutlinePanel({ html }: { html: string }) {
  const [toc, setToc] = useState<TocItem[]>([])
  const [currentId, setCurrentId] = useState<string>('')
  const [filter, setFilter] = useState('')
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    const t = buildToc(html)
    setToc(t)
    if (observerRef.current) observerRef.current.disconnect()
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    observerRef.current = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => (b.intersectionRatio - a.intersectionRatio))
      if (visible[0]?.target?.id) setCurrentId(visible[0].target.id)
    }, { threshold: [0.6] })
    headings.forEach(h => observerRef.current!.observe(h))
    return () => observerRef.current?.disconnect()
  }, [html])

  const filtered = useMemo(() => {
    if (!filter.trim()) return toc
    const hit = (n: TocItem): TocItem | null => {
      const ok = n.text.toLowerCase().includes(filter.toLowerCase())
      const children = (n.children || []).map(hit).filter(Boolean) as TocItem[]
      return ok || children.length ? { ...n, children } : null
    }
    return toc.map(hit).filter(Boolean) as TocItem[]
  }, [toc, filter])

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      scrollTo(id)
    }
  }
  const render = (nodes: TocItem[]) => nodes.map(n => (
    <button
      key={n.id}
      role="treeitem"
      aria-level={n.level}
      aria-current={currentId === n.id ? 'true' : undefined}
      onClick={() => scrollTo(n.id)}
      onKeyDown={(e) => onKey(e, n.id)}
      className="cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-blue-500"
      style={{
        paddingLeft: `${(n.level - 1) * 12}px`,
        minHeight: 44,
        display: 'flex',
        alignItems: 'center',
        borderRadius: 6,
        background: currentId === n.id ? '#eef2ff' : 'transparent',
        color: currentId === n.id ? '#111827' : '#374151',
        paddingRight: 12,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.text}</span>
      {n.children?.length ? <div role="group" className="w-full">{render(n.children)}</div> : null}
    </button>
  ))

  return (
    <aside role="navigation" aria-label="文档大纲" className="bg-white"
      style={{ width: 280, minWidth: 240, maxWidth: 360, border: '1px solid #e5e7eb', borderRadius: 12 }}
    >
      <div style={{ padding: 12, borderBottom: '1px solid #e5e7eb' }}>
        <div className="text-sm font-medium">文档大纲</div>
        <input type="text" placeholder="搜索大纲…" value={filter} onChange={e => setFilter(e.target.value)} aria-label="搜索大纲" className="mt-2 w-full border rounded px-2 py-1 text-sm" />
      </div>
      <div role="tree" aria-label="标题列表" style={{ padding: 8, maxHeight: 'calc(100vh - 180px)', overflow: 'auto' }}>
        {render(filtered)}
      </div>
    </aside>
  )
}
