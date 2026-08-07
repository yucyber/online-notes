import { Model, Types } from 'mongoose'
import { NoteAccessService } from './note-access.service'

// boards/mindmaps 的读权限：本人创建 OR 能读到关联笔记（继承笔记 ACL）
export async function canReadLinkedNote(
  noteId: Types.ObjectId | undefined,
  userId: Types.ObjectId,
  noteModel: Model<any>,
  noteAccess: NoteAccessService,
): Promise<boolean> {
  if (!noteId) return false
  const note = await noteModel
    .findOne(noteAccess.readScope(String(noteId), String(userId)))
    .select('_id')
    .lean()
    .exec()
  return Boolean(note)
}
