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
