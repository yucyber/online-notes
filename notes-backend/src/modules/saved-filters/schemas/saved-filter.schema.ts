import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SavedFilterDocument = SavedFilter & Document;

@Schema({ timestamps: true })
export class SavedFilter {
  @Prop({ required: true })
  name: string;

  @Prop({ type: Object, required: true })
  criteria: any;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;
}

export const SavedFilterSchema = SchemaFactory.createForClass(SavedFilter);
