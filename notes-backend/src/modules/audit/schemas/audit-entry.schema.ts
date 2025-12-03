import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type AuditEntryDocument = AuditEntry & Document

@Schema({ timestamps: true })
export class AuditEntry {
  @Prop({ required: true })
  eventType: string

  @Prop({ type: Types.ObjectId, ref: 'User' })
  actorId: Types.ObjectId

  @Prop({ required: true })
  resourceType: string

  @Prop({ type: Types.ObjectId })
  resourceId: Types.ObjectId

  @Prop()
  requestId?: string

  @Prop()
  traceId?: string

  @Prop()
  message?: string

  @Prop({ type: Object })
  before?: any

  @Prop({ type: Object })
  after?: any
}

export const AuditEntrySchema = SchemaFactory.createForClass(AuditEntry)
