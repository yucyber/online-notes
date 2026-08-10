import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Note, NoteDocument } from '../notes/schemas/note.schema';
import { Tag, TagDocument } from './schemas/tag.schema';
import { CreateTagDto, UpdateTagDto } from './dto';
import { assertOwnedByUser } from '../taxonomy/taxonomy-ownership';

@Injectable()
export class TagsService {
  constructor(
    @InjectModel(Tag.name) private tagModel: Model<TagDocument>,
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
  ) { }

  async create(createTagDto: CreateTagDto, userId: string): Promise<Tag> {
    // 标签名只要求在当前用户空间内唯一，不影响其他用户使用同名标签。
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

  async findOrCreate(name: string, userId: string): Promise<Tag> {
    const existingTag = await this.tagModel.findOne({
      name: name,
      userId: new Types.ObjectId(userId),
    });

    if (existingTag) {
      return existingTag;
    }

    const createdTag = new this.tagModel({
      name,
      userId: new Types.ObjectId(userId),
      color: '#3b82f6' // 未指定颜色时使用产品默认蓝色。
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

  async assertOwnedIds(ids: string[], userId: string): Promise<void> {
    await assertOwnedByUser(ids, userId, this.tagModel, '标签')
  }

  async update(id: string, updateTagDto: UpdateTagDto, userId: string): Promise<Tag> {
    // 重命名时排除自身，同时仍把唯一性限制在当前用户空间内。
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

  async incrementNoteCount(tagId: string, amount: number = 1) {
    return this.tagModel.findByIdAndUpdate(tagId, { $inc: { noteCount: amount } });
  }

  async remove(id: string, userId: string): Promise<void> {
    // 先从当前用户的笔记中解除引用，再删除标签，避免留下无法展示的悬空 ID。
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

  async decrementNoteCount(tagId: string): Promise<void> {
    await this.tagModel.findByIdAndUpdate(tagId, {
      $inc: { noteCount: -1 },
    }).exec();
  }

  async bulkCreate(names: string[], userId: string): Promise<{ created: Tag[]; skipped: string[] }> {
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

  async syncCounts(userId: string) {
    const tags = await this.tagModel.find({ userId: new Types.ObjectId(userId) });
    let updated = 0;
    for (const tag of tags) {
      // 历史笔记可能把标签 ID 存成 ObjectId 或 String，重算时必须同时匹配两种格式。
      const count = await this.noteModel.countDocuments({
        userId: new Types.ObjectId(userId),
        tags: { $in: [tag._id, tag._id.toString()] }
      });

      if (tag.noteCount !== count || tag.noteCount === undefined) {
        tag.noteCount = count;
        await tag.save();
        updated++;
      }
    }
    return { total: tags.length, updated };
  }

  async merge(sourceIds: string[], targetId: string, userId: string): Promise<{ affectedNotes: number }> {
    if (!targetId || !Array.isArray(sourceIds) || sourceIds.length === 0) return { affectedNotes: 0 }
    if (sourceIds.length > 3) throw new ConflictException('一次最多合并 3 个标签')
    const userObj = new Types.ObjectId(userId)
    const srcObjIds = sourceIds.map(id => new Types.ObjectId(id))
    const targetObjId = new Types.ObjectId(targetId)
    // 先补目标标签再移除源标签，保证每篇受影响笔记在迁移过程中仍有可用标签。
    const addRes = await this.noteModel.updateMany(
      { userId: userObj, tags: { $in: srcObjIds } },
      { $addToSet: { tags: targetObjId } }
    ).exec()
    await this.noteModel.updateMany(
      { userId: userObj, tags: { $in: srcObjIds } },
      { $pull: { tags: { $in: srcObjIds } } }
    ).exec()

    await this.tagModel.deleteMany({ _id: { $in: srcObjIds }, userId: userObj }).exec()
    // modifiedCount 是实际新增目标标签的笔记数，用它增量修正目标标签计数。
    await this.tagModel.findByIdAndUpdate(targetObjId, { $inc: { noteCount: addRes.modifiedCount || 0 } }).exec()

    return { affectedNotes: addRes.modifiedCount || 0 }
  }
}
