export interface NoteDerivedChanges {
  titleChanged: boolean
  contentChanged: boolean
  taxonomyChanged: boolean
}

export interface NoteDerivedJobData {
  noteId: string
  userId: string
  changes: NoteDerivedChanges
  expectedUpdatedAt: string
  nextRunAt?: string
  audit?: {
    lastErrorCode?: 'capacity_delayed' | 'derived_failed'
    lastDurationMs?: number
  }
}

export const NOTE_DERIVED_QUEUE = 'note-derived'

export function noteDerivedJobId(noteId: string) {
  return `note-derived-${noteId}`
}
