import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type NoteVersionDocument = NoteVersion & Document

@Schema({ timestamps: true })
export class NoteVersion {
  @Prop({ type: Types.ObjectId, ref: 'Note', required: true })
  noteId: Types.ObjectId

  @Prop({ required: true })
  versionNo: number

  @Prop({ required: true })
  title: string

  @Prop({ required: true })
  content: string

  @Prop([{ type: Types.ObjectId, ref: 'Tag' }])
  tags: Types.ObjectId[]

  @Prop({ type: Types.ObjectId, ref: 'Category' })
  categoryId?: Types.ObjectId

  @Prop([{ type: Types.ObjectId, ref: 'Category' }])
  categoryIds?: Types.ObjectId[]

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId
}

export const NoteVersionSchema = SchemaFactory.createForClass(NoteVersion)
