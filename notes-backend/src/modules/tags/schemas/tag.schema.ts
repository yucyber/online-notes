import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TagDocument = Tag & Document;

@Schema({
  timestamps: true,
})
export class Tag {
  @Prop({ required: true })
  name: string;

  @Prop({ default: '#6B7280' })
  color: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ default: 0 })
  noteCount: number;
}

export const TagSchema = SchemaFactory.createForClass(Tag);
// 唯一约束：同一用户下标签名唯一
TagSchema.index({ userId: 1, name: 1 }, { unique: true });
