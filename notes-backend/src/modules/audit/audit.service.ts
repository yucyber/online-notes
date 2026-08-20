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
      acl: ['userId', 'role'],
      invitation: ['role', 'expiresAt', 'inviterId', 'invitedUserId', 'inviteeEmail'],
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
    const entry = new this.model({ eventType, actorId: actorId ? actorId : undefined, resourceType, resourceId, requestId: payload.requestId, before, after, message })
    await entry.save()
    return { id: String(entry._id) }
  }
  async list(params: { actorId: string; resourceType?: string; resourceId?: string; eventType?: string; page?: number; size?: number }) {
    const page = params.page || 1
    const size = params.size || 20
    // 审计只返回当前用户自己的操作记录，防止越权查看他人轨迹。
    const query: any = { actorId: params.actorId }
    if (params.resourceType) query.resourceType = params.resourceType
    if (params.resourceId) query.resourceId = params.resourceId
    if (params.eventType) query.eventType = params.eventType
    const items = await this.model.find(query).sort({ createdAt: -1 }).skip((page - 1) * size).limit(size).exec()
    const total = await this.model.countDocuments(query)
    // 附带关联笔记标题，供前端展示"在哪篇笔记上操作"；笔记不存在或无权时不阻断审计列表。
    const noteIds = Array.from(new Set(items.map(it => it.resourceId).filter(Boolean).map(id => { try { return new Types.ObjectId(id) } catch { return null } }))).filter((v): v is Types.ObjectId => Boolean(v))
    let noteTitles: Record<string, string> = {}
    if (noteIds.length > 0) {
      const notes = await this.noteModel.find({ _id: { $in: noteIds } }).select('title').lean().exec()
      noteTitles = Object.fromEntries(notes.map(n => [String(n._id), (n as any).title]))
    }
    const enriched = items.map(it => ({
      ...it.toObject(),
      id: String(it._id),
      noteTitle: noteTitles[String(it.resourceId)] || undefined,
    }))
    return { items: enriched, page, size, total }
  }
}
