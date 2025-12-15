"use client"
import { useEffect, useMemo, useRef, useState } from 'react'

type TocItem = { id: string; text: string; level: number; children?: TocItem[]; index: number }

function buildToc(html: string): TocItem[] {
  const doc = new DOMParser().parseFromString(html || '<p></p>', 'text/html')
  const hs = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLHeadingElement[]
  const items = hs.map((h, i) => {
    const id = h.id || ((h.textContent || '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-') + '-' + i)
    h.id = id
    return { id, text: h.textContent || '', level: Number(h.tagName.substring(1)), index: i }
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

  const scrollTo = (id: string, index: number) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      // Dispatch event for Tiptap editor to handle scrolling by index
      document.dispatchEvent(new CustomEvent('editor:scrollToHeading', { detail: { index } }))
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, id: string, index: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      scrollTo(id, index)
    }
  }
  const render = (nodes: TocItem[]) => nodes.map(n => (
    <li key={n.id} className="list-none">
      <button
        role="treeitem"
        aria-level={n.level}
        aria-current={currentId === n.id ? 'true' : undefined}
        onClick={() => scrollTo(n.id, n.index)}
        onKeyDown={(e) => onKey(e, n.id, n.index)}
        className={`
          group flex w-full items-center text-left text-sm transition-colors duration-200
          ${currentId === n.id ? 'text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-900'}
        `}
        style={{
          paddingTop: 6,
          paddingBottom: 6,
          paddingLeft: `${(n.level - 1) * 16 + 12}px`, // Indentation
          borderLeft: currentId === n.id ? '2px solid #2563eb' : '2px solid transparent', // Active marker
        }}
      >
        <span className="truncate">{n.text}</span>
      </button>
      {n.children?.length ? (
        <ul role="group" className="m-0 p-0">
          {render(n.children)}
        </ul>
      ) : null}
    </li>
  ))

  return (
    <div className="w-full">
      <div className="mb-3 px-2">
        <input
          type="text"
          placeholder="搜索大纲..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          aria-label="搜索大纲"
          className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 focus:border-blue-500 focus:bg-white focus:outline-none"
        />
      </div>
      <ul role="tree" aria-label="标题列表" className="max-h-[calc(100vh-240px)] overflow-y-auto overflow-x-hidden">
        {render(filtered)}
      </ul>
    </div>
  )
}
