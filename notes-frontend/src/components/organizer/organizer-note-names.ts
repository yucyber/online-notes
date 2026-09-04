export type NoteTitleMap = Record<string, string>

export function noteLabel(noteId: string, titles?: NoteTitleMap) {
  return titles?.[noteId] || noteId
}

export function noteListLabel(noteIds: string[] | undefined, titles?: NoteTitleMap) {
  return (noteIds || []).map((noteId) => noteLabel(noteId, titles)).join('、')
}
