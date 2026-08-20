import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { NoteVersion, NoteVersionDocument } from './schemas/note-version.schema'
import { NoteAccessService } from '../notes/note-access.service'
import { NotesService } from '../notes/notes.service'
import { AuditService } from '../audit/audit.service'

@Injectable()
export class VersionsService {
  constructor(
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    @InjectModel(NoteVersion.name) private versionModel: Model<NoteVersionDocument>,
    private readonly noteAccess: NoteAccessService,
    private readonly audit: AuditService,
    private readonly notesService: NotesService,
  ) { }

  async list(noteId: string, userId: string) {
    const note = await this.noteModel.findOne(this.noteAccess.readScope(noteId, userId)).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    const items = await this.versionModel.find({ noteId: note._id }).sort({ versionNo: -1 }).exec()
    return items
  }

  async snapshot(noteId: string, userId: string, name?: string, requestId?: string) {
    const u = new Types.ObjectId(userId)
    // 快照属于写操作：editor 可以保存版本，但不能获得恢复整篇笔记的权限。
    const note = await this.noteModel.findOne(this.noteAccess.writeScope(noteId, userId)).exec()
    if (!note) throw new NotFoundException('无权限')
    const last = await this.versionModel.findOne({ noteId: note._id }).sort({ versionNo: -1 }).exec()
    const nextNo = (last?.versionNo || 0) + 1
    const v = new this.versionModel({ noteId: note._id, versionNo: nextNo, name, title: note.title, content: note.content, tags: note.tags, categoryId: (note as any).categoryId, createdBy: u })
    await v.save()
    await this.audit.record('version_created', userId, 'note', note._id.toString(), { requestId, name })
    return { versionNo: nextNo }
  }

  async restore(noteId: string, versionNo: number, userId: string, requestId?: string) {
    // 恢复会同时覆盖正文、标签和分类，因此权限收紧到 owner，而不是普通 editor。
    const note = await this.noteModel.findOne(this.noteAccess.ownerScope(noteId, userId)).exec()
    if (!note) throw new NotFoundException('无权限')
    const v = await this.versionModel.findOne({ noteId: note._id, versionNo }).exec()
    if (!v) throw new NotFoundException('版本不存在')
    note.title = v.title
    note.content = v.content
      ; (note as any).tags = v.tags
      ; (note as any).categoryId = v.categoryId
    await note.save()
    // 先持久化版本内容，再基于最终正文重建摘要和 embedding，避免派生字段指向旧版本。
    await this.notesService.refreshDerivedFields(note)
    await this.audit.record('version_restored', userId, 'note', note._id.toString(), { requestId })
    return { ok: true }
  }
}
