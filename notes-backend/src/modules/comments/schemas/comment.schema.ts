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

  @Prop()
  blockId?: string

  @Prop({
    type: {
      targetType: { type: String },
      docPath: { type: [String], default: [] },
      startOffset: Number,
      endOffset: Number,
      versionId: { type: Types.ObjectId },
      contentHash: String,
      contextSnippet: String,
      resolution: { type: String },
      resolvedAt: { type: Date },
    },
  })
  anchor?: {
    targetType?: string
    docPath?: string[]
    startOffset?: number
    endOffset?: number
    versionId?: Types.ObjectId
    contentHash?: string
    contextSnippet?: string
    resolution?: string
    resolvedAt?: Date
  }

  @Prop({ required: true })
  text: string

  @Prop({ type: [{ authorId: { type: Types.ObjectId, ref: 'User' }, text: String, createdAt: Date }] })
  replies?: { authorId: Types.ObjectId; text: string; createdAt: Date }[]
}

export const CommentSchema = SchemaFactory.createForClass(Comment)
CommentSchema.index({ noteId: 1, start: 1, end: 1, createdAt: -1 })
CommentSchema.index({ noteId: 1, blockId: 1, createdAt: -1 })
CommentSchema.index({ noteId: 1, 'anchor.versionId': 1, createdAt: -1 })
