'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useKnowledgeBasePage } from '@/components/knowledge-bases/useKnowledgeBasePage'
import { KnowledgeGraphPanel } from '@/components/knowledge-bases/KnowledgeGraphPanel'
import { PrototypeGlyph } from '@/components/ui/prototype-glyph'
import { KnowledgeGraphFocusMode } from '@/components/knowledge-bases/KnowledgeGraphFocusMode'

export default function KnowledgeBasesPage() {
  const page = useKnowledgeBasePage()
  const [showCreate, setShowCreate] = useState(false)
  const [activeTab, setActiveTab] = useState<'graph' | 'notes'>('graph')
  const [focusOpen, setFocusOpen] = useState(false)
  const focusTriggerRef = useRef<HTMLButtonElement>(null)

  const closeFocusMode = () => {
    setFocusOpen(false)
    requestAnimationFrame(() => focusTriggerRef.current?.focus())
  }

  if (page.loadingBases) return <div className="prototype-loading">加载知识库...</div>

  return <div className="knowledge-base-page">
    <header className="prototype-section-head">
      <div><p className="product-eyebrow">ONLINE NOTES</p><h1 className="page-heading">知识库</h1><p className="page-description">用清晰的边界组织笔记集合与关联知识。</p></div>
      <button className="prototype-button prototype-button--primary" onClick={() => setShowCreate((value) => !value)}>新建知识库</button>
    </header>
    {page.error ? <div className="prototype-error">{page.error}</div> : null}
    {showCreate ? <form className="prototype-inline-form" onSubmit={page.handleSubmit}>
      <input value={page.formState.name} onChange={(event) => page.setFormState({ ...page.formState, name: event.target.value })} placeholder="知识库名称" />
      <input value={page.formState.description} onChange={(event) => page.setFormState({ ...page.formState, description: event.target.value })} placeholder="描述这个知识库的边界" />
      <button className="prototype-button prototype-button--primary" disabled={page.saving}><PrototypeGlyph name="plus" />{page.saving ? '创建中...' : '创建知识库'}</button>
    </form> : null}

    <div className="product-kb-layout">
      <aside className="prototype-panel">
        <header className="prototype-panel-head padded"><h2>知识库</h2><span>{page.knowledgeBases.length}</span></header>
        <div className="prototype-collection">{page.knowledgeBases.map((item) => <button key={item.id} className={page.selectedId === item.id ? 'is-active' : ''} onClick={() => { page.setSelectedId(item.id); setActiveTab('graph') }}>
          <b>{item.name}<span className="n">{page.selectedId === item.id ? page.links.length : ''}</span></b><small>{item.description || '暂无描述'}</small>
        </button>)}{page.knowledgeBases.length === 0 ? <p>还没有知识库。先创建一个，再从笔记列表加入内容。</p> : null}</div>
      </aside>

      <section className="prototype-panel knowledge-base-detail">
        {page.selectedId ? <>
          <header className="prototype-panel-head padded"><div><h2>{page.selectedKnowledgeBase?.name}</h2><small>{page.selectedKnowledgeBase?.description || '暂无描述'} · {page.links.length} 篇笔记</small></div><div className="knowledge-base-head-actions"><button ref={focusTriggerRef} type="button" className="prototype-button" onClick={() => setFocusOpen(true)}>进入图谱专注模式</button><Link className="prototype-button" href={`/dashboard/notes?select=knowledge-base&knowledgeBaseId=${encodeURIComponent(page.selectedId)}`}>从笔记选择</Link></div></header>
          <nav className="detail-tabs" aria-label="知识库视图">
            <button type="button" className={activeTab === 'graph' ? 'is-active' : ''} onClick={() => setActiveTab('graph')}>知识图谱 <span>{page.visibleGraph ? `${page.visibleGraph.nodes.length} 节点 / ${page.visibleGraph.edges.length} 关系` : '未生成'}</span></button>
            <button type="button" className={activeTab === 'notes' ? 'is-active' : ''} onClick={() => setActiveTab('notes')}>笔记 <span>{page.links.length}</span></button>
          </nav>
          {activeTab === 'graph' ? <KnowledgeGraphPanel links={page.links} graphProposal={page.graphProposal} visibleGraph={page.visibleGraph} buildingGraph={page.buildingGraph} loadingLinks={page.loadingLinks} loadingGraph={page.loadingGraph} savingGraph={page.savingGraph} onBuild={() => void page.handleBuildGraphProposal()} onSave={() => void page.handleSaveGraph()} /> : <div className="knowledge-base-note-list">
            {page.links.map((link) => <article key={link.id}><span><b>{link.note.title || '无标题笔记'}</b><small>{link.note.summary || '已加入知识库'}</small></span><span><small>{new Date(link.note.updatedAt).toLocaleDateString()}</small><button type="button" className="prototype-icon-button" aria-label={`从知识库移除 ${link.note.title || '无标题'}`} onClick={() => void page.handleRemoveNote(link.noteId)}><PrototypeGlyph name="trash" /></button></span></article>)}
            {!page.loadingLinks && page.links.length === 0 ? <div className="knowledge-graph-empty">当前知识库还没有笔记。</div> : null}
          </div>}
        </> : <div className="prototype-empty-focus"><strong>选择或新建知识库</strong><span>这里会显示纳入的笔记与知识图谱。</span></div>}
      </section>
    </div>
    {focusOpen ? <KnowledgeGraphFocusMode knowledgeBases={page.knowledgeBases} selectedId={page.selectedId} selectedKnowledgeBase={page.selectedKnowledgeBase} onSelect={(id) => page.setSelectedId(id)} onClose={closeFocusMode} error={page.error} onRetry={() => void page.retrySelectedKnowledgeBase()} graphPanelProps={{ links: page.links, graphProposal: page.graphProposal, visibleGraph: page.visibleGraph, buildingGraph: page.buildingGraph, loadingLinks: page.loadingLinks, loadingGraph: page.loadingGraph, savingGraph: page.savingGraph, onBuild: () => void page.handleBuildGraphProposal(), onSave: () => void page.handleSaveGraph() }} /> : null}
  </div>
}
