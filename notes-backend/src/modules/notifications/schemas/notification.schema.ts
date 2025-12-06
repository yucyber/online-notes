import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type NotificationDocument = Notification & Document

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId

  @Prop({ required: true, enum: ['invitation', 'info'] })
  type: string

  @Prop({ required: true, enum: ['unread', 'read'], default: 'unread' })
  status: string

  @Prop({ type: Object })
  payload?: any
}

export const NotificationSchema = SchemaFactory.createForClass(Notification)
// 列表与计数优化索引：按用户+状态/类型过滤并按创建时间倒序
NotificationSchema.index({ userId: 1, status: 1, createdAt: -1 }, { name: 'idx_user_status_created' })
NotificationSchema.index({ userId: 1, type: 1, createdAt: -1 }, { name: 'idx_user_type_created' })
