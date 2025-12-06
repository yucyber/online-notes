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
// 版本索引：加速按版本倒序列出与唯一性约束
NoteVersionSchema.index({ noteId: 1, versionNo: -1, createdAt: -1 }, { name: 'idx_note_version_desc' })
NoteVersionSchema.index({ noteId: 1, versionNo: 1 }, { name: 'uniq_note_version', unique: true })
