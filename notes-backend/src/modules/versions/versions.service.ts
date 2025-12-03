import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { NoteVersion, NoteVersionDocument } from './schemas/note-version.schema'
import { AuditService } from '../audit/audit.service'

@Injectable()
export class VersionsService {
  constructor(
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    @InjectModel(NoteVersion.name) private versionModel: Model<NoteVersionDocument>,
    private readonly audit: AuditService,
  ) {}

  async list(noteId: string, userId: string) {
    const u = new Types.ObjectId(userId)
    const note = await this.noteModel.findOne({ _id: new Types.ObjectId(noteId), $or: [{ userId: u }, { acl: { $elemMatch: { userId: u } } }, { visibility: 'public' }] }).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    const items = await this.versionModel.find({ noteId: note._id }).sort({ versionNo: -1 }).exec()
    return items
  }

  async snapshot(noteId: string, userId: string, requestId?: string) {
    const u = new Types.ObjectId(userId)
    const note = await this.noteModel.findOne({ _id: new Types.ObjectId(noteId), $or: [{ userId: u }, { acl: { $elemMatch: { userId: u, role: { $in: ['owner','editor'] } } } }] }).exec()
    if (!note) throw new NotFoundException('无权限')
    const last = await this.versionModel.findOne({ noteId: note._id }).sort({ versionNo: -1 }).exec()
    const nextNo = (last?.versionNo || 0) + 1
    const v = new this.versionModel({ noteId: note._id, versionNo: nextNo, title: note.title, content: note.content, tags: note.tags, categoryId: (note as any).categoryId, categoryIds: (note as any).categoryIds, createdBy: u })
    await v.save()
    await this.audit.record('version_created', userId, 'note', note._id.toString(), { requestId })
    return { versionNo: nextNo }
  }

  async restore(noteId: string, versionNo: number, userId: string, requestId?: string) {
    const u = new Types.ObjectId(userId)
    const note = await this.noteModel.findOne({ _id: new Types.ObjectId(noteId), $or: [{ userId: u }, { acl: { $elemMatch: { userId: u, role: 'owner' } } }] }).exec()
    if (!note) throw new NotFoundException('无权限')
    const v = await this.versionModel.findOne({ noteId: note._id, versionNo }).exec()
    if (!v) throw new NotFoundException('版本不存在')
    note.title = v.title
    note.content = v.content
    ;(note as any).tags = v.tags
    ;(note as any).categoryId = v.categoryId
    ;(note as any).categoryIds = v.categoryIds
    await note.save()
    await this.audit.record('version_restored', userId, 'note', note._id.toString(), { requestId })
    return { ok: true }
  }
}
