import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Comment, CommentDocument } from './schemas/comment.schema'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { AuditService } from '../audit/audit.service'

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name) private commentModel: Model<CommentDocument>,
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    private readonly audit: AuditService,
  ) {}

  async list(
    noteId: string,
    userId: string,
    start?: number,
    end?: number,
    intersects: boolean = true,
    blockId?: string,
    versionId?: string,
    limit: number = 50,
    cursor?: string,
  ) {
    const u = new Types.ObjectId(userId)
    const note = await this.noteModel.findOne({ _id: new Types.ObjectId(noteId), $or: [{ userId: u }, { acl: { $elemMatch: { userId: u } } }, { visibility: 'public' }] }).exec()
    if (!note) throw new NotFoundException('无权限')
    const filter: any = { noteId: note._id }
    if (blockId) filter.blockId = blockId
    if (versionId) filter['anchor.versionId'] = new Types.ObjectId(versionId)
    if (start !== undefined && end !== undefined) {
      const s = Number(start)
      const e = Number(end)
      filter.$and = intersects
        ? [{ start: { $lt: e } }, { end: { $gt: s } }]
        : [{ start: { $gte: s } }, { end: { $lte: e } }]
    }
    if (cursor) filter._id = { $lt: new Types.ObjectId(cursor) }
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100)
    return this.commentModel.find(filter).sort({ createdAt: -1, _id: -1 }).limit(lim).exec()
  }

  async create(noteId: string, userId: string, start: number | undefined, end: number | undefined, text: string, requestId?: string, anchor?: any, blockId?: string) {
    const u = new Types.ObjectId(userId)
    const note = await this.noteModel.findOne({ _id: new Types.ObjectId(noteId), $or: [{ userId: u }, { acl: { $elemMatch: { userId: u } } }] }).exec()
    if (!note) throw new NotFoundException('无权限')
    if (!text?.trim()) throw new BadRequestException('文本为空')
    if ((start === undefined || end === undefined) && !anchor) throw new BadRequestException('缺少范围或锚点')
    const body: any = { noteId: note._id, authorId: u, text }
    if (start !== undefined && end !== undefined) Object.assign(body, { start, end })
    if (blockId) body.blockId = blockId
    if (anchor) body.anchor = anchor
    const c = new this.commentModel(body)
    await c.save()
    await this.audit.record('comment_added', userId, 'note', note._id.toString(), { requestId, message: 'comment_added' })
    return c
  }

  async reply(commentId: string, userId: string, text: string, requestId?: string) {
    const c = await this.commentModel.findById(commentId).exec()
    if (!c) throw new NotFoundException('评论不存在')
    const u = new Types.ObjectId(userId)
    const replies = (c.replies || []) as any[]
    replies.push({ authorId: u, text, createdAt: new Date() })
    ;(c as any).replies = replies
    await c.save()
    await this.audit.record('comment_replied', userId, 'note', c.noteId.toString(), { requestId, message: 'comment_replied' })
    return { ok: true }
  }

  async remove(commentId: string, userId: string, requestId?: string) {
    const c = await this.commentModel.findById(commentId).exec()
    if (!c) throw new NotFoundException('评论不存在')
    const note = await this.noteModel.findById(c.noteId).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    const uid = new Types.ObjectId(userId)
    const isAuthor = String((c.authorId || '').toString()) === String(uid.toString())
    const isOwner = String((note.userId || '').toString()) === String(uid.toString())
    if (!isAuthor && !isOwner) throw new BadRequestException('无权限删除')
    await this.commentModel.deleteOne({ _id: c._id }).exec()
    await this.audit.record('comment_deleted', userId, 'note', c.noteId.toString(), { requestId, message: 'comment_deleted' })
    return { ok: true }
  }
}
