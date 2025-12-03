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

  async list(noteId: string, userId: string) {
    const u = new Types.ObjectId(userId)
    const note = await this.noteModel.findOne({ _id: new Types.ObjectId(noteId), $or: [{ userId: u }, { acl: { $elemMatch: { userId: u } } }, { visibility: 'public' }] }).exec()
    if (!note) throw new NotFoundException('无权限')
    return this.commentModel.find({ noteId: note._id }).sort({ createdAt: -1 }).exec()
  }

  async create(noteId: string, userId: string, start: number, end: number, text: string) {
    const u = new Types.ObjectId(userId)
    const note = await this.noteModel.findOne({ _id: new Types.ObjectId(noteId), $or: [{ userId: u }, { acl: { $elemMatch: { userId: u } } }] }).exec()
    if (!note) throw new NotFoundException('无权限')
    const c = new this.commentModel({ noteId: note._id, authorId: u, start, end, text })
    await c.save()
    await this.audit.record('comment_added', userId, 'note', note._id.toString(), {})
    return c
  }

  async reply(commentId: string, userId: string, text: string) {
    const c = await this.commentModel.findById(commentId).exec()
    if (!c) throw new NotFoundException('评论不存在')
    const u = new Types.ObjectId(userId)
    const replies = (c.replies || []) as any[]
    replies.push({ authorId: u, text, createdAt: new Date() })
    ;(c as any).replies = replies
    await c.save()
    await this.audit.record('comment_replied', userId, 'note', c.noteId.toString(), {})
    return { ok: true }
  }
}
