'use client'

import type { ChangeEvent } from 'react'
import { useSearchFilterBar } from './useSearchFilterBar'

export default function SearchFilterBar() {
  const page = useSearchFilterBar()
  const setValue = (setter: (value: string) => void) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setter(event.target.value)

  return <div className="prototype-search-shell">
    <div className="prototype-search-toolbar" aria-label="笔记搜索与筛选">
      <label className="prototype-search-box">
        <svg aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <input id="global-search" type="text" placeholder="搜索标题、内容或标签" value={page.keyword} onChange={setValue(page.setKeyword)} onKeyDown={(event) => event.key === 'Enter' && page.handleSearch('enter')} />
      </label>

      <label className="prototype-filter-select">
        <select aria-label="分类" value={page.categoryId} onChange={setValue(page.setCategoryId)}><option value="">全部分类</option>{page.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
        <svg aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>
      </label>

      <label className="prototype-filter-select">
        <select aria-label="状态" value={page.status} onChange={setValue(page.setStatus)}><option value="">全部状态</option><option value="published">已发布</option><option value="draft">草稿</option></select>
        <svg aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>
      </label>

      <button type="button" className="prototype-filter-action" aria-expanded={page.isOpen} onClick={() => page.handleFilterToggle()}>
        <svg aria-hidden="true"><path d="M4 5h16l-6 7v5l-4 2v-7z"/></svg>筛选
      </button>

      <button type="button" className="prototype-semantic-button" aria-pressed={page.nlqEnabled} aria-expanded={page.isSemanticOpen} onClick={() => page.handleSemanticSearch()}>
        <svg aria-hidden="true"><path d="M12 3v18M3 12h18"/></svg>语义搜索
      </button>
    </div>

    {page.isOpen && <div className="prototype-filter-popover" role="dialog" aria-label="高级筛选">
      <header><div><strong>高级筛选</strong><span>按时间和标签缩小笔记范围</span></div><button type="button" aria-label="关闭筛选" onClick={() => page.setIsOpen(false)}>×</button></header>
      <div className="prototype-filter-popover__dates">
        <label><span>开始日期</span><input type="date" value={page.startDate} onChange={setValue(page.setStartDate)}/></label>
        <label><span>结束日期</span><input type="date" value={page.endDate} onChange={setValue(page.setEndDate)}/></label>
      </div>
      <div className="prototype-filter-popover__quick"><button type="button" onClick={page.setLastWeek}>最近一周</button><button type="button" onClick={page.setLastMonth}>最近一月</button></div>
      <section><span>标签</span><div className="prototype-filter-popover__tags">{page.tags.length === 0 ? <small>暂无标签</small> : page.tags.map((tag) => <button type="button" key={tag.id} aria-pressed={page.selectedTagIds.includes(tag.id)} onClick={() => page.toggleTag(tag.id)}>{tag.name}</button>)}</div></section>
      <footer><button type="button" onClick={() => page.handleClear()}>清空条件</button><button type="button" className="is-primary" onClick={() => { page.handleSearch(); page.setIsOpen(false) }}>应用筛选</button></footer>
    </div>}

    {page.isSemanticOpen && <div className="prototype-semantic-popover" role="dialog" aria-label="语义搜索模式">
      <strong>语义搜索模式</strong><span>选择内容召回方式</span>
      <div>{([['hybrid', '混合检索', '综合关键词与语义相关度'], ['vector', '语义优先', '按内容含义查找相似笔记'], ['keyword', '关键词优先', '保留精确词语匹配']] as const).map(([mode, label, copy]) => <button type="button" key={mode} aria-pressed={page.nlqEnabled && page.nlqMode === mode} onClick={() => page.handleSemanticMode(mode)}><b>{label}</b><small>{copy}</small></button>)}{page.nlqEnabled && <button type="button" className="is-disable" onClick={() => page.handleDisableSemanticSearch()}><b>关闭语义搜索</b><small>恢复普通筛选与关键词搜索</small></button>}</div>
    </div>}
  </div>
}
