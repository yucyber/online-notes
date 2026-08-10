import type { Note } from '@/types'

export function removeNoteById(notes: Note[], id: string) {
  return notes.filter((note) => note.id !== id)
}

export function toggleIdInSet(current: Set<string>, id: string) {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
