import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Note, NoteDocument } from './schemas/note.schema';
import { CreateNoteDto, UpdateNoteDto, NoteFilterDto } from './dto';
import { CategoriesService } from '../categories/categories.service';
import { TagsService } from '../tags/tags.service';

@Injectable()
export class NotesService {
  constructor(
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    private readonly categoriesService: CategoriesService,
    private readonly tagsService: TagsService,
  ) { }

  async create(createNoteDto: CreateNoteDto, userId: string): Promise<Note> {
    const createdNote = new this.noteModel({
      ...createNoteDto,
      userId: new Types.ObjectId(userId),
      tags: createNoteDto.tags ? createNoteDto.tags.map(tag => new Types.ObjectId(tag)) : [],
      categoryIds: createNoteDto.categoryIds ? createNoteDto.categoryIds.map(id => new Types.ObjectId(id)) : undefined,
    });

    const savedNote = await createdNote.save();

    // Update category and tag counts
    if (createNoteDto.categoryId) {
      await this.categoriesService.incrementNoteCount(createNoteDto.categoryId);
    }
    if (createNoteDto.categoryIds && createNoteDto.categoryIds.length > 0) {
      for (const cid of createNoteDto.categoryIds) {
        await this.categoriesService.incrementNoteCount(cid)
      }
    }

    if (createNoteDto.tags && createNoteDto.tags.length > 0) {
      for (const tagId of createNoteDto.tags) {
        await this.tagsService.incrementNoteCount(tagId);
      }
    }

    return savedNote;
  }

  async findAll(userId: string, filterDto: NoteFilterDto = {}): Promise<Note[]> {
    const { keyword, categoryId, categoryIds, categoriesMode, tagIds, startDate, endDate, status, tagsMode } = filterDto;

    // Use $and to safely combine multiple conditions including $or clauses
    const andConditions: any[] = [];

    // 1. Base condition: User ID
    andConditions.push({ userId: new Types.ObjectId(userId) });

    // 2. Keyword Search (Title or Content)
    if (keyword) {
      andConditions.push({
        $or: [
          { title: { $regex: keyword, $options: 'i' } },
          { content: { $regex: keyword, $options: 'i' } },
        ],
      });
    }

    // 3. Category Filter (Handle both ObjectId and String storage)
    if (categoryId) {
      andConditions.push({
        $or: [
          { categoryId: new Types.ObjectId(categoryId) },
          { categoryId: categoryId }
        ]
      });
    }

    if (categoryIds && categoryIds.length > 0) {
      const ids = Array.isArray(categoryIds) ? categoryIds : [categoryIds]
      const objectIds = ids.filter(Boolean).map(id => new Types.ObjectId(id))
      const stringIds = ids.filter(Boolean)
      const isAll = categoriesMode === 'all' || (ids.length > 1 && !categoriesMode)
      const op = isAll ? '$all' : '$in'
      andConditions.push({
        $or: [
          { categoryIds: { [op]: objectIds } },
          { categoryIds: { [op]: stringIds } },
        ],
      })
    }

    // 4. Tags Filter
    if (tagIds && tagIds.length > 0) {
      const tags = Array.isArray(tagIds) ? tagIds : [tagIds];
      const objectIds = tags.filter(Boolean).map(id => new Types.ObjectId(id));
      const stringIds = tags.filter(Boolean);

      const isAll = tagsMode === 'all' || (tags.length > 1 && !tagsMode);
      const op = isAll ? '$all' : '$in';

      andConditions.push({
        $or: [
          { tags: { [op]: objectIds } },
          { tags: { [op]: stringIds } },
        ],
      });
    }

    // 5. Date Range
    if (startDate || endDate) {
      const dateQuery: any = {};
      if (startDate) {
        dateQuery.$gte = new Date(startDate);
      }
      if (endDate) {
        dateQuery.$lte = new Date(endDate);
      }
      andConditions.push({ updatedAt: dateQuery });
    }

    // 6. Status Filter
    if (status) {
      andConditions.push({ status });
    }

    // Construct final query
    const query = andConditions.length > 0 ? { $and: andConditions } : {};

    return this.noteModel
      .find(query)
      .populate('categoryId', 'name')
      .populate('tags', 'name')
      .sort({ updatedAt: -1 })
      .exec();
  }

  async findOne(id: string, userId: string): Promise<Note> {
    const note = await this.noteModel
      .findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      })
      .populate('categoryId', 'name')
      .populate('tags', 'name')
      .exec();

    if (!note) {
      throw new NotFoundException('笔记不存在');
    }

    return note;
  }

  async update(id: string, updateNoteDto: UpdateNoteDto, userId: string): Promise<Note> {
    // Get the original note first
    const originalNote = await this.noteModel.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    }).exec();

    if (!originalNote) {
      throw new NotFoundException('笔记不存在');
    }

    const updatedNote = await this.noteModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
        updateNoteDto,
        { new: true, runValidators: true },
      )
      .populate('categoryId', 'name')
      .populate('tags', 'name')
      .exec();

    if (!updatedNote) {
      throw new NotFoundException('笔记不存在');
    }

    // Handle category count changes
    if (updateNoteDto.categoryId && updateNoteDto.categoryId !== originalNote.categoryId?.toString()) {
      // Decrement old category count
      if (originalNote.categoryId) {
        await this.categoriesService.decrementNoteCount(originalNote.categoryId.toString());
      }
      // Increment new category count
      await this.categoriesService.incrementNoteCount(updateNoteDto.categoryId);
    }

    if (Array.isArray(updateNoteDto.categoryIds)) {
      const prev = (originalNote.categoryIds || []).map(id => id.toString())
      const next = updateNoteDto.categoryIds
      const toAdd = next.filter(id => !prev.includes(id))
      const toRemove = prev.filter(id => !next.includes(id))
      for (const addId of toAdd) await this.categoriesService.incrementNoteCount(addId)
      for (const rmId of toRemove) await this.categoriesService.decrementNoteCount(rmId)
    }

    return updatedNote;
  }

  async remove(id: string, userId: string): Promise<void> {
    // Get the note first to update category and tag counts
    const note = await this.noteModel.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    }).exec();

    if (!note) {
      throw new NotFoundException('笔记不存在');
    }

    const result = await this.noteModel.deleteOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    }).exec();

    if (result.deletedCount === 0) {
      throw new NotFoundException('笔记不存在');
    }

    // Update category and tag counts
    if (note.categoryId) {
      await this.categoriesService.decrementNoteCount(note.categoryId.toString());
    }

    if (note.categoryIds && note.categoryIds.length > 0) {
      for (const cid of note.categoryIds) {
        await this.categoriesService.decrementNoteCount(cid.toString())
      }
    }

    if (note.tags && note.tags.length > 0) {
      for (const tagId of note.tags) {
        await this.tagsService.decrementNoteCount(tagId.toString());
      }
    }
  }

  async getRecommendations(userId: string, currentNoteId?: string, limit: number = 5, context?: NoteFilterDto): Promise<Note[]> {
    console.log('Recommendations request', { userId, currentNoteId, limit, context })
    const userObjectId = new Types.ObjectId(userId);
    let recommendations: Note[] = [];
    const excludeIds: Types.ObjectId[] = [];
    const ctx = context || {}

    const andConditions: any[] = [{ userId: userObjectId }]
    const { keyword, categoryId, tagIds, startDate, endDate, status, tagsMode } = ctx

    if (keyword) {
      andConditions.push({
        $or: [
          { title: { $regex: keyword, $options: 'i' } },
          { content: { $regex: keyword, $options: 'i' } },
        ],
      })
    }

    if (categoryId) {
      andConditions.push({
        $or: [
          { categoryId: new Types.ObjectId(categoryId) },
          { categoryId: categoryId },
        ],
      })
    }

    if (tagIds && tagIds.length > 0) {
      const tags = Array.isArray(tagIds) ? tagIds : [tagIds]
      const objectIds = tags.filter(Boolean).map(id => new Types.ObjectId(id))
      const stringIds = tags.filter(Boolean)
      const isAll = tagsMode === 'all' || (tags.length > 1 && !tagsMode)
      const op = isAll ? '$all' : '$in'
      andConditions.push({
        $or: [
          { tags: { [op]: objectIds } },
          { tags: { [op]: stringIds } },
        ],
      })
    }

    if (startDate || endDate) {
      const dateQuery: any = {}
      if (startDate) dateQuery.$gte = new Date(startDate)
      if (endDate) dateQuery.$lte = new Date(endDate)
      andConditions.push({ updatedAt: dateQuery })
    }

    if (status) {
      andConditions.push({ status })
    } else {
      andConditions.push({ status: 'published' })
    }

    if (currentNoteId) {
      try {
        const currentNote = await this.noteModel.findById(currentNoteId).exec();
        excludeIds.push(new Types.ObjectId(currentNoteId));

        if (currentNote && currentNote.tags && currentNote.tags.length > 0) {
          const base = { $and: andConditions }
          const relatedNotes = await this.noteModel.find({
            ...base,
            _id: { $ne: new Types.ObjectId(currentNoteId) },
            tags: { $in: currentNote.tags },
          })
            .limit(limit)
            .populate('categoryId', 'name')
            .populate('tags', 'name')
            .exec();

          recommendations.push(...relatedNotes);
          relatedNotes.forEach(note => excludeIds.push(note._id as Types.ObjectId));
        }
      } catch (error) {
        console.error('Recommendations currentNote branch error', error)
      }
    }

    if (recommendations.length < limit) {
      const base = { $and: andConditions }
      const recentNotes = await this.noteModel.find({
        ...base,
        _id: { $nin: excludeIds },
      })
        .sort({ updatedAt: -1 })
        .limit(limit - recommendations.length)
        .populate('categoryId', 'name')
        .populate('tags', 'name')
        .exec();

      recommendations.push(...recentNotes);
      recentNotes.forEach(note => excludeIds.push(note._id as Types.ObjectId));
    }

    const drafts = await this.noteModel.find({
      userId: userObjectId,
      status: 'draft',
      _id: { $nin: excludeIds }
    })
      .sort({ updatedAt: -1 })
      .limit(2)
      .populate('categoryId', 'name')
      .populate('tags', 'name')
      .exec();

    const result = [...recommendations, ...drafts]
    console.log('Recommendations result', { count: result.length })
    return result
  }
}
