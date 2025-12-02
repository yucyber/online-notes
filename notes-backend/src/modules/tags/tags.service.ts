import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Note, NoteDocument } from '../notes/schemas/note.schema';
import { Tag, TagDocument } from './schemas/tag.schema';
import { CreateTagDto, UpdateTagDto } from './dto';

@Injectable()
export class TagsService {
  constructor(
    @InjectModel(Tag.name) private tagModel: Model<TagDocument>,
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
  ) {}

  async create(createTagDto: CreateTagDto, userId: string): Promise<Tag> {
    // Check if tag name already exists for this user
    const existingTag = await this.tagModel.findOne({
      name: createTagDto.name,
      userId: new Types.ObjectId(userId),
    });

    if (existingTag) {
      throw new ConflictException('标签名称已存在');
    }

    const createdTag = new this.tagModel({
      ...createTagDto,
      userId: new Types.ObjectId(userId),
    });
    return createdTag.save();
  }

  async findAll(userId: string): Promise<Tag[]> {
    return this.tagModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(id: string, userId: string): Promise<Tag> {
    const tag = await this.tagModel.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    }).exec();

    if (!tag) {
      throw new NotFoundException('标签不存在');
    }

    return tag;
  }

  async update(id: string, updateTagDto: UpdateTagDto, userId: string): Promise<Tag> {
    // Check if tag name already exists for this user (excluding current tag)
    if (updateTagDto.name) {
      const existingTag = await this.tagModel.findOne({
        name: updateTagDto.name,
        userId: new Types.ObjectId(userId),
        _id: { $ne: new Types.ObjectId(id) },
      });

      if (existingTag) {
        throw new ConflictException('标签名称已存在');
      }
    }

    const updatedTag = await this.tagModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
        updateTagDto,
        { new: true, runValidators: true },
      )
      .exec();

    if (!updatedTag) {
      throw new NotFoundException('标签不存在');
    }

    return updatedTag;
  }

  async remove(id: string, userId: string): Promise<void> {
    // 默认策略：移除模式。从所有笔记中移除该标签，再删除
    await this.noteModel.updateMany(
      { userId: new Types.ObjectId(userId), tags: new Types.ObjectId(id) },
      { $pull: { tags: new Types.ObjectId(id) } }
    ).exec()

    const result = await this.tagModel.deleteOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    }).exec();

    if (result.deletedCount === 0) {
      throw new NotFoundException('标签不存在');
    }
  }

  async incrementNoteCount(tagId: string): Promise<void> {
    await this.tagModel.findByIdAndUpdate(tagId, {
      $inc: { noteCount: 1 },
    }).exec();
  }

  async decrementNoteCount(tagId: string): Promise<void> {
    await this.tagModel.findByIdAndUpdate(tagId, {
      $inc: { noteCount: -1 },
    }).exec();
  }

  async bulkCreate(names: string[], userId: string): Promise<{ created: Tag[]; skipped: string[] }>{
    const trimmed = Array.from(new Set(names.map(n => n.trim()).filter(Boolean)))
    if (trimmed.length === 0) return { created: [], skipped: [] }
    const existing = await this.tagModel.find({
      userId: new Types.ObjectId(userId),
      name: { $in: trimmed }
    }).select('name').exec()
    const existingNames = new Set(existing.map(e => e.name))
    const toInsert = trimmed.filter(n => !existingNames.has(n))
    const docs = toInsert.map(n => ({ name: n, userId: new Types.ObjectId(userId) }))
    const created = docs.length > 0 ? await this.tagModel.insertMany(docs) : []
    return { created, skipped: trimmed.filter(n => existingNames.has(n)) }
  }

  async merge(sourceIds: string[], targetId: string, userId: string): Promise<{ affectedNotes: number }>{
    if (!targetId || !Array.isArray(sourceIds) || sourceIds.length === 0) return { affectedNotes: 0 }
    if (sourceIds.length > 3) throw new ConflictException('一次最多合并 3 个标签')
    const userObj = new Types.ObjectId(userId)
    const srcObjIds = sourceIds.map(id => new Types.ObjectId(id))
    const targetObjId = new Types.ObjectId(targetId)
    // 添加目标标签
    const addRes = await this.noteModel.updateMany(
      { userId: userObj, tags: { $in: srcObjIds } },
      { $addToSet: { tags: targetObjId } }
    ).exec()
    // 移除源标签
    await this.noteModel.updateMany(
      { userId: userObj, tags: { $in: srcObjIds } },
      { $pull: { tags: { $in: srcObjIds } } }
    ).exec()

    // 删除源标签
    await this.tagModel.deleteMany({ _id: { $in: srcObjIds }, userId: userObj }).exec()
    // 更新计数（简单按受影响笔记数增量）
    await this.tagModel.findByIdAndUpdate(targetObjId, { $inc: { noteCount: addRes.modifiedCount || 0 } }).exec()

    return { affectedNotes: addRes.modifiedCount || 0 }
  }
}
