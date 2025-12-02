import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Note, NoteDocument } from '../notes/schemas/note.schema';
import { Category, CategoryDocument } from '../categories/schemas/category.schema';
import { Tag, TagDocument } from '../tags/schemas/tag.schema';

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(Tag.name) private readonly tagModel: Model<TagDocument>,
  ) {}

  /**
   * 汇总当前用户在仪表盘需要展示的概览信息，包含：
   *  - 统计数据（笔记、分类、标签数量）
   *  - 最近更新的笔记
   *  - 热门分类（按照笔记数量排序，最多6条）
   */
  async getOverview(userId: string) {
    const userObjectId = new Types.ObjectId(userId);

    const [noteCount, categoryCount, tagCount, recentNotes, topCategories] = await Promise.all([
      this.noteModel.countDocuments({ userId: userObjectId }),
      this.categoryModel.countDocuments({ userId: userObjectId }),
      this.tagModel.countDocuments({ userId: userObjectId }),
      this.noteModel
        .find({ userId: userObjectId })
        .sort({ updatedAt: -1 })
        .limit(5)
        .select('title content updatedAt createdAt categoryId tags')
        .populate('categoryId', '_id name color')
        .populate('tags', '_id name color')
        .lean(),
      this.categoryModel
        .find({ userId: userObjectId })
        .sort({ noteCount: -1, updatedAt: -1 })
        .limit(6)
        .select('name color noteCount')
        .lean(),
    ]);

    return {
      stats: {
        notes: noteCount,
        categories: categoryCount,
        tags: tagCount,
      },
      recentNotes: recentNotes.map((note: any) => ({
        id: note._id.toString(),
        title: note.title,
        updatedAt: note.updatedAt || new Date().toISOString(),
        createdAt: note.createdAt || new Date().toISOString(),
        preview: note.content?.slice(0, 160) || '',
        category: note.categoryId
          ? {
              id: (note.categoryId as any)._id?.toString?.() ?? (note.categoryId as any).id,
              name: (note.categoryId as any).name,
              color: (note.categoryId as any).color,
            }
          : null,
        tags: Array.isArray(note.tags)
          ? note.tags.map((tag: any) => ({
              id: tag._id?.toString?.() ?? tag.id,
              name: tag.name,
              color: tag.color,
            }))
          : [],
      })),
      topCategories: topCategories.map((category: any) => ({
        id: category._id.toString(),
        name: category.name,
        color: category.color,
        noteCount: category.noteCount ?? 0,
      })),
    };
  }
}
