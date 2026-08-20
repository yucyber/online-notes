type NoteAccessShape = {
  userId?: unknown
  acl?: Array<{ userId?: unknown; role?: string }>
}

function idOf(value: unknown): string {
  if (value && typeof value === 'object') {
    const objectValue = value as { id?: unknown; _id?: unknown }
    return String(objectValue.id ?? objectValue._id ?? '')
  }
  return String(value ?? '')
}

export function canWriteNote(note: NoteAccessShape | null, userId: string): boolean {
  if (!note || !userId) return false
  if (idOf(note.userId) === userId) return true
  return Boolean(note.acl?.some((entry) =>
    idOf(entry.userId) === userId && entry.role === 'editor',
  ))
}


