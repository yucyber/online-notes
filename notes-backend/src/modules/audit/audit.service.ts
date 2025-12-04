import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { AuditEntry, AuditEntryDocument } from './schemas/audit-entry.schema'

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
  constructor(@InjectModel(AuditEntry.name) private model: Model<AuditEntryDocument>) {}
  private sanitize(resourceType: string, payload: { before?: any; after?: any; message?: string }) {
    const allow: Record<string, string[]> = {
      note: ['title', 'tags', 'categoryId', 'categoryIds'],
      acl: ['userId', 'role'],
      invitation: ['role', 'expiresAt', 'inviterId'],
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
    // 规范响应包：{code,message,data,requestId,timestamp}
    return { code: 0, message: 'OK', data: { id: String(entry._id) }, requestId: payload.requestId, timestamp: Date.now() }
  }
  async list(params: { resourceType?: string; resourceId?: string; eventType?: string; page?: number; size?: number }) {
    const page = params.page || 1
    const size = params.size || 20
    const query: any = {}
    if (params.resourceType) query.resourceType = params.resourceType
    if (params.resourceId) query.resourceId = params.resourceId
    if (params.eventType) query.eventType = params.eventType
    const items = await this.model.find(query).sort({ createdAt: -1 }).skip((page - 1) * size).limit(size).exec()
    const total = await this.model.countDocuments(query)
    return { items, page, size, total }
  }
}
