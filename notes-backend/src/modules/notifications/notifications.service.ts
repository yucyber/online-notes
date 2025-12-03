import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Notification, NotificationDocument } from './schemas/notification.schema'

@Injectable()
export class NotificationsService {
  constructor(@InjectModel(Notification.name) private model: Model<NotificationDocument>) {}

  async list(userId: string, page: number = 1, size: number = 20, type?: string, status?: string) {
    const query: any = { userId: new Types.ObjectId(userId) }
    if (type) query.type = type
    if (status) query.status = status
    const items = await this.model.find(query).sort({ createdAt: -1 }).skip((page - 1) * size).limit(size).exec()
    const total = await this.model.countDocuments(query)
    return { items, page, size, total }
  }

  async create(userId: Types.ObjectId, type: string, payload: any) {
    const n = new this.model({ userId, type, payload, status: 'unread' })
    await n.save()
    return n
  }

  async markRead(id: string, userId: string) {
    await this.model.updateOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) }, { $set: { status: 'read' } }).exec()
    return { ok: true }
  }
}
