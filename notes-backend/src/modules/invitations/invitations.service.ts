import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Invitation, InvitationDocument } from './schemas/invitation.schema'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { AuditService } from '../audit/audit.service'
import { UsersService } from '../users/users.service'
import { NotificationsService } from '../notifications/notifications.service'
import { NoteCacheService } from '../notes/note-cache.service'

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(Invitation.name) private invitationModel: Model<InvitationDocument>,
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly noteCache: NoteCacheService,
  ) {}

  async create(noteId: string, inviterId: string, role: 'editor'|'viewer', inviteeEmail?: string, ttlHours: number = 24) {
    const ttl = Math.min(Math.max(ttlHours || 24, 1), 72)
    const note = await this.noteModel.findById(noteId).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    const actor = new Types.ObjectId(inviterId)
    if (!note.userId.equals(actor)) throw new BadRequestException('无权限')
    const expiresAt = new Date(Date.now() + ttl * 3600 * 1000)
    const doc = new this.invitationModel({ noteId: note._id, inviterId: actor, role, inviteeEmail, expiresAt, status: 'pending' })
    await doc.save()
    // 给受邀用户写通知（若存在账号）
    let invitedUserId: string | undefined
    let inviteeName: string | undefined
    if (inviteeEmail) {
      try {
        const u = await this.users.findByEmail(inviteeEmail)
        if (u) {
          invitedUserId = String(u._id)
          inviteeName = u.displayName
          await this.notifications.create(u._id as any, 'invitation', { noteId: note._id.toString(), role, expiresAt })
        }
      } catch {}
    }
    // 记录邀请对象与权限，供活动日志展示"邀请了谁、开了什么权限"
    await this.audit.record('invitation_created', inviterId, 'invitation', note._id.toString(), { after: { role, ...(invitedUserId ? { invitedUserId } : {}), ...(inviteeEmail ? { inviteeEmail } : {}), ...(inviteeName ? { inviteeName } : {}) } })
    return { id: doc._id.toString(), expiresAt }
  }

  async listForNote(noteId: string, actorId: string) {
    const note = await this.noteModel.findById(noteId).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    const actor = new Types.ObjectId(actorId)
    if (!note.userId.equals(actor)) throw new BadRequestException('无权限')
    const items = await this.invitationModel.find({ noteId: note._id, status: { $in: ['pending','accepted'] } }).sort({ createdAt: -1 }).exec()
    return items.map(invite => ({
      id: invite._id.toString(),
      inviteeEmail: invite.inviteeEmail,
      role: invite.role,
      status: invite.status,
      createdAt: (invite as any).createdAt,
      expiresAt: invite.expiresAt,
    }))
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
    }))
  }

  async preview(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('邀请不存在')
    const inv = await this.invitationModel.findById(id).exec()
    if (!inv) throw new NotFoundException('邀请不存在')
    if (inv.status !== 'pending' || inv.expiresAt.getTime() < Date.now()) throw new NotFoundException('邀请已失效')
    return { noteId: inv.noteId.toString(), role: inv.role, expiresAt: inv.expiresAt }
  }

  async accept(id: string, userId: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('邀请不存在')
    const inv = await this.invitationModel.findById(id).exec()
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
      acl.push({ userId: u, role: inv.role })
    }
    ;(note as any).acl = acl
    await note.save()
    // 授予协作者访问权后失效列表缓存，让被邀请人立即在列表看到该笔记。
    await this.noteCache.invalidateLists()
    inv.status = 'accepted'
    inv.usedAt = new Date()
    await inv.save()
    // 反查邀请人真实身份，供活动日志展示"接受了谁的邀请"而非无意义的 ID 片段
    let inviterName: string | undefined
    let inviterEmail: string | undefined
    try {
      const inviter = await this.users.findById(inv.inviterId.toString())
      inviterName = inviter.displayName
      inviterEmail = inviter.email
    } catch {}
    await this.audit.record('invitation_accepted', userId, 'invitation', note._id.toString(), { after: { role: inv.role, ...(inviterName ? { inviterName } : {}), ...(inviterEmail ? { inviterEmail } : {}) } })
    // 通知邀请人
    try { await this.notifications.create(inv.inviterId as any, 'invitation', { noteId: note._id.toString(), acceptedBy: userId }) } catch {}
    return { ok: true }
  }

  async revoke(id: string, actorId: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('邀请不存在')
    const inv = await this.invitationModel.findById(id).exec()
    if (!inv) throw new NotFoundException('邀请不存在')
    const note = await this.noteModel.findById(inv.noteId).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    const actor = new Types.ObjectId(actorId)
    if (!note.userId.equals(actor)) throw new BadRequestException('无权限')
    inv.status = 'revoked'
    await inv.save()
    // 记录邀请对象与权限，供活动日志展示"撤销了谁的邀请、原来开的是什么权限"
    let inviteeName: string | undefined
    if (inv.inviteeEmail) {
      try {
        const invitee = await this.users.findByEmail(inv.inviteeEmail)
        inviteeName = invitee.displayName
      } catch {}
    }
    await this.audit.record('invitation_revoked', actorId, 'invitation', note._id.toString(), { after: { role: inv.role, ...(inv.inviteeEmail ? { inviteeEmail: inv.inviteeEmail } : {}), ...(inviteeName ? { inviteeName } : {}) } })
    return { ok: true }
  }
}
