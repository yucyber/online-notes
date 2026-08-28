'use client'

import { useEffect, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react'
import type { KnowledgeBase } from '@/types'
import { KnowledgeGraphPanel } from './KnowledgeGraphPanel'
import { createKnowledgeGraphSession, updateKnowledgeGraphSession, type KnowledgeGraphSessions } from './knowledge-graph-session'

export interface KnowledgeGraphFocusModeProps {
  knowledgeBases: KnowledgeBase[]
  selectedId: string
  selectedKnowledgeBase: KnowledgeBase | null
  onSelect: (id: string) => void
  onClose: () => void
  graphPanelProps: ComponentProps<typeof KnowledgeGraphPanel>
  error: string
  onRetry: () => void
}

export function KnowledgeGraphFocusMode(props: KnowledgeGraphFocusModeProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const chooseBaseRef = useRef<HTMLButtonElement>(null)
  const [sessions, setSessions] = useState<KnowledgeGraphSessions>({})
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return props.knowledgeBases
    return props.knowledgeBases.filter((item) => `${item.name} ${item.description || ''}`.toLocaleLowerCase().includes(needle))
  }, [props.knowledgeBases, query])

  useEffect(() => {
    chooseBaseRef.current?.focus()
  }, [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (drawerOpen) setDrawerOpen(false)
      else props.onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [drawerOpen, props.onClose])

  useEffect(() => {
    if (drawerOpen) searchRef.current?.focus()
  }, [drawerOpen])

  const trapDrawerFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('input,button:not([disabled])') || [])
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const trapDialogFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (drawerOpen || event.key !== 'Tab') return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('input,button:not([disabled]),a[href]') || [])
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return <div ref={dialogRef} className="knowledge-focus" role="dialog" aria-modal="true" aria-label="知识图谱专注模式" onKeyDown={trapDialogFocus}>
    <header className="knowledge-focus__header">
      <button ref={chooseBaseRef} type="button" className="prototype-button" aria-label="选择知识库" onClick={() => setDrawerOpen(true)}>知识库</button>
      <div><small>{props.graphPanelProps.graphProposal ? '待保存提案' : props.graphPanelProps.visibleGraph ? '已保存图谱' : '尚无图谱'}</small><h2>{props.selectedKnowledgeBase?.name || '知识图谱'}</h2></div>
      <button type="button" className="prototype-button" onClick={props.onClose}>退出专注模式</button>
    </header>
    <main className="knowledge-focus__canvas">
      {props.error ? <div className="knowledge-focus__error" role="alert"><span>{props.error}</span><button type="button" onClick={props.onRetry}>重试</button></div> : null}
      <KnowledgeGraphPanel {...props.graphPanelProps} preserveGraphWhileLoading sessionState={sessions[props.selectedId] || createKnowledgeGraphSession()} onSessionStateChange={(patch) => setSessions((current) => updateKnowledgeGraphSession(current, props.selectedId, patch))} />
    </main>
    {drawerOpen ? <>
      <button type="button" className="knowledge-focus__drawer-backdrop" aria-label="关闭知识库列表" onClick={() => setDrawerOpen(false)} />
      <aside ref={drawerRef} className="knowledge-focus__drawer" aria-label="知识库列表" onKeyDown={trapDrawerFocus}>
        <header><h2>切换知识库</h2><button type="button" aria-label="关闭知识库列表" onClick={() => setDrawerOpen(false)}>×</button></header>
        <input ref={searchRef} type="search" aria-label="搜索知识库" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识库" />
        <div className="knowledge-focus__bases">{filtered.map((item) => <button key={item.id} type="button" className={item.id === props.selectedId ? 'is-active' : ''} onClick={() => { props.onSelect(item.id); setDrawerOpen(false) }}><strong>{item.name}</strong><small>{item.description || '暂无描述'}{item.id === props.selectedId ? ` · ${props.graphPanelProps.links.length} 篇笔记` : ''}</small></button>)}</div>
      </aside>
    </> : null}
  </div>
}
