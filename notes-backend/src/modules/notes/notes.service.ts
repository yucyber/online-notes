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
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { Mindmap } from '../mindmaps/schemas/mindmap.schema';
import { NoteChunk } from './schemas/note-chunk.schema';
import { parseFragment } from 'parse5';
import { marked } from 'marked';

const HTML_ELEMENT_PATTERN = /<(?:!--[\s\S]*?--|\/?(?:html|head|body|p|div|span|h[1-6]|ul|ol|li|blockquote|pre|code|table|thead|tbody|tfoot|tr|th|td|a|img|br|hr|strong|em|b|i|s|u|resource-embed)(?:\s[^<>]*|\s*\/?)>)/i
const MARKDOWN_BLOCK_PATTERN = /^\s{0,3}(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+|>\s?|```|~~~)/m
const MARKDOWN_LINK_PATTERN = /!?\[[^\]\n]+\]\([^\n)]+\)/
const MARKDOWN_EMPHASIS_PATTERN = /(?:\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~)/
const MARKDOWN_TABLE_PATTERN = /^\s*\|?.+\|.+\r?\n\s*\|?\s*:?-{3,}:?\s*\|/m

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
    private readonly audit: AuditService,
    private readonly users: UsersService,
    @Optional() private readonly noteRecommendations?: NoteRecommendationService,
    @Optional() noteDerived?: NoteDerivedService,
    @Optional() private readonly jwtService?: JwtService,
    @Optional() @InjectModel(Mindmap.name) private readonly mindmapModel?: Model<Mindmap>,
    @Optional() @InjectModel(NoteChunk.name) private readonly noteChunkModel?: Model<NoteChunk>,
  ) {
    this.noteDerived = noteDerived || new NoteDerivedService(noteModel, embeddingService, aiService, noteCache)
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
      summarySource: 'fallback',
      userId: new Types.ObjectId(userId),
      tags: createNoteDto.tags ? createNoteDto.tags.map(tag => new Types.ObjectId(tag)) : [],
      categoryId: createNoteDto.categoryId ? new Types.ObjectId(createNoteDto.categoryId) : undefined,
    });

    const savedNote = await createdNote.save();
    await this.noteCache.invalidateLists()

    // 记录创建笔记的生命周期事件，供活动日志"内容"栏展示。
    await this.audit.record('note_created', userId, 'note', savedNote._id.toString(), { after: { title: savedNote.title } })

    await this.noteCounter.incrementForCreate({
      categoryId: createNoteDto.categoryId,
      tags: createNoteDto.tags,
    })

    // 自动保存和派生计算解耦；创建后也进入同一静默期，避免紧接着的编辑重复调用 AI。
    this.noteDerived.schedule(savedNote, {
      titleChanged: true,
      contentChanged: true,
      taxonomyChanged: true,
    })

    return this.serializeNote(savedNote);
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
    const { keyword, categoryId, tagIds, startDate, endDate, status, tagsMode, searchMode, ids } = filterDto;
    const page = Math.max(1, Number(filterDto.page || 1))
    const size = Math.max(1, Math.min(100, Number(filterDto.size || 20)))

    // 列表固定按 updatedAt 降序页码分页；排序字段与游标已废弃。
    const keyPayload = { userId, keyword, categoryId, tagIds, startDate, endDate, status, tagsMode, searchMode, page, size, ids, previewFieldsVersion: 'content-taxonomy-v2' }
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
      // 列表固定按 updatedAt 排序，日期范围跟随 updatedAt 过滤。
      andConditions.push({ updatedAt: dateQuery });
    }

    if (status) {
      andConditions.push({ status });
    }

    const query = andConditions.length > 0 ? { $and: andConditions } : {};

    const [items, total] = await Promise.all([
      this.noteModel
        .find(query)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * size)
        .limit(size)
        .maxTimeMS(300)
        .select('title summary content categoryId tags userId status createdAt updatedAt')
        .lean()
        .exec(),
      this.noteModel.countDocuments(query),
    ])
    // 统一对外输出 id 与 string 引用：id 由 _id 派生，categoryId/tags 均输出字符串
    const normalized = items.map((it: any) => {
      const { _id, ...rest } = it
      return {
        ...rest,
        id: String(_id),
        categoryId: it.categoryId ? String(it.categoryId) : undefined,
        tags: (it.tags || []).map((t: any) => String(t)),
      }
    })
    const enriched = await this.enrichTaxonomyRefs(normalized)
    const resp: any = { items: enriched, page, size, total }
    await this.noteCache.setList(userId, keyPayload, resp, listRevision)
    return resp
  }

  async findOne(id: string, userId: string): Promise<Note> {
    const note = await this.noteModel
      .findOne(this.noteAccess.readScope(id, userId))
      .exec();

    if (!note) {
      throw new NotFoundException('笔记不存在');
    }

    // 统一输出 string 引用：categoryId/tags 由 ObjectId 派生为字符串 id
    const [enriched] = await this.enrichTaxonomyRefs([this.serializeNote(note)])
    return enriched;
  }

  async getChunkLocation(noteId: string, chunkId: string, userId: string): Promise<{
    chunkId: string
    headingPath: string[]
    anchorText: string
  }> {
    if (!Types.ObjectId.isValid(noteId) || !Types.ObjectId.isValid(chunkId)) {
      throw new NotFoundException('证据位置不存在')
    }
    // 先收窄到 NoteAccess，再查询 route Note 下的 Chunk，避免跨 Note 枚举暴露正文存在性。
    const readableNote = await this.noteModel
      .findOne(this.noteAccess.readScope(noteId, userId))
      .select('_id')
      .lean()
      .exec()
    if (!readableNote) throw new NotFoundException('笔记不存在')

    if (!this.noteChunkModel) throw new NotFoundException('证据位置不存在')
    const chunk = await this.noteChunkModel
      .findOne({
        _id: this.noteAccess.objectId(chunkId, 'chunk id'),
        noteId: this.noteAccess.objectId(noteId, 'note id'),
      })
      .select('_id headingPath content')
      .lean()
      .exec()
    if (!chunk) throw new NotFoundException('证据位置不存在')

    const anchorText = this.chunkAnchorText(chunk.content).slice(0, 160)
    return {
      chunkId: String(chunk._id),
      headingPath: Array.isArray(chunk.headingPath) ? chunk.headingPath.map(String) : [],
      anchorText,
    }
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
    const titleChanged = updatePayload.title !== undefined
      && String(updatePayload.title) !== String(originalNote.title || '')
    const contentChanged = updatePayload.content !== undefined
      && String(updatePayload.content) !== String(originalNote.content || '')
    const categoryChanged = updatePayload.categoryId !== undefined
      && String(updatePayload.categoryId || '') !== String(originalNote.categoryId || '')
    const originalTags = (originalNote.tags || []).map((tag) => String(tag)).sort()
    const nextTags = Array.isArray(updatePayload.tags)
      ? [...new Set(updatePayload.tags.map((tag: any) => String(tag)))].sort()
      : originalTags
    const tagsChanged = updatePayload.tags !== undefined
      && (originalTags.length !== nextTags.length || originalTags.some((tag, index) => tag !== nextTags[index]))
    const taxonomyChanged = categoryChanged || tagsChanged

    // 即使正文被显式清空也要同步刷新兜底摘要，不能遗留旧内容摘要。
    if (contentChanged) {
      updatePayload.summary = this.noteDerived.buildFallbackSummary(updatePayload.content)
      updatePayload.summarySource = 'fallback'
      updatePayload.summaryUpdatedAt = null
    }

    const updatedNote = await this.noteModel
      .findOneAndUpdate(
        noteScope,
        updatePayload,
        { new: true, runValidators: true },
      )
      .exec();

    if (!updatedNote) {
      throw new NotFoundException('笔记不存在');
    }

    // 派生字段异步刷新，不延长保存请求；服务内部会防止旧任务覆盖更新后的正文。
    await this.noteCache.invalidateLists()

    if (titleChanged || contentChanged || taxonomyChanged) {
      this.noteDerived.schedule(updatedNote, { titleChanged, contentChanged, taxonomyChanged })
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

    return this.serializeNote(updatedNote);
  }

  async remove(id: string, userId: string): Promise<void> {
    // 删除会影响整篇笔记及领域计数，因此只接受 owner 范围。
    const session = await this.noteModel.db.startSession()
    let note: NoteDocument | null = null
    try {
      await session.withTransaction(async () => {
        note = await this.noteModel
          .findOne(this.noteAccess.ownerScope(id, userId))
          .session(session)
          .exec()
        if (!note) throw new NotFoundException('笔记不存在')

        await this.mindmapModel
          ?.deleteMany({ noteId: note._id })
          .session(session)
          .exec()

        await this.noteChunkModel
          ?.deleteMany({ noteId: note._id })
          .session(session)
          .exec()

        const result = await this.noteModel
          .deleteOne(this.noteAccess.ownerScope(id, userId))
          .session(session)
          .exec()
        if (result.deletedCount === 0) throw new NotFoundException('笔记不存在')
      })
    } finally {
      await session.endSession()
    }

    await this.noteCache.invalidateLists()

    // 记录删除笔记的生命周期事件，供活动日志"内容"栏展示。
    await this.audit.record('note_deleted', userId, 'note', note!._id.toString(), { after: { title: note!.title } })

    await this.noteCounter.decrementForDelete({
      categoryId: note!.categoryId?.toString(),
      tags: (note!.tags || []).map(t => t.toString()),
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
    // owner 仅由 note.userId 派生，ACL 只存 editor/viewer；管理权只归创建者。
    const canManage = owner.userId === userId

    return { visibility: note.visibility, canManage, acl: [owner, ...members] }
  }

  // 统一 ACL 写路径：赋值 + 落库 + 失效列表缓存。所有协作者变更都必须经此封装，避免遗漏缓存失效。
  private async persistAcl(note: any, acl: any[]) {
    ;(note as any).acl = acl
    await note.save()
    await this.noteCache.invalidateLists()
  }

  // 反查协作者身份用于审计展示；用户不存在时静默降级为 undefined。
  private async resolveCollaboratorIdentity(targetUserId: string) {
    try {
      const u = await this.users.findById(targetUserId)
      return { email: u.email, displayName: u.displayName }
    } catch {
      return { email: undefined, displayName: undefined }
    }
  }

  async updateCollaboratorRole(id: string, actorId: string, targetUserId: string, role: 'editor' | 'viewer') {
    const actor = new Types.ObjectId(actorId)
    const target = new Types.ObjectId(targetUserId)
    const note = await this.noteModel.findById(id).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    if (!note.userId.equals(actor)) throw new NotFoundException('无权限')
    const acl = ((note as any).acl || []) as any[]
    const entry = acl.find((a: any) => a.userId?.equals(target))
    if (!entry) throw new NotFoundException('协作者不存在')
    entry.role = role
    await this.persistAcl(note, acl)
    const identity = await this.resolveCollaboratorIdentity(targetUserId)
    await this.audit.record('collaborator_role_changed', actorId, 'acl', note._id.toString(), { after: { userId: targetUserId, role, ...(identity.email ? { email: identity.email } : {}), ...(identity.displayName ? { displayName: identity.displayName } : {}) } })
    return { ok: true }
  }

  async removeCollaborator(id: string, actorId: string, targetUserId: string) {
    const actor = new Types.ObjectId(actorId)
    const target = new Types.ObjectId(targetUserId)
    const note = await this.noteModel.findById(id).exec()
    if (!note) throw new NotFoundException('笔记不存在')
    if (!note.userId.equals(actor)) throw new NotFoundException('无权限')
    const acl = ((note as any).acl || []) as any[]
    const removed = acl.find((a: any) => a.userId?.equals(target))
    if (!removed) throw new NotFoundException('协作者不存在')
    const next = acl.filter((a: any) => !a.userId?.equals(target))
    await this.persistAcl(note, next)
    const identity = await this.resolveCollaboratorIdentity(targetUserId)
    await this.audit.record('collaborator_removed', actorId, 'acl', note._id.toString(), { after: { userId: targetUserId, role: removed.role, ...(identity.email ? { email: identity.email } : {}), ...(identity.displayName ? { displayName: identity.displayName } : {}) } })
    return { ok: true }
  }


  async getRecommendations(userId: string, currentNoteId?: string, limit: number = 5, context?: NoteFilterDto): Promise<Note[]> {
    if (!this.noteRecommendations) throw new Error('Note recommendation service is not available.')
    return this.noteRecommendations.getRecommendations(userId, currentNoteId, limit, context)
  }

  /** 统一单笔记输出的 id 与 string 引用：id 由 _id 派生，categoryId/tags 输出为字符串 id */
  private serializeNote(note: any): Note {
    const obj = note.toObject ? note.toObject() : note
    const { _id, ...rest } = obj
    return {
      ...rest,
      id: String(_id),
      categoryId: obj.categoryId ? String(obj.categoryId) : undefined,
      tags: (obj.tags || []).map((t: any) => String(t)),
    }
  }

  private async enrichTaxonomyRefs(notes: any[]): Promise<any[]> {
    const categoryIds = Array.from(new Set(notes.map((note) => note.categoryId).filter(Boolean))) as string[]
    const tagIds = Array.from(new Set(notes.flatMap((note) => note.tags || []).map((tag) => String(tag)).filter(Boolean)))

    // 只有先通过 note ACL 的引用才会进入查询；这里不按当前用户过滤，否则协作者无法解析所有者的名称。
    const [categories, tags] = await Promise.all([
      this.categoriesService.findRefsByIds(categoryIds),
      this.tagsService.findRefsByIds(tagIds),
    ])
    const categoryMap = new Map(categories.map((category) => [category.id, category]))
    const tagMap = new Map(tags.map((tag) => [tag.id, tag]))

    return notes.map((note) => ({
      ...note,
      category: note.categoryId ? categoryMap.get(note.categoryId) || null : null,
      tags: (note.tags || []).map((tag: string) => tagMap.get(String(tag)) || String(tag)),
    }))
  }

  private chunkAnchorText(value: unknown) {
    const original = String(value || '')
    const isMarkdown = MARKDOWN_BLOCK_PATTERN.test(original)
      || MARKDOWN_LINK_PATTERN.test(original)
      || MARKDOWN_EMPHASIS_PATTERN.test(original)
      || MARKDOWN_TABLE_PATTERN.test(original)
    let html = original
    if (isMarkdown) {
      try {
        const converted = marked.parse(original, { async: false })
        html = typeof converted === 'string' ? converted : this.plainChunkHtml(original)
      } catch {
        html = this.plainChunkHtml(original)
      }
    } else if (!HTML_ELEMENT_PATTERN.test(original)) {
      html = this.plainChunkHtml(original)
    }

    const fragment: any = parseFragment(html)
    const blockTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre', 'blockquote', 'li', 'table', 'td', 'th', 'div'])
    const textOf = (node: any): string => {
      const tag = String(node.tagName || '').toLowerCase()
      if (tag === 'script' || tag === 'style') return ''
      if (node.nodeName === '#text') return String(node.value || '')
      const text = (node.childNodes || []).map(textOf).join('')
      return blockTags.has(tag) ? `${text} ` : text
    }
    // parse5 与浏览器 DOM 一样解码 entity，且 <br> 本身不产生 text node。
    return textOf(fragment).replace(/\s+/g, ' ').trim()
  }

  private plainChunkHtml(value: string) {
    const escaped = value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<p>${escaped.replace(/\r?\n/g, '<br>')}</p>`
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
      if (aclEntry && aclEntry.role === 'editor') {
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
