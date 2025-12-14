import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Note, NoteDocument } from './schemas/note.schema';
import { CreateNoteDto, UpdateNoteDto, NoteFilterDto } from './dto';
import { CategoriesService } from '../categories/categories.service';
import { TagsService } from '../tags/tags.service';
import { EmbeddingService } from '../semantic/embedding.service';
import Redis from 'ioredis'
import { createHash } from 'crypto'

@Injectable()
export class NotesService {
  constructor(
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    private readonly categoriesService: CategoriesService,
    private readonly tagsService: TagsService,
    private readonly embeddingService: EmbeddingService,
  ) { }

  private redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')

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

    // Async embedding generation
    this.updateEmbedding(savedNote);

    return savedNote;
  }

  private async updateEmbedding(note: NoteDocument) {
    try {
      const text = `${note.title}\n${note.content}`;
      // Truncate if too long (Coze might have limits, e.g. 4000 chars)
      const truncatedText = text.substring(0, 8000);
      const embedding = await this.embeddingService.generateEmbedding(truncatedText);

      if (embedding && embedding.length > 0) {
        // Use updateOne to avoid version conflicts and unnecessary overhead
        await this.noteModel.updateOne(
          { _id: note._id },
          { $set: { embedding: embedding } }
        );
      }
    } catch (error) {
      console.error(`Failed to update embedding for note ${note._id}:`, error);
    }
  }

  async findAll(userId: string, filterDto: NoteFilterDto = {}): Promise<{ items: Note[]; page: number; size: number; total: number }> {
    const { keyword, categoryId, categoryIds, categoriesMode, tagIds, startDate, endDate, status, tagsMode, searchMode, cursor } = filterDto;
    const page = Math.max(1, Number(filterDto.page || 1))
    const size = Math.max(1, Math.min(100, Number(filterDto.limit ?? filterDto.size ?? 20)))
    const sortBy = (filterDto.sortBy || 'createdAt')
    const sortOrder = (filterDto.sortOrder || 'desc')

    // Read-only cache (TTL 10s)
    const keyPayload = { userId, keyword, categoryId, categoryIds, categoriesMode, tagIds, startDate, endDate, status, tagsMode, searchMode, cursor, page, size, sortBy, sortOrder }
    const cacheKey = `notes:list:${userId}:${createHash('sha1').update(JSON.stringify(keyPayload)).digest('hex')}`
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached) {
        return JSON.parse(cached)
      }
    } catch { /* ignore */ }

    // Use $and to safely combine multiple conditions including $or clauses
    const andConditions: any[] = [];

    // 1. Base condition: Access scope
    const u = new Types.ObjectId(userId)
    const accessScope = {
      $or: [
        { userId: u },
        { acl: { $elemMatch: { userId: u } } },
        { visibility: 'public' },
      ],
    }
    andConditions.push(accessScope)

    // 2. Keyword Search：新增 `$text` 分支（默认正则）
    if (keyword) {
      if (searchMode === 'text') {
        andConditions.push({ $text: { $search: keyword } })
      } else {
        andConditions.push({
          $or: [
            { title: { $regex: keyword, $options: 'i' } },
            { content: { $regex: keyword, $options: 'i' } },
          ],
        });
      }
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
      // 与排序字段对齐：当 sortBy=createdAt 时使用 createdAt；否则沿用 updatedAt
      andConditions.push({ [sortBy === 'createdAt' ? 'createdAt' : 'updatedAt']: dateQuery });
    }

    // 6. Status Filter
    if (status) {
      andConditions.push({ status });
    }

    // 7. Cursor（基于 createdAt 的时间游标；当提供 cursor 时优先游标分页）
    if (cursor) {
      const c = new Date(cursor)
      if (isNaN(c.getTime())) {
        const { HttpException, HttpStatus } = require('@nestjs/common')
        throw new HttpException('invalid cursor', HttpStatus.BAD_REQUEST)
      }
      if (sortBy === 'createdAt') {
        andConditions.push({ createdAt: sortOrder === 'desc' ? { $lt: c } : { $gt: c } })
      } else {
        // 非默认字段的游标暂不支持；返回400以避免误用
        const { HttpException, HttpStatus } = require('@nestjs/common')
        throw new HttpException('cursor only supports sortBy=createdAt', HttpStatus.BAD_REQUEST)
      }
    }

    // Construct final query
    const query = andConditions.length > 0 ? { $and: andConditions } : {};

    const [items, total] = await Promise.all([
      this.noteModel
        .find(query)
        .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
        .skip((page - 1) * size)
        .limit(size)
        .maxTimeMS(300)
        .select('title content categoryId categoryIds tags userId status createdAt updatedAt')
        .lean()
        .exec(),
      this.noteModel.countDocuments(query),
    ])
    // 提供游标信息以便前端在深分页场景改用基于时间的 seek 分页，降低跳页成本
    const nextCursor = (sortBy === 'createdAt' && items.length > 0)
      ? new Date(((items[items.length - 1] as any).createdAt) as any).toISOString()
      : undefined
    const resp: any = { items, page, size, total, ...(nextCursor ? { nextCursor } : {}) }
    try { await this.redis.set(cacheKey, JSON.stringify(resp), 'EX', 10) } catch { /* ignore */ }
    return resp
  }

  async findOne(id: string, userId: string): Promise<Note> {
    const u = new Types.ObjectId(userId)
    const note = await this.noteModel
      .findOne({
        _id: new Types.ObjectId(id),
        $or: [
          { userId: u },
          { acl: { $elemMatch: { userId: u } } },
          { visibility: 'public' },
        ],
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
    const u = new Types.ObjectId(userId)
    const originalNote = await this.noteModel.findOne({
      _id: new Types.ObjectId(id),
      $or: [
        { userId: u },
        { acl: { $elemMatch: { userId: u, role: { $in: ['owner', 'editor'] } } } },
      ],
    }).exec();

    if (!originalNote) {
      throw new NotFoundException('笔记不存在');
    }

    const updatedNote = await this.noteModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id) },
        updateNoteDto,
        { new: true, runValidators: true },
      )
      .populate('categoryId', 'name')
      .populate('tags', 'name')
      .exec();

    if (!updatedNote) {
      throw new NotFoundException('笔记不存在');
    }

    // Async embedding generation if content or title changed
    if (updateNoteDto.title || updateNoteDto.content) {
      this.updateEmbedding(updatedNote);
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
    const u = new Types.ObjectId(userId)
    const note = await this.noteModel.findOne({
      _id: new Types.ObjectId(id),
      $or: [
        { userId: u },
        { acl: { $elemMatch: { userId: u, role: 'owner' } } },
      ],
    }).exec();

    if (!note) {
      throw new NotFoundException('笔记不存在');
    }

    const result = await this.noteModel.deleteOne({
      _id: new Types.ObjectId(id),
      userId: u,
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

  async getAcl(id: string, userId: string): Promise<{ visibility: string; acl: any[] }> {
    const u = new Types.ObjectId(userId)
    const note = await this.noteModel.findOne({ _id: new Types.ObjectId(id), $or: [{ userId: u }, { acl: { $elemMatch: { userId: u } } }] }).exec()
    if (!note) {
      throw new NotFoundException('笔记不存在')
    }
    return { visibility: (note as any).visibility, acl: (note as any).acl || [] }
  }

  async addCollaborator(id: string, actorId: string, targetUserId: string, role: 'editor' | 'viewer'): Promise<any> {
    const actor = new Types.ObjectId(actorId)
    const target = new Types.ObjectId(targetUserId)
    const note = await this.noteModel.findById(id).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    const isOwner = note.userId.equals(actor) || ((note as any).acl || []).some((a: any) => a.userId?.equals(actor) && a.role === 'owner')
    if (!isOwner) throw new NotFoundException('无权限')
    const acl = ((note as any).acl || []) as any[]
    const exists = acl.find((a: any) => a.userId?.equals(target))
    if (exists) {
      exists.role = role
    } else {
      acl.push({ userId: target, role, addedBy: actor, addedAt: new Date() })
    }
    ; (note as any).acl = acl
    await note.save()
    // audit
    try { const { AuditService } = require('../audit/audit.service'); } catch { }
    return { ok: true }
  }

  async updateCollaboratorRole(id: string, actorId: string, targetUserId: string, role: 'owner' | 'editor' | 'viewer') {
    const actor = new Types.ObjectId(actorId)
    const target = new Types.ObjectId(targetUserId)
    const note = await this.noteModel.findById(id).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    const isOwner = note.userId.equals(actor) || ((note as any).acl || []).some((a: any) => a.userId?.equals(actor) && a.role === 'owner')
    if (!isOwner) throw new NotFoundException('无权限')
    const acl = ((note as any).acl || []) as any[]
    const entry = acl.find((a: any) => a.userId?.equals(target))
    if (!entry) throw new NotFoundException('协作者不存在')
    entry.role = role
      ; (note as any).acl = acl
    await note.save()
    return { ok: true }
  }

  async removeCollaborator(id: string, actorId: string, targetUserId: string) {
    const actor = new Types.ObjectId(actorId)
    const target = new Types.ObjectId(targetUserId)
    const note = await this.noteModel.findById(id).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    const isOwner = note.userId.equals(actor) || ((note as any).acl || []).some((a: any) => a.userId?.equals(actor) && a.role === 'owner')
    if (!isOwner) throw new NotFoundException('无权限')
    const acl = ((note as any).acl || []) as any[]
    const next = acl.filter((a: any) => !a.userId?.equals(target))
      ; (note as any).acl = next
    await note.save()
    return { ok: true }
  }

  async lockNote(id: string, userId: string) {
    const u = new Types.ObjectId(userId)
    const note = await this.noteModel.findOne({ _id: new Types.ObjectId(id), $or: [{ userId: u }, { acl: { $elemMatch: { userId: u, role: { $in: ['owner', 'editor'] } } } }] }).exec()
    if (!note) throw new NotFoundException('无权限')
      ; (note as any).editingBy = u
      ; (note as any).lockedAt = new Date()
    await note.save()
    return { ok: true }
  }

  async unlockNote(id: string, userId: string) {
    const u = new Types.ObjectId(userId)
    const note = await this.noteModel.findById(id).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    if (note.userId.equals(u) || ((note as any).editingBy && (note as any).editingBy.equals(u))) {
      ; (note as any).editingBy = undefined
        ; (note as any).lockedAt = undefined
      await note.save()
      return { ok: true }
    }
    throw new NotFoundException('无权限')
  }

  async getRecommendations(userId: string, currentNoteId?: string, limit: number = 5, context?: NoteFilterDto): Promise<Note[]> {
    console.log('Recommendations request', { userId, currentNoteId, limit, context })
    const userObjectId = new Types.ObjectId(userId);
    let recommendations: Note[] = [];
    const excludeIds: Types.ObjectId[] = [];
    const ctx = context || {}

    const andConditions: any[] = [{ userId: userObjectId }]
    const { keyword, categoryId, tagIds, startDate, endDate, status, tagsMode, searchMode } = ctx

    if (keyword) {
      if (searchMode === 'text') {
        andConditions.push({ $text: { $search: keyword } })
      } else {
        andConditions.push({
          $or: [
            { title: { $regex: keyword, $options: 'i' } },
            { content: { $regex: keyword, $options: 'i' } },
          ],
        })
      }
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
        // Select embedding explicitly if it's not selected by default
        const currentNote = await this.noteModel.findById(currentNoteId).select('+embedding').exec();

        if (currentNote) {
          excludeIds.push(currentNote._id as Types.ObjectId);

          // 1. Strategy: Vector Search (Semantic Similarity)
          // If the current note has an embedding, find semantically similar notes
          if (currentNote.embedding && currentNote.embedding.length > 0) {
            try {
              const vectorResults = await this.noteModel.aggregate([
                {
                  $vectorSearch: {
                    index: 'vector_index',
                    path: 'embedding',
                    queryVector: currentNote.embedding,
                    numCandidates: 50,
                    limit: limit,
                    filter: {
                      userId: { $eq: userObjectId }
                    }
                  }
                },
                {
                  $match: {
                    _id: { $ne: currentNote._id },
                    status: 'published'
                  }
                },
                {
                  $project: {
                    title: 1, content: 1, categoryId: 1, categoryIds: 1, tags: 1, userId: 1, status: 1, createdAt: 1, updatedAt: 1,
                    score: { $meta: 'vectorSearchScore' }
                  }
                }
              ]).exec();

              recommendations.push(...(vectorResults as any[]));
              vectorResults.forEach(r => excludeIds.push(r._id));
            } catch (err) {
              console.warn('[Recommendations] Vector search failed, falling back to tags', err);
            }
          }

          // 2. Strategy: Tag Search (Fallback or Supplement)
          // If we still need more recommendations, use tags
          if (recommendations.length < limit && currentNote.tags && currentNote.tags.length > 0) {
            const base = { $and: andConditions }
            const relatedNotes = await this.noteModel.find({
              ...base,
              _id: { $nin: excludeIds },
              tags: { $in: currentNote.tags },
            })
              .limit(limit - recommendations.length)
              .select('title content categoryId categoryIds tags userId status createdAt updatedAt')
              .lean()
              .exec();

            recommendations.push(...relatedNotes);
            relatedNotes.forEach(note => excludeIds.push(note._id as Types.ObjectId));
          }
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
        .sort({ createdAt: -1 })
        .limit(limit - recommendations.length)
        .select('title content categoryId categoryIds tags userId status createdAt updatedAt')
        .lean()
        .exec();

      recommendations.push(...recentNotes);
      recentNotes.forEach(note => excludeIds.push(note._id as Types.ObjectId));
    }

    const drafts = await this.noteModel.find({
      userId: userObjectId,
      status: 'draft',
      _id: { $nin: excludeIds }
    })
      .sort({ createdAt: -1 })
      .limit(2)
      .select('title content categoryId categoryIds tags userId status createdAt updatedAt')
      .lean()
      .exec();

    const result = [...recommendations, ...drafts]
    console.log('Recommendations result', { count: result.length })
    return result
  }
}
