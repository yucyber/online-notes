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
// 统一对外输出 id，不暴露 _id
SavedFilterSchema.set('toJSON', {
  versionKey: false,
  virtuals: true,
  transform: (_doc: any, ret: any) => { ret.id = ret._id; delete ret._id; delete ret.__v; return ret },
})
// 用户级查询与排序优化：保障 saved filters 列表的 p95
SavedFilterSchema.index({ userId: 1, createdAt: -1 }, { name: 'idx_user_created' })
