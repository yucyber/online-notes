import type { UpdateNoteDto } from '@/types'

export type EditorSnapshot = {
  title: string
  content: string
  visibility?: UpdateNoteDto['visibility']
  categoryId?: string
  tags: string[]
  status?: UpdateNoteDto['status']
}
