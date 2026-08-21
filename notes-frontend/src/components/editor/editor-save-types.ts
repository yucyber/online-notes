import type { UpdateNoteDto } from '@/types'

export type EditorSnapshot = {
  title: string
  content: string
  visibility?: UpdateNoteDto['visibility']
  categoryId?: UpdateNoteDto['categoryId']
  tags: string[]
  status?: UpdateNoteDto['status']
}
