import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type CommentDocument = Comment & Document

@Schema({ timestamps: true })
export class Comment {
  @Prop({ type: Types.ObjectId, ref: 'Note', required: true })
  noteId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId

  @Prop({ required: true })
  start: number

  @Prop({ required: true })
  end: number

  @Prop({ required: true })
  text: string

  @Prop({ type: [{ authorId: { type: Types.ObjectId, ref: 'User' }, text: String, createdAt: Date }] })
  replies?: { authorId: Types.ObjectId; text: string; createdAt: Date }[]
}

export const CommentSchema = SchemaFactory.createForClass(Comment)
