import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CategoryDocument = Category & Document;

@Schema({
  timestamps: true,
})
export class Category {
  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ default: '#3B82F6' })
  color: string;

  @Prop({ type: Types.ObjectId, ref: Category.name, default: null })
  parentId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ default: 0 })
  noteCount: number;
}

export const CategorySchema = SchemaFactory.createForClass(Category);