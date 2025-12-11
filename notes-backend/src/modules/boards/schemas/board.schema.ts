import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type BoardDocument = Board & Document

@Schema({
  timestamps: true,
  toJSON: {
    transform: (doc, ret: any) => {
      ret.id = ret._id
      delete ret._id
      delete ret.__v
      return ret
    },
  },
})
export class Board {
  @Prop({ required: true })
  title: string

  @Prop({ type: Types.ObjectId })
  noteId?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId
}

export const BoardSchema = SchemaFactory.createForClass(Board)

BoardSchema.index({ userId: 1, createdAt: -1 }, { name: 'idx_board_user_created' })
BoardSchema.index({ noteId: 1 }, { name: 'idx_board_note' })

