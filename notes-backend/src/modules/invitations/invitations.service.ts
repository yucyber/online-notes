import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Invitation, InvitationDocument } from './schemas/invitation.schema'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import * as crypto from 'crypto'
import { AuditService } from '../audit/audit.service'
import { UsersService } from '../users/users.service'
import { NotificationsService } from '../notifications/notifications.service'

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(Invitation.name) private invitationModel: Model<InvitationDocument>,
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(noteId: string, inviterId: string, role: 'editor'|'viewer', inviteeEmail?: string, ttlHours: number = 24, requestId?: string) {
    const ttl = Math.min(Math.max(ttlHours || 24, 1), 72)
    const note = await this.noteModel.findById(noteId).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    const actor = new Types.ObjectId(inviterId)
    const isOwner = note.userId.equals(actor) || ((note as any).acl || []).some((a: any) => a.userId?.equals(actor) && a.role === 'owner')
    if (!isOwner) throw new BadRequestException('无权限')
    const token = crypto.randomBytes(24).toString('hex')
    const hash = crypto.createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + ttl * 3600 * 1000)
    const doc = new this.invitationModel({ noteId: note._id, inviterId: actor, role, inviteeEmail, tokenHash: hash, expiresAt, status: 'pending', requestId })
    await doc.save()
    // 给受邀用户写通知（若存在账号）
    if (inviteeEmail) {
      try {
        const u = await this.users.findByEmail(inviteeEmail)
        if (u) {
          await this.notifications.create(u._id as any, 'invitation', { noteId: note._id.toString(), role, expiresAt })
        }
      } catch {}
    }
    await this.audit.record('invitation_created', inviterId, 'note', note._id.toString(), { requestId })
    return { token, expiresAt }
  }

  async listForNote(noteId: string, actorId: string) {
    const note = await this.noteModel.findById(noteId).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    const actor = new Types.ObjectId(actorId)
    const isOwner = note.userId.equals(actor) || ((note as any).acl || []).some((a: any) => a.userId?.equals(actor) && a.role === 'owner')
    if (!isOwner) throw new BadRequestException('无权限')
    const items = await this.invitationModel.find({ noteId: note._id, status: { $in: ['pending','accepted'] } }).sort({ createdAt: -1 }).exec()
    return items
  }

  async listMine(email?: string, status: string = 'pending') {
    if (!email) return []
    const items = await this.invitationModel.find({ inviteeEmail: email, status }).sort({ createdAt: -1 }).exec()
    return items.map(inv => ({
      id: (inv as any)._id?.toString?.() || undefined,
      noteId: (inv as any).noteId?.toString?.(),
      role: inv.role,
      expiresAt: inv.expiresAt,
      status: inv.status,
      hash: (inv as any).tokenHash,
    }))
  }

  async preview(token: string) {
    const isHash = /^[a-f0-9]{64}$/i.test(token)
    const hash = isHash ? token : crypto.createHash('sha256').update(token).digest('hex')
    const inv = await this.invitationModel.findOne({ tokenHash: hash }).exec()
    if (!inv) throw new NotFoundException('邀请不存在')
    if (inv.status !== 'pending' || inv.expiresAt.getTime() < Date.now()) throw new NotFoundException('邀请已失效')
    return { noteId: inv.noteId.toString(), role: inv.role, expiresAt: inv.expiresAt }
  }

  async accept(token: string, userId: string, requestId?: string) {
    const isHash = /^[a-f0-9]{64}$/i.test(token)
    const hash = isHash ? token : crypto.createHash('sha256').update(token).digest('hex')
    const inv = await this.invitationModel.findOne({ tokenHash: hash }).exec()
    if (!inv) throw new NotFoundException('邀请不存在')
    if (inv.expiresAt.getTime() < Date.now() || inv.status === 'revoked') {
      inv.status = 'expired'
      await inv.save()
      throw new NotFoundException('邀请已失效')
    }
    if (inv.status === 'accepted') {
      throw new BadRequestException('邀请已使用')
    }
    const note = await this.noteModel.findById(inv.noteId).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    // 仅受邀用户可接受（若邀请指定邮箱）
    if (inv.inviteeEmail) {
      try {
        const u = await this.users.findById(userId)
        if (!u || String(u.email).toLowerCase() !== String(inv.inviteeEmail).toLowerCase()) {
          throw new BadRequestException('邀请仅限受邀邮箱用户接受')
        }
      } catch (e) {
        throw new BadRequestException('邀请仅限受邀邮箱用户接受')
      }
    }
    const u = new Types.ObjectId(userId)
    const acl = ((note as any).acl || []) as any[]
    const exists = acl.find((a: any) => a.userId?.equals(u))
    if (exists) {
      exists.role = inv.role
    } else {
      acl.push({ userId: u, role: inv.role, addedBy: inv.inviterId, addedAt: new Date() })
    }
    ;(note as any).acl = acl
    await note.save()
    inv.status = 'accepted'
    inv.usedAt = new Date()
    inv.requestId = requestId
    await inv.save()
    await this.audit.record('invitation_accepted', userId, 'note', note._id.toString(), { requestId })
    // 通知邀请人
    try { await this.notifications.create(inv.inviterId as any, 'invitation', { noteId: note._id.toString(), acceptedBy: userId }) } catch {}
    return { ok: true }
  }

  async revoke(token: string, actorId: string) {
    const hash = crypto.createHash('sha256').update(token).digest('hex')
    const inv = await this.invitationModel.findOne({ tokenHash: hash }).exec()
    if (!inv) throw new NotFoundException('邀请不存在')
    const note = await this.noteModel.findById(inv.noteId).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    const actor = new Types.ObjectId(actorId)
    const isOwner = note.userId.equals(actor) || ((note as any).acl || []).some((a: any) => a.userId?.equals(actor) && a.role === 'owner')
    if (!isOwner) throw new BadRequestException('无权限')
    inv.status = 'revoked'
    await inv.save()
    await this.audit.record('invitation_revoked', actorId, 'note', note._id.toString(), {})
    return { ok: true }
  }
}
