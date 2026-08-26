'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useKnowledgeBasePage } from '@/components/knowledge-bases/useKnowledgeBasePage'
import { KnowledgeGraphPanel } from '@/components/knowledge-bases/KnowledgeGraphPanel'
import { PrototypeGlyph } from '@/components/ui/prototype-glyph'

export default function KnowledgeBasesPage() {
  const page = useKnowledgeBasePage()
  const [showCreate, setShowCreate] = useState(false)

  if (page.loadingBases) return <div className="prototype-loading">加载知识库...</div>

  return <div>
    <header className="prototype-section-head"><div><p className="product-eyebrow">ONLINE NOTES</p><h1 className="page-heading">知识库</h1><p className="page-description">用清晰的边界组织笔记集合与关联知识。</p></div><button className="prototype-button prototype-button--primary" onClick={() => setShowCreate((value) => !value)}>新建知识库</button></header>
    {page.error && <div className="prototype-error">{page.error}</div>}
    {showCreate && <form className="prototype-inline-form" onSubmit={page.handleSubmit}><input value={page.formState.name} onChange={(event) => page.setFormState({ ...page.formState, name: event.target.value })} placeholder="知识库名称"/><input value={page.formState.description} onChange={(event) => page.setFormState({ ...page.formState, description: event.target.value })} placeholder="描述这个知识库的边界"/><button className="prototype-button prototype-button--primary" disabled={page.saving}><PrototypeGlyph name="plus" />{page.saving ? '创建中...' : '创建知识库'}</button></form>}
    <div className="product-kb-layout">
      <aside className="prototype-panel"><div className="prototype-panel-head padded"><h2>知识库</h2><span>{page.knowledgeBases.length}</span></div><div className="prototype-collection">{page.knowledgeBases.map((item) => <button key={item.id} className={page.selectedId === item.id ? 'is-active' : ''} onClick={() => page.setSelectedId(item.id)}><b>{item.name}</b><small>{item.description || '暂无描述'}</small></button>)}{page.knowledgeBases.length === 0 && <div className="prototype-empty-row">还没有知识库。先创建一个，再从笔记列表加入内容。</div>}</div></aside>
      <section className="prototype-panel"><div className="prototype-panel-head padded"><div><h2>{page.selectedKnowledgeBase?.name || '选择知识库'}</h2><small>{page.selectedKnowledgeBase?.description || '选择一个知识库查看其中的笔记'}</small></div><Link className="prototype-button" href={page.selectedId ? `/dashboard/notes?select=knowledge-base&knowledgeBaseId=${encodeURIComponent(page.selectedId)}` : '/dashboard/notes'}>从笔记选择</Link></div><div className="prototype-panel-body">{page.selectedId ? <><div className="prototype-plain-list">{page.links.map((link) => <div className="prototype-plain-row" key={link.id}><span><b>{link.note.title || '无标题笔记'}</b><small>{link.note.summary || '已加入知识库'}</small></span><span className="prototype-row-end"><small>{new Date(link.note.updatedAt).toLocaleDateString()}</small><button type="button" className="prototype-icon-button" aria-label={`从知识库移除 ${link.note.title || '无标题'}`} onClick={() => void page.handleRemoveNote(link.noteId)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/></svg></button></span></div>)}{!page.loadingLinks && page.links.length === 0 && <div className="prototype-empty-row">当前知识库还没有笔记</div>}</div><KnowledgeGraphPanel linksCount={page.links.length} graphProposal={page.graphProposal} visibleGraph={page.visibleGraph} graphNodeLabels={page.graphNodeLabels} buildingGraph={page.buildingGraph} loadingLinks={page.loadingLinks} loadingGraph={page.loadingGraph} savingGraph={page.savingGraph} onBuild={() => void page.handleBuildGraphProposal()} onSave={() => void page.handleSaveGraph()}/></> : <div className="prototype-empty-focus"><strong>选择或新建知识库</strong><span>这里会显示纳入的笔记与图谱概览。</span></div>}</div></section>
    </div>
  </div>
}
