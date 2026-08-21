'use client'

import dynamic from 'next/dynamic'
import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PrototypeGlyph } from '@/components/ui/prototype-glyph'
import { EditorNoteProperties } from '@/components/editor/EditorNoteProperties'
import { EditorOutline } from '@/components/editor/EditorOutline'
import { EditorWorkspaceSidebar } from '@/components/editor/EditorWorkspaceSidebar'
import { NoteEditorHeader } from '@/components/editor/NoteEditorHeader'
import { NoteEditorMetadataPanel } from '@/components/editor/NoteEditorMetadataPanel'
import { extractEditorHeadings } from '@/components/editor/editor-outline-utils'
import { useEditorLayoutPreferences } from '@/components/editor/useEditorLayoutPreferences'
import TiptapToolbar from '@/components/editor/TiptapToolbar'
import type { Note } from '@/types'
import { useNewNotePage } from './useNewNotePage'

const TiptapEditor = dynamic(() => import('@/components/editor/TiptapEditor'), { ssr: false })

export default function NewNotePage() {
  const page = useNewNotePage()
  const { preferences, toggleLeft } = useEditorLayoutPreferences()
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [outlinePinned, setOutlinePinned] = useState(true)
  const [headings, setHeadings] = useState(() => extractEditorHeadings(page.currentContent))
  const propertiesPanelRef = useRef<HTMLDivElement>(null)
  const restoreButtonRef = useRef<HTMLButtonElement>(null)
  const draftNote = useMemo(() => ({
    id: '',
    title: page.newTitle.trim() || '未命名笔记',
    content: page.currentContent,
    tags: [],
    createdAt: '',
    updatedAt: '',
    userId: '',
    visibility: 'private' as const,
  } satisfies Note), [page.currentContent, page.newTitle])

  const save = async (content = page.currentContent) => {
    try {
      await page.handleSave(page.newTitle, content)
    } catch {
      // 创建失败时保留当前输入，错误由页面状态统一展示。
    }
  }

  const handleToggleLeft = () => {
    const collapsing = !preferences.leftCollapsed
    toggleLeft()
    if (collapsing) window.requestAnimationFrame(() => restoreButtonRef.current?.focus())
  }

  return (
    <main className="editor-shell new-note-editor" aria-label="新建笔记编辑器">
      <div
        className="editor-layout-grid"
        style={{ '--editor-left-width': preferences.leftCollapsed ? '0px' : `${preferences.leftWidth}px` } as React.CSSProperties}
      >
        <EditorWorkspaceSidebar
          collapsed={preferences.leftCollapsed}
          notes={page.directoryNotes}
          searchValue={page.directorySearch}
          onSearchChange={page.setDirectorySearch}
          onOpenNote={page.handleOpenNote}
          onBack={page.handleCancel}
          onToggle={handleToggleLeft}
          restoreButtonRef={restoreButtonRef}
        />

        <div className="editor-layout-main">
          <NoteEditorHeader
            note={draftNote}
            editorMode="rich"
            onOpenComments={() => undefined}
            onOpenCollab={() => undefined}
            onToggleProperties={() => setPropertiesOpen((open) => !open)}
            propertiesOpen={propertiesOpen}
            creationAction={(
              <Button id="create-note-button" type="button" disabled={page.saving} onClick={() => void save()}>
                <PrototypeGlyph name="save" className="h-4 w-4" />
                {page.saving ? '创建中…' : '创建笔记'}
              </Button>
            )}
          />

          <NoteEditorMetadataPanel
            id=""
            open={propertiesOpen}
            panelRef={propertiesPanelRef}
            showVersions={false}
            properties={(
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
            )}
          />

          {page.saveError ? <div className="editor-error-banner" role="alert">{page.saveError}</div> : null}

          <div className="editor-edit-row">
            <div
              ref={page.editorContainerRef}
              className="editor-rich-editor"
              data-fullscreen={page.isFullscreen}
              style={page.isFullscreen ? { position: 'fixed', inset: 0, zIndex: 50, width: '100vw', height: '100vh', overflowY: 'auto', background: 'var(--bg)' } : undefined}
            >
              <TiptapToolbar disabled={page.saving} isFullscreen={page.isFullscreen} exec={(command, payload) => {
                if (command === 'fullscreen') { page.handleToggleFullscreen(); return }
                document.dispatchEvent(new CustomEvent('tiptap:exec', { detail: { cmd: command, payload } }))
              }} />
              <div className="editor-paper new-note-editor__paper">
                <input
                  type="text"
                  value={page.newTitle}
                  onChange={(event) => page.setNewTitle(event.target.value)}
                  placeholder="未命名笔记"
                  aria-label="笔记标题"
                  className="new-note-editor__title"
                  maxLength={200}
                />
                <TiptapEditor
                  noteId="new"
                  localOnly
                  initialHTML="<p></p>"
                  onSave={save}
                  user={{ id: 'me', name: '我' }}
                  readOnly={false}
                  onSelectionChange={(start, end) => page.setSelection({ start, end })}
                  onContentChange={(content) => {
                    page.setCurrentContent(content)
                    setHeadings(extractEditorHeadings(content))
                  }}
                  className="new-note-editor__body"
                />
              </div>
              {!page.isFullscreen ? <EditorOutline headings={headings} pinned={outlinePinned} onPinnedChange={setOutlinePinned} /> : null}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
