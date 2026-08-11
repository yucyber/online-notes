import { useCallback } from 'react'
import { updateNote, createTag } from '@/lib/api'
import { mergeTagIds } from '@/app/dashboard/notes/new/new-note-utils'
import type { Note, Category, Tag } from '@/types'

interface UseNoteSaveOptions {
  id: string
  selectedCategory: string
  auxCategoryIds: string[]
  selectedTags: string[]
  categories: Category[]
  tags: Tag[]
  editorMode: 'rich' | 'markdown'
  setNote: (updater: (prev: Note | null) => Note | null) => void
  setTags: (updater: (prev: Tag[]) => Tag[]) => void
}

// handleSave と handleSaveDraft は status 以外に違いがないため、共通フックに切り出す
export function useNoteSave({
  id,
  selectedCategory,
  auxCategoryIds,
  selectedTags,
  categories,
  tags,
  editorMode,
  setNote,
  setTags,
}: UseNoteSaveOptions) {
  const addTagsByNames = useCallback(async (names: string[]): Promise<string[]> => {
    const trimmed = Array.from(new Set(names.map(n => n.trim()).filter(Boolean)))
    if (trimmed.length === 0) return []
    const mapByName = new Map<string, Tag>()
    tags.forEach(t => mapByName.set(String(t.name).toLowerCase(), t))
    const resultIds: string[] = []
    for (const name of trimmed) {
      const key = name.toLowerCase()
      const hit = mapByName.get(key)
      if (hit) {
        const tagId = hit.id || (hit as unknown as { _id?: string })?._id || ''
        if (tagId) resultIds.push(tagId)
        continue
      }
      const created = await createTag(name)
      const tagId = created.id || (created as unknown as { _id?: string })?._id || ''
      if (tagId) {
        resultIds.push(tagId)
        setTags(prev => [{ ...created, id: tagId }, ...prev])
      }
    }
    return resultIds
  }, [tags, setTags])

  const save = useCallback(async (title: string, content: string, status: 'published' | 'draft') => {
    const auxNames = auxCategoryIds
      .map(cid => categories.find(c => (c.id || (c as unknown as { _id?: string })?._id) === cid)?.name)
      .filter((n): n is string => Boolean(n))
    const generatedTagIds = auxNames.length > 0 ? await addTagsByNames(auxNames) : []
    try {
      const updatedNote = await updateNote(id, {
        title: title.trim(),
        content: content.trim(),
        categoryId: selectedCategory || undefined,
        categoryIds: auxCategoryIds.length > 0 ? auxCategoryIds : undefined,
        tags: mergeTagIds(selectedTags, generatedTagIds),
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
  }, [id, selectedCategory, auxCategoryIds, selectedTags, categories, editorMode, addTagsByNames, setNote])

  const handleSave = useCallback((title: string, content: string) => save(title, content, 'published'), [save])
  const handleSaveDraft = useCallback((title: string, content: string) => save(title, content, 'draft'), [save])

  return { handleSave, handleSaveDraft, addTagsByNames }
}
