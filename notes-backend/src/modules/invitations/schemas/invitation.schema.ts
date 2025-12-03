import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type InvitationDocument = Invitation & Document

@Schema({
  timestamps: true,
  toJSON: {
    transform: (doc, ret: any) => {
      ret.id = ret._id
      delete ret._id
      delete ret.__v
      delete ret.tokenHash
      return ret
    },
  },
})
export class Invitation {
  @Prop({ type: Types.ObjectId, ref: 'Note', required: true })
  noteId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  inviterId: Types.ObjectId

  @Prop()
  inviteeEmail?: string

  @Prop({ required: true, enum: ['editor', 'viewer'] })
  role: string

  @Prop({ required: true })
  tokenHash: string

  @Prop({ required: true })
  expiresAt: Date

  @Prop({ required: true, enum: ['pending', 'accepted', 'revoked', 'expired'], default: 'pending' })
  status: string

  @Prop()
  usedAt?: Date

  @Prop()
  requestId?: string
}

export const InvitationSchema = SchemaFactory.createForClass(Invitation)
