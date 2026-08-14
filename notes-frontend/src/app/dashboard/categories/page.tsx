'use client'

import { useCategoriesPage } from '@/components/categories/useCategoriesPage'

export default function CategoriesPage() {
  const page = useCategoriesPage()
  return <div>
    <header className="prototype-section-head"><div><p className="product-eyebrow">ONLINE NOTES</p><h1 className="page-heading">分类管理</h1><p className="page-description">用层级结构组织知识领域与归档路径。</p></div><button className="prototype-button prototype-button--primary" onClick={page.resetForm}>新建分类</button></header>
    {page.error && <div className="prototype-error">{page.error}</div>}
    <div className="product-category-layout">
      <section><div className="prototype-panel-head"><h2>分类结构</h2><small>{page.categories.length} 个分类</small></div><div className="prototype-category-tree">{page.categories.map((category) => <button key={category.id} className="prototype-plain-row" style={{ paddingLeft: category.parentId ? 32 : 10 }} onClick={() => page.startEdit(category)}><span><i style={{ background: category.color || 'var(--product-accent)' }}/><b>{category.name}</b></span><small>{category.noteCount ?? 0} 篇</small></button>)}{!page.loading && page.categories.length === 0 && <div className="prototype-empty-row">暂无分类</div>}</div></section>
      <aside className="prototype-panel"><div className="prototype-panel-head padded"><h2>{page.editingId ? '编辑分类' : '新建分类'}</h2></div><form className="prototype-panel-body prototype-form-stack" onSubmit={page.handleSubmit}><input className="prototype-field" aria-label="分类名称" placeholder="分类名称" value={page.formState.name} onChange={(event) => page.setFormState({ ...page.formState, name: event.target.value })}/><textarea className="prototype-field" aria-label="分类描述" placeholder="分类用途与边界" value={page.formState.description} onChange={(event) => page.setFormState({ ...page.formState, description: event.target.value })}/><div className="prototype-hint">结构良好 · 用一致命名保持归档路径清晰</div><button className="prototype-button prototype-button--primary" disabled={page.saving}>{page.saving ? '保存中...' : '保存修改'}</button></form></aside>
    </div>
  </div>
}
