import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type MindmapDocument = Mindmap & Document

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
export class Mindmap {
  @Prop({ required: true })
  title: string

  @Prop({ type: Types.ObjectId })
  noteId?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId
}

export const MindmapSchema = SchemaFactory.createForClass(Mindmap)

MindmapSchema.index({ userId: 1, createdAt: -1 }, { name: 'idx_mindmap_user_created' })
MindmapSchema.index({ noteId: 1 }, { name: 'idx_mindmap_note' })

