import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'

export type NoteChunkDocument = HydratedDocument<NoteChunk>

@Schema({ collection: 'note_chunks', versionKey: false })
export class NoteChunk {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Note', required: true })
  noteId: Types.ObjectId

  @Prop({ required: true, min: 0 })
  chunkIndex: number

  @Prop({ type: [String], default: [] })
  headingPath: string[]

  @Prop({ required: true })
  content: string

  @Prop({ required: true })
  contentHash: string

  @Prop({ type: [Number], required: true })
  embedding: number[]
}

export const NoteChunkSchema = SchemaFactory.createForClass(NoteChunk)

NoteChunkSchema.index({ noteId: 1, chunkIndex: 1 }, { unique: true, name: 'idx_note_chunk' })
NoteChunkSchema.index({ userId: 1, noteId: 1 }, { name: 'idx_user_note' })
NoteChunkSchema.index({ noteId: 1, contentHash: 1 }, { name: 'idx_note_hash' })
