import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NoteDocument = Note & Document;

@Schema({
  timestamps: true,
  toJSON: {
    transform: (doc, ret: any) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Note {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: Types.ObjectId, ref: 'Category' })
  categoryId?: Types.ObjectId;

  @Prop([{ type: Types.ObjectId, ref: 'Category' }])
  categoryIds?: Types.ObjectId[];

  @Prop([{ type: Types.ObjectId, ref: 'Tag' }])
  tags: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['published', 'draft'], default: 'published' })
  status: string;

  @Prop({ required: true, enum: ['private', 'org', 'public'], default: 'private' })
  visibility: string;

  @Prop([{ userId: { type: Types.ObjectId, ref: 'User' }, role: { type: String, enum: ['owner', 'editor', 'viewer', 'commenter'] }, addedBy: { type: Types.ObjectId, ref: 'User' }, addedAt: { type: Date, default: Date.now } }])
  acl?: { userId: Types.ObjectId; role: string; addedBy?: Types.ObjectId; addedAt?: Date }[];

  @Prop({ type: Types.ObjectId })
  currentVersionId?: Types.ObjectId;

  @Prop({ type: Number, default: 0 })
  versionCount?: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  editingBy?: Types.ObjectId;

  @Prop({ type: Date })
  lockedAt?: Date;
}

export const NoteSchema = SchemaFactory.createForClass(Note);
