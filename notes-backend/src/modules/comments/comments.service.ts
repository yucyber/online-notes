import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Comment, CommentDocument } from './schemas/comment.schema'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { NoteAccessService } from '../notes/note-access.service'
import { AuditService } from '../audit/audit.service'
import { UsersService } from '../users/users.service'

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name) private commentModel: Model<CommentDocument>,
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    private readonly noteAccess: NoteAccessService,
    private readonly audit: AuditService,
    private readonly usersService: UsersService,
  ) {}

  // 把 authorId 序列化为带名字/邮箱的视图，并把 replies 一起展开。
  // 用户不存在或查询失败时降级为空字符串，保证列表渲染不会因个别用户被删除而 500。
  private async enrichAuthor<T extends { authorId: any; replies?: any[] }>(comment: T): Promise<any> {
    const authorId = (comment.authorId ? String((comment.authorId as any).toString?.() || comment.authorId) : '') || ''
    const replyIds = (comment.replies || [])
      .map((r: any) => (r?.authorId ? String(r.authorId.toString?.() || r.authorId) : ''))
      .filter(Boolean)
    const ids = Array.from(new Set([authorId, ...replyIds])).filter(Boolean)
    const users = await Promise.all(ids.map((id) => this.usersService.findById(id).catch(() => null)))
    const map = new Map<string, { id: string; name: string; email: string }>()
    ids.forEach((id, i) => {
      const u = users[i]
      if (u) map.set(id, { id, name: (u as any).displayName || '', email: (u as any).email || '' })
      else map.set(id, { id, name: '', email: '' })
    })
    const lookup = (id: string) => map.get(id) || { id, name: '', email: '' }
    return {
      ...comment,
      authorId,
      author: lookup(authorId),
      replies: (comment.replies || []).map((r: any) => {
        const rid = r?.authorId ? String(r.authorId.toString?.() || r.authorId) : ''
        return { ...r, authorId: rid, author: lookup(rid) }
      }),
    }
  }

  async list(
    noteId: string,
    userId: string,
    start?: number,
    end?: number,
    intersects: boolean = true,
    limit: number = 50,
  ) {
    // 公开笔记允许阅读评论，但参与评论仍要求是笔记创建者或 ACL 成员。
    const note = await this.noteModel.findOne(this.noteAccess.readScope(noteId, userId)).exec()
    if (!note) throw new NotFoundException('无权限')
    const filter: any = { noteId: note._id }
    if (start !== undefined && end !== undefined) {
      const s = Number(start)
      const e = Number(end)
      filter.$and = intersects
        ? [{ start: { $lt: e } }, { end: { $gt: s } }]
        : [{ start: { $gte: s } }, { end: { $lte: e } }]
    }
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100)
    const items = await this.commentModel.find(filter).sort({ createdAt: -1, _id: -1 }).limit(lim).exec()
    return Promise.all(items.map((c) => this.enrichAuthor(c.toJSON ? c.toJSON() : c)))
  }

  async create(noteId: string, userId: string, start: number | undefined, end: number | undefined, text: string, requestId?: string) {
    const u = new Types.ObjectId(userId)
    // 公开可见不等于可参与协作，创建评论必须通过成员范围检查。
    const note = await this.noteModel.findOne(this.noteAccess.memberScope(noteId, userId)).exec()
    if (!note) throw new NotFoundException('无权限')
    if (!text?.trim()) throw new BadRequestException('文本为空')
    if (start === undefined || end === undefined) throw new BadRequestException('缺少选区范围')
    const body: any = { noteId: note._id, authorId: u, text, start, end }
    const c = new this.commentModel(body)
    await c.save()
    await this.audit.record('comment_added', userId, 'note', note._id.toString(), { requestId, message: 'comment_added' })
    return this.enrichAuthor(c.toJSON ? c.toJSON() : c)
  }

  async reply(commentId: string, userId: string, text: string, requestId?: string) {
    const c = await this.commentModel.findById(commentId).exec()
    if (!c) throw new NotFoundException('评论不存在')
    // 回复沿用创建评论的成员边界，不能借已知 commentId 绕过笔记权限。
    const note = await this.noteModel.findOne(this.noteAccess.memberScope(String(c.noteId), userId)).exec()
    if (!note) throw new NotFoundException('无权限')
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
    // 删除权只属于评论作者或笔记创建者；普通协作者不能删除他人的讨论记录。
    const isAuthor = String((c.authorId || '').toString()) === String(uid.toString())
    const isOwner = String((note.userId || '').toString()) === String(uid.toString())
    if (!isAuthor && !isOwner) throw new BadRequestException('无权限删除')
    await this.commentModel.deleteOne({ _id: c._id }).exec()
    await this.audit.record('comment_deleted', userId, 'note', c.noteId.toString(), { requestId, message: 'comment_deleted' })
    return { ok: true }
  }
}
