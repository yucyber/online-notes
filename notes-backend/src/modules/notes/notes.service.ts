import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { Note, NoteDocument } from './schemas/note.schema';
import { CreateNoteDto, UpdateNoteDto, NoteFilterDto } from './dto';
import { CategoriesService } from '../categories/categories.service';
import { TagsService } from '../tags/tags.service';
import { EmbeddingService } from '../semantic/embedding.service';
import { AiService } from '../ai/ai.service';
import { NoteAccessService } from './note-access.service';
import { NoteCounterService } from './note-counter.service';
import { NoteCacheService } from './note-cache.service';
import { NoteRecommendationService } from './note-recommendation.service';
import { NoteDerivedService } from './note-derived.service';

@Injectable()
export class NotesService {
  constructor(
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    private readonly categoriesService: CategoriesService,
    private readonly tagsService: TagsService,
    private readonly embeddingService: EmbeddingService,
    private readonly aiService: AiService,
    private readonly noteAccess: NoteAccessService,
    private readonly noteCounter: NoteCounterService,
    private readonly noteCache: NoteCacheService,
    @Optional() private readonly noteRecommendations?: NoteRecommendationService,
    @Optional() noteDerived?: NoteDerivedService,
    @Optional() private readonly jwtService?: JwtService,
  ) {
    this.noteDerived = noteDerived || new NoteDerivedService(noteModel, embeddingService, aiService)
  }

  private readonly noteDerived: NoteDerivedService

  async create(createNoteDto: CreateNoteDto, userId: string): Promise<Note> {
    const tagIds = createNoteDto.tags || []
    // 先验证分类和标签归属，再创建引用，避免跨用户挂接领域数据。
    if (createNoteDto.categoryId) {
      await this.categoriesService.assertOwnedIds([createNoteDto.categoryId], userId)
    }
    await this.tagsService.assertOwnedIds(tagIds, userId)

    // 同步写入可立即展示的兜底摘要；AI 摘要稍后成功时再覆盖它。
    const fallbackSummary = this.noteDerived.buildFallbackSummary(createNoteDto.content)

    const createdNote = new this.noteModel({
      ...createNoteDto,
      summary: fallbackSummary,
      userId: new Types.ObjectId(userId),
      tags: createNoteDto.tags ? createNoteDto.tags.map(tag => new Types.ObjectId(tag)) : [],
      categoryId: createNoteDto.categoryId ? new Types.ObjectId(createNoteDto.categoryId) : undefined,
    });

    const savedNote = await createdNote.save();
    await this.noteCache.invalidateLists()

    await this.noteCounter.incrementForCreate({
      categoryId: createNoteDto.categoryId,
      tags: createNoteDto.tags,
    })

    // embedding 和 AI 摘要属于派生数据，失败不能阻断笔记创建主流程。
    this.updateEmbedding(savedNote);
    this.generateAndSaveSummary(savedNote);

    return savedNote;
  }

  async refreshDerivedFields(note: NoteDocument): Promise<void> {
    await this.noteDerived.refresh(note)
  }

  private generateAndSaveSummary(note: NoteDocument, expectedContent = String(note.content || '')) {
    return this.noteDerived.generateAndSaveSummary(note, expectedContent)
  }

  private async updateEmbedding(note: NoteDocument, expectedTitle = String(note.title || ''), expectedContent = String(note.content || '')) {
    return this.noteDerived.updateEmbedding(note, expectedTitle, expectedContent)
  }

  async findAll(userId: string, filterDto: NoteFilterDto = {}): Promise<{ items: Note[]; page: number; size: number; total: number }> {
    const { keyword, categoryId, tagIds, startDate, endDate, status, tagsMode, searchMode, cursor, ids } = filterDto;
    const page = Math.max(1, Number(filterDto.page || 1))
    const size = Math.max(1, Math.min(100, Number(filterDto.limit ?? filterDto.size ?? 20)))
    const sortBy = (filterDto.sortBy || 'createdAt')
    const sortOrder = (filterDto.sortOrder || 'desc')

    const keyPayload = { userId, keyword, categoryId, tagIds, startDate, endDate, status, tagsMode, searchMode, cursor, page, size, sortBy, sortOrder, ids, previewFieldsVersion: 'content-v1' }
    const listRevision = await this.noteCache.getListRevision()
    const cached = await this.noteCache.getList<{ items: Note[]; page: number; size: number; total: number }>(userId, keyPayload, listRevision)
    if (cached) return cached

    // 所有筛选都放进同一个 $and，确保 keyword 等内部 $or 不会冲掉最前面的访问范围。
    const andConditions: any[] = [];

    if (ids && ids.length > 0) {
      andConditions.push({ _id: { $in: ids.map(id => new Types.ObjectId(id)) } });
    }

    // 权限条件是列表查询的固定基线，后续任何筛选和分页都只能在此范围内收窄。
    andConditions.push(this.noteAccess.readableFilter(userId))

    // text 模式使用 MongoDB 文本索引；默认 regex 保留现有的部分匹配体验。
    if (keyword) {
      if (searchMode === 'text') {
        andConditions.push({ $text: { $search: keyword } })
      } else {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        andConditions.push({
          $or: [
            { title: { $regex: escaped, $options: 'i' } },
            { content: { $regex: escaped, $options: 'i' } },
          ],
        });
      }
    }

    if (categoryId) {
      andConditions.push({ categoryId: new Types.ObjectId(categoryId) });
    }

    // 多标签默认要求全部命中；显式 tagsMode=any 时才放宽为任一命中。
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

    if (startDate || endDate) {
      const dateQuery: any = {};
      if (startDate) {
        dateQuery.$gte = new Date(startDate);
      }
      if (endDate) {
        dateQuery.$lte = new Date(endDate);
      }
      // 日期范围跟随排序字段，避免列表按更新时间排序却按创建时间过滤。
      andConditions.push({ [sortBy === 'createdAt' ? 'createdAt' : 'updatedAt']: dateQuery });
    }

    if (status) {
      andConditions.push({ status });
    }

    // 当前游标只表达 createdAt；拒绝其他排序字段，避免返回看似成功但顺序错误的分页结果。
    if (cursor) {
      const c = new Date(cursor)
      if (isNaN(c.getTime())) {
        const { HttpException, HttpStatus } = require('@nestjs/common')
        throw new HttpException('invalid cursor', HttpStatus.BAD_REQUEST)
      }
      if (sortBy === 'createdAt') {
        andConditions.push({ createdAt: sortOrder === 'desc' ? { $lt: c } : { $gt: c } })
      } else {
        const { HttpException, HttpStatus } = require('@nestjs/common')
        throw new HttpException('cursor only supports sortBy=createdAt', HttpStatus.BAD_REQUEST)
      }
    }

    const query = andConditions.length > 0 ? { $and: andConditions } : {};

    const [items, total] = await Promise.all([
      this.noteModel
        .find(query)
        .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
        .skip((page - 1) * size)
        .limit(size)
        .maxTimeMS(300)
        .select('title summary content categoryId tags userId status createdAt updatedAt')
        .lean()
        .exec(),
      this.noteModel.countDocuments(query),
    ])
    // 返回时间游标供深分页切换为 seek 模式，避免页码越深时 skip 成本持续增加。
    const nextCursor = (sortBy === 'createdAt' && items.length > 0)
      ? new Date(((items[items.length - 1] as any).createdAt) as any).toISOString()
      : undefined
    const resp: any = { items, page, size, total, ...(nextCursor ? { nextCursor } : {}) }
    await this.noteCache.setList(userId, keyPayload, resp, listRevision)
    return resp
  }

  async findOne(id: string, userId: string): Promise<Note> {
    const note = await this.noteModel
      .findOne(this.noteAccess.readScope(id, userId))
      .populate('categoryId', 'name')
      .populate('tags', 'name')
      .exec();

    if (!note) {
      throw new NotFoundException('笔记不存在');
    }

    return note;
  }

  async update(id: string, updateNoteDto: UpdateNoteDto, userId: string): Promise<Note> {
    // 可见性影响所有读者，只有 owner 能改；正文等普通内容仍允许 editor 修改。
    const noteScope = updateNoteDto.visibility !== undefined
      ? this.noteAccess.ownerScope(id, userId)
      : this.noteAccess.writeScope(id, userId)
    const originalNote = await this.noteModel.findOne(noteScope).exec();

    if (!originalNote) {
      throw new NotFoundException('笔记不存在');
    }

    if (updateNoteDto.categoryId) {
      await this.categoriesService.assertOwnedIds([updateNoteDto.categoryId], userId)
    }
    if (updateNoteDto.tags !== undefined) {
      await this.tagsService.assertOwnedIds(updateNoteDto.tags, userId)
    }

    const updatePayload: Record<string, any> = { ...updateNoteDto }

    // 即使正文被显式清空也要同步刷新兜底摘要，不能遗留旧内容摘要。
    if (updatePayload.content !== undefined) {
      updatePayload.summary = this.noteDerived.buildFallbackSummary(updatePayload.content)
    }

    const updatedNote = await this.noteModel
      .findOneAndUpdate(
        noteScope,
        updatePayload,
        { new: true, runValidators: true },
      )
      .populate('categoryId', 'name')
      .populate('tags', 'name')
      .exec();

    if (!updatedNote) {
      throw new NotFoundException('笔记不存在');
    }

    // 派生字段异步刷新，不延长保存请求；服务内部会防止旧任务覆盖更新后的正文。
    await this.noteCache.invalidateLists()

    if (updatePayload.title !== undefined || updatePayload.content !== undefined) {
      this.updateEmbedding(updatedNote);
    }

    if (updatePayload.content !== undefined) {
      this.generateAndSaveSummary(updatedNote);
    }

    // 分类计数只在明确提交 categoryId（含清空 null）时更新；undefined 表示未修改，不触发。
    if (updatePayload.categoryId !== undefined) {
      const prev = originalNote.categoryId ? [originalNote.categoryId.toString()] : []
      const next = updatePayload.categoryId ? [updatePayload.categoryId] : []
      await this.noteCounter.updateCategories(prev, next)
    }

    // 只在请求明确提交 tags 时同步计数，避免局部更新误清现有标签。
    if (Array.isArray(updatePayload.tags)) {
      await this.noteCounter.updateTags(
        (originalNote.tags || []).map(t => t.toString()),
        updatePayload.tags,
      )
    }

    return updatedNote;
  }

  async remove(id: string, userId: string): Promise<void> {
    // 删除会影响整篇笔记及领域计数，因此只接受 owner 范围。
    const note = await this.noteModel.findOne(this.noteAccess.ownerScope(id, userId)).exec();

    if (!note) {
      throw new NotFoundException('笔记不存在');
    }

    const result = await this.noteModel.deleteOne(this.noteAccess.ownerScope(id, userId)).exec();

    if (result.deletedCount === 0) {
      throw new NotFoundException('笔记不存在');
    }

    await this.noteCache.invalidateLists()

    await this.noteCounter.decrementForDelete({
      categoryId: note.categoryId?.toString(),
      tags: (note.tags || []).map(t => t.toString()),
    })
  }

  async getAcl(id: string, userId: string): Promise<{ visibility: string; canManage: boolean; acl: any[] }> {
    const note: any = await this.noteModel
      .findOne(this.noteAccess.memberScope(id, userId))
      .populate({ path: 'userId', select: 'email displayName avatarUrl' })
      .populate({ path: 'acl.userId', select: 'email displayName avatarUrl' })
      .lean()
      .exec()
    if (!note) {
      throw new NotFoundException('笔记不存在')
    }

    const toMember = (profile: any, role: string) => ({
      userId: String(profile?._id || profile || ''),
      role,
      displayName: profile?.displayName || undefined,
      email: profile?.email || undefined,
      avatarUrl: profile?.avatarUrl || undefined,
    })
    const owner = toMember(note.userId, 'owner')
    const members = (note.acl || [])
      .map((entry: any) => toMember(entry.userId, entry.role))
      .filter((entry: any) => entry.userId && entry.userId !== owner.userId)
    const canManage = owner.userId === userId
      || members.some((entry: any) => entry.userId === userId && entry.role === 'owner')

    return { visibility: note.visibility, canManage, acl: [owner, ...members] }
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
    try {
      const u = new Types.ObjectId(userId)
      const note = await this.noteModel.findOne(this.noteAccess.writeScope(id, userId)).exec()
      if (!note) throw new NotFoundException('无权限')
        ; (note as any).editingBy = u
        ; (note as any).lockedAt = new Date()
      await note.save()
      return { ok: true }
    } catch (e) {
      // React StrictMode 在开发环境可能重复触发锁请求；并行保存冲突可视为锁已写入。
      if (e.name === 'ParallelSaveError') {
        return { ok: true }
      }
      console.error('lockNote error', e)
      throw e
    }
  }

  async unlockNote(id: string, userId: string) {
    try {
      const u = new Types.ObjectId(userId)
      const note = await this.noteModel.findById(id).exec()
      if (!note) throw new NotFoundException('笔记不存在')
      // 只有创建者或当前加锁者能解锁；ACL editor 不能解除他人的编辑占用。
      const isLocker = (note as any).editingBy && (note as any).editingBy.toString() === u.toString();
      const isOwner = note.userId.toString() === u.toString();

      if (isOwner || isLocker) {
        ; (note as any).editingBy = undefined
          ; (note as any).lockedAt = undefined
        await note.save()
        return { ok: true }
      }
      // 未加锁时解锁保持幂等，调用方无需额外查询锁状态。
      if (!(note as any).editingBy) return { ok: true }

      throw new NotFoundException('无权限')
    } catch (e) {
      // 与加锁一致，把 StrictMode 导致的并行保存视为幂等成功。
      if (e.name === 'ParallelSaveError') {
        return { ok: true }
      }
      console.error('unlockNote error', e)
      throw e
    }
  }

  async getRecommendations(userId: string, currentNoteId?: string, limit: number = 5, context?: NoteFilterDto): Promise<Note[]> {
    if (!this.noteRecommendations) throw new Error('Note recommendation service is not available.')
    return this.noteRecommendations.getRecommendations(userId, currentNoteId, limit, context)
  }

  async generateRoomTicket(noteId: string, userId: string): Promise<{ ticket: string; role: 'writer' | 'reader'; expiresIn: number }> {
    if (!this.jwtService) throw new NotFoundException('JwtService not available')

    const note = await this.noteModel
      .findOne(this.noteAccess.readScope(noteId, userId))
      .select('_id userId acl visibility')
      .lean()
      .exec()
    if (!note) throw new NotFoundException('Note not found')

    const userObjectId = new Types.ObjectId(userId)
    let role: 'writer' | 'reader' = 'reader'
    if (String(note.userId) === String(userObjectId)) {
      role = 'writer'
    } else if (Array.isArray(note.acl)) {
      const aclEntry = note.acl.find((a: any) => String(a.userId) === String(userObjectId))
      if (aclEntry && (aclEntry.role === 'owner' || aclEntry.role === 'editor')) {
        role = 'writer'
      }
    }

    const expiresIn = 300
    const ticket = this.jwtService.sign(
      { noteId, userId, role, type: 'room-ticket' },
      { expiresIn },
    )
    return { ticket, role, expiresIn }
  }
}
