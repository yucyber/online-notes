import { useCallback } from 'react'
import { updateNote, createTag } from '@/lib/api'
import { mergeTagIds } from '@/app/dashboard/notes/new/new-note-utils'
import { resolveTagIdsByNames } from '@/lib/tag-utils'
import type { Note, Tag } from '@/types'

interface UseNoteSaveOptions {
  id: string
  selectedCategory: string
  selectedTags: string[]
  tags: Tag[]
  editorMode: 'rich' | 'markdown'
  setNote: (updater: (prev: Note | null) => Note | null) => void
  setTags: (updater: (prev: Tag[]) => Tag[]) => void
}

// handleSave と handleSaveDraft は status 以外に違いがないため、共通フックに切り出す
export function useNoteSave({
  id,
  selectedCategory,
  selectedTags,
  tags,
  editorMode,
  setNote,
  setTags,
}: UseNoteSaveOptions) {
  const addTagsByNames = useCallback(async (names: string[]): Promise<string[]> => {
    const result = await resolveTagIdsByNames(names, tags, createTag)
    if (result.created.length > 0) setTags(prev => [...result.created, ...prev])
    return result.ids
  }, [tags, setTags])

  const save = useCallback(async (title: string, content: string, status: 'published' | 'draft') => {
    try {
      const updatedNote = await updateNote(id, {
        title: title.trim(),
        content: content.trim(),
        categoryId: selectedCategory || null,
        tags: mergeTagIds(selectedTags, []),
        status,
      })
      setNote(() => updatedNote)
      try {
        const eventName = status === 'published' ? 'note_save_ok' : 'note_save_draft_ok'
        document.dispatchEvent(new CustomEvent('rum', {
          detail: { type: 'network', name: eventName, meta: { noteId: id, size: (content || '').length, mode: editorMode } },
        }))
      } catch { }
    } catch (error) {
      console.error('Failed to save note:', error)
      try {
        const eventName = status === 'published' ? 'note_save_error' : 'note_save_draft_error'
        document.dispatchEvent(new CustomEvent('rum', {
          detail: { type: 'network', name: eventName, meta: { noteId: id, message: String((error as any)?.message || error), mode: editorMode } },
        }))
      } catch { }
      throw error
    }
  }, [id, selectedCategory, selectedTags, editorMode, setNote])

  const handleSave = useCallback((title: string, content: string) => save(title, content, 'published'), [save])
  const handleSaveDraft = useCallback((title: string, content: string) => save(title, content, 'draft'), [save])

  return { handleSave, handleSaveDraft, addTagsByNames }
}
