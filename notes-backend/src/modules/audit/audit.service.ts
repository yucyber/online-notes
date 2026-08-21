import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { AuditEntry, AuditEntryDocument } from './schemas/audit-entry.schema'
import { Note, NoteDocument } from '../notes/schemas/note.schema'

// 统一 Audit.record 参数：允许携带 requestId/before/after/message，并容忍额外键以避免 TS2353
// 仅持久化受控字段（before/after/message/requestId），其他键忽略
export interface AuditRecordPayload {
  requestId?: string
  before?: any
  after?: any
  message?: string
  [key: string]: any
}

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditEntry.name) private model: Model<AuditEntryDocument>,
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
  ) {}
  private sanitize(resourceType: string, payload: { before?: any; after?: any; message?: string }) {
    const allow: Record<string, string[]> = {
      note: ['title', 'tags', 'categoryId'],
      acl: ['userId', 'role', 'email', 'displayName'],
      invitation: ['role', 'expiresAt', 'inviterId', 'invitedUserId', 'inviteeEmail', 'inviteeName', 'inviterEmail', 'inviterName'],
      version: ['versionNo'],
    }
    const wl = allow[resourceType] || []
    const filter = (obj?: any) => {
      if (!obj || typeof obj !== 'object') return undefined
      const out: any = {}
      for (const k of wl) if (k in obj) out[k] = obj[k]
      return out
    }
    const message = payload.message && String(payload.message).slice(0, 512)
    return { before: filter(payload.before), after: filter(payload.after), message }
  }
  async record(eventType: string, actorId: string | null, resourceType: string, resourceId: string, payload: AuditRecordPayload = {}) {
    const { before, after, message } = this.sanitize(resourceType, payload)
    const entry = new this.model({ eventType, actorId: actorId ? actorId : undefined, resourceType, resourceId: new Types.ObjectId(resourceId), requestId: payload.requestId, before, after, message })
    await entry.save()
    return { id: String(entry._id) }
  }
  async list(params: { actorId: string; resourceType?: string; resourceId?: string; eventType?: string; eventTypePrefixes?: string[]; since?: string; page?: number; size?: number }) {
    const page = params.page || 1
    const size = params.size || 20
    const userObjectId = new Types.ObjectId(params.actorId)
    // 活动日志展示"当前用户可编辑笔记"上的协作轨迹（含协作者的操作），而非只看自己的记录。
    // 可编辑范围 = 创建者 或 ACL 中 role=editor 的成员，与写权限口径一致，避免越权查看无关笔记。
    const editableNotes = await this.noteModel
      .find({ $or: [{ userId: userObjectId }, { acl: { $elemMatch: { userId: userObjectId, role: 'editor' } } }] })
      .select('_id')
      .lean()
      .exec()
    const editableNoteIds = editableNotes.map(n => n._id)
    // 资源 ID 用字符串形式传给 mongoose：mongoose 会自动 cast 成 ObjectId 匹配新记录，
    // 对历史未 cast 的字符串资源也能直接按字符串匹配。
    const editableNoteIdsAsStrings = editableNoteIds.map(id => String(id))
    const query: any = { resourceId: { $in: editableNoteIdsAsStrings } }
    if (params.resourceType) query.resourceType = params.resourceType
    if (params.resourceId) {
      const requestedId = String(new Types.ObjectId(params.resourceId))
      query.resourceId = editableNoteIdsAsStrings.includes(requestedId) ? requestedId : { $in: [] }
    }
    if (params.eventType) query.eventType = params.eventType
    if (params.eventTypePrefixes && params.eventTypePrefixes.length > 0) {
      query.$or = params.eventTypePrefixes.map(p => ({ eventType: { $regex: `^${p}` } }))
    }
    if (params.since) query.createdAt = { $gte: new Date(params.since) }
    const items = await this.model.find(query).sort({ createdAt: -1 }).skip((page - 1) * size).limit(size).populate('actorId', 'email displayName').exec()
    const total = await this.model.countDocuments(query)
    // 附带关联笔记标题与操作者身份，供前端展示"在哪篇笔记、谁做了什么"。
    const noteIds = Array.from(new Set(items.map(it => it.resourceId).filter(Boolean).map(id => { try { return new Types.ObjectId(id) } catch { return null } }))).filter((v): v is Types.ObjectId => Boolean(v))
    let noteTitles: Record<string, string> = {}
    if (noteIds.length > 0) {
      const notes = await this.noteModel.find({ _id: { $in: noteIds } }).select('title').lean().exec()
      noteTitles = Object.fromEntries(notes.map(n => [String(n._id), (n as any).title]))
    }
    const enriched = items.map(it => {
      const obj = it.toObject()
      const actor = (obj.actorId as any)
      return {
        ...obj,
        id: String(it._id),
        noteTitle: noteTitles[String(it.resourceId)] || undefined,
        actorName: actor?.displayName || actor?.email || undefined,
      }
    })
    return { items: enriched, page, size, total }
  }
}
