'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PrototypeGlyph } from '@/components/ui/prototype-glyph'
import { EditorNoteProperties } from '@/components/editor/EditorNoteProperties'
import TiptapToolbar from '@/components/editor/TiptapToolbar'
import { useNewNotePage } from './useNewNotePage'

const TiptapEditor = dynamic(() => import('@/components/editor/TiptapEditor'), { ssr: false })

export default function NewNotePage() {
  const page = useNewNotePage()
  const [propertiesOpen, setPropertiesOpen] = useState(false)

  const save = async (content = page.currentContent) => {
    try {
      await page.handleSave(page.newTitle, content)
    } catch {
      // 创建失败时保留当前输入，错误由页面状态统一展示。
    }
  }

  return (
    <main className="editor-shell new-note-editor" aria-label="新建笔记编辑器">
      <div className="editor-layout-main new-note-editor__layout">
        <header className="editor-header">
          <nav className="editor-header__breadcrumb" aria-label="编辑器面包屑">
            <button type="button" className="new-note-editor__back" onClick={page.handleCancel}>
              <PrototypeGlyph name="chevron-left" className="h-3 w-3" />
              我的笔记
            </button>
            <PrototypeGlyph name="chevron-right" className="h-3 w-3" />
            <h1>{page.newTitle.trim() || '未命名笔记'}</h1>
          </nav>
          <div className="editor-header__actions">
            <span className="new-note-editor__local-status">仅本地 · 创建后启用协作</span>
            <Button type="button" variant="ghost" size="icon" aria-label="打开笔记属性" aria-expanded={propertiesOpen} onClick={() => setPropertiesOpen((open) => !open)}>
              <PrototypeGlyph name="settings" className="h-4 w-4" />
            </Button>
            <Button id="save-button" type="button" disabled={page.saving} onClick={() => void save()}>
              <PrototypeGlyph name="save" className="h-4 w-4" />
              {page.saving ? '创建中…' : '创建笔记'}
            </Button>
          </div>
        </header>

        {propertiesOpen && (
          <aside className="editor-properties-popover new-note-editor__properties" aria-label="笔记属性">
            <div className="editor-properties-popover__header"><h2>笔记属性</h2><p>创建前设置归档方式与可见范围</p></div>
            <div className="editor-properties-popover__body">
              <section className="editor-properties__section new-note-editor__visibility">
                <label htmlFor="new-note-visibility">可见性</label>
                <select id="new-note-visibility" value={page.visibility} onChange={(event) => page.setVisibility(event.target.value as 'private' | 'public')}>
                  <option value="private">仅自己</option>
                  <option value="public">公开只读</option>
                </select>
              </section>
              <EditorNoteProperties
                categories={page.categories}
                tags={page.tags}
                selectedCategory={page.selectedCategory}
                selectedTags={page.selectedTags}
                tagInput={page.tagInput}
                metaLoading={page.metaLoading}
                metaError={page.metaError}
                readOnly={false}
                resolveCategoryId={page.resolveCategoryId}
                setSelectedCategory={page.setSelectedCategory}
                setSelectedTags={page.setSelectedTags}
                setTagInput={page.setTagInput}
                toggleTag={page.toggleTag}
                addTagsByNames={page.addTagsByNames}
                rejectReadOnlyWrite={() => false}
              />
            </div>
          </aside>
        )}

        {page.saveError && <div className="editor-error-banner" role="alert">{page.saveError}</div>}

        <div className="editor-edit-row">
          <div ref={page.editorContainerRef} className="editor-rich-editor" data-fullscreen={page.isFullscreen} style={page.isFullscreen ? { position: 'fixed', inset: 0, zIndex: 50, width: '100vw', height: '100vh', background: 'var(--bg)' } : undefined}>
            <TiptapToolbar disabled={page.saving} isFullscreen={page.isFullscreen} exec={(command, payload) => {
              if (command === 'comments') return
              if (command === 'fullscreen') { page.handleToggleFullscreen(); return }
              document.dispatchEvent(new CustomEvent('tiptap:exec', { detail: { cmd: command, payload } }))
            }} />
            <div className="editor-paper new-note-editor__paper">
              <input type="text" value={page.newTitle} onChange={(event) => page.setNewTitle(event.target.value)} placeholder="未命名笔记" aria-label="笔记标题" className="new-note-editor__title" maxLength={200} />
              <TiptapEditor
                noteId="new"
                localOnly
                initialHTML="<p></p>"
                onSave={save}
                user={{ id: 'me', name: '我' }}
                readOnly={false}
                onSelectionChange={(start, end) => page.setSelection({ start, end })}
                onContentChange={page.setCurrentContent}
                className="new-note-editor__body"
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
