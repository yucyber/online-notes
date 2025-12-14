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

  @Prop({ type: [Number], index: true })
  embedding?: number[];
}

export const NoteSchema = SchemaFactory.createForClass(Note);

// 性能索引：覆盖访问范围、筛选与排序，降低查询与排序的CPU占用
// 说明：索引创建会在首次连接时由 Mongoose 提交到 MongoDB；生产环境建议通过变更管理执行
NoteSchema.index({ userId: 1, status: 1, createdAt: -1 }, { name: 'idx_user_status_created' })
NoteSchema.index({ visibility: 1 }, { name: 'idx_visibility' })
NoteSchema.index({ 'acl.userId': 1 }, { name: 'idx_acl_user' })
NoteSchema.index({ categoryId: 1 }, { name: 'idx_categoryId' })
NoteSchema.index({ categoryIds: 1 }, { name: 'idx_categoryIds' })
NoteSchema.index({ tags: 1 }, { name: 'idx_tags' })
NoteSchema.index({ createdAt: -1 }, { name: 'idx_createdAt' })
// 补充按更新时间排序与过滤的索引，保障 sortBy=updatedAt 的场景
NoteSchema.index({ updatedAt: -1 }, { name: 'idx_updatedAt' })
NoteSchema.index({ userId: 1, status: 1, updatedAt: -1 }, { name: 'idx_user_status_updated' })
// 文本索引（可选）：用于 keyword 搜索提升性能；如需严格相关度排序，可在服务层切换为 $text 查询
NoteSchema.index({ title: 'text', content: 'text' }, { name: 'txt_title_content' })
// 兼顾稳定排序的复合索引：为常见的用户范围查询提供 createdAt/updatedAt 与 _id 作为并列排序键，保障深分页稳定性
// 说明：当查询按 userId/acl/visibility 过滤并按时间排序时，以下索引同时覆盖过滤与排序，减少 SORT 阶段 CPU
NoteSchema.index({ userId: 1, createdAt: -1, _id: -1 }, { name: 'idx_user_created_id' })
NoteSchema.index({ userId: 1, updatedAt: -1, _id: -1 }, { name: 'idx_user_updated_id' })
NoteSchema.index({ visibility: 1, createdAt: -1, _id: -1 }, { name: 'idx_visibility_created_id' })
NoteSchema.index({ 'acl.userId': 1, createdAt: -1, _id: -1 }, { name: 'idx_acl_user_created_id' })
NoteSchema.index({ visibility: 1, updatedAt: -1, _id: -1 }, { name: 'idx_visibility_updated_id' })
NoteSchema.index({ 'acl.userId': 1, updatedAt: -1, _id: -1 }, { name: 'idx_acl_user_updated_id' })
