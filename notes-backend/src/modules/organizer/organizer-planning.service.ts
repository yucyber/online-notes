import { Injectable, NotFoundException, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { ConfigService } from '@nestjs/config'
import { KnowledgeBase, KnowledgeBaseDocument } from '../knowledge-bases/schemas/knowledge-base.schema'
import { KnowledgeBaseNote, KnowledgeBaseNoteDocument } from '../knowledge-bases/schemas/knowledge-base-note.schema'
import { Category, CategoryDocument } from '../categories/schemas/category.schema'
import { Tag, TagDocument } from '../tags/schemas/tag.schema'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { NoteAccessService } from '../notes/note-access.service'
import { OrganizerProposalService } from './organizer-proposal.service'
import { OrganizerActionDraft } from './organizer-proposal.service'

type NoteForPlanning = {
  _id: Types.ObjectId
  title: string
  summary?: string
  categoryId?: Types.ObjectId | string
  tags?: Array<Types.ObjectId | string>
  updatedAt?: Date
}

@Injectable()
export class OrganizerPlanningService {
  private readonly defaultGlobalMinNotes = 5

  constructor(
    private readonly proposalService: OrganizerProposalService,
    private readonly noteAccess: NoteAccessService,
    @Optional() @InjectModel(Note.name) private readonly noteModel?: Model<NoteDocument>,
    @Optional() @InjectModel(KnowledgeBase.name) private readonly kbModel?: Model<KnowledgeBaseDocument>,
    @Optional() @InjectModel(KnowledgeBaseNote.name) private readonly kbNoteModel?: Model<KnowledgeBaseNoteDocument>,
    @Optional() @InjectModel(Category.name) private readonly categoryModel?: Model<CategoryDocument>,
    @Optional() @InjectModel(Tag.name) private readonly tagModel?: Model<TagDocument>,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async createGlobalProposal(userId: string) {
    if (!this.noteModel) return { generated: false, reason: 'note_model_unavailable', noteCount: 0 }
    const threshold = this.globalMinNotes()
    const notes = await this.noteModel
      .find(this.noteAccess.readableFilter(userId))
      .select('_id title summary categoryId tags updatedAt')
      .limit(500)
      .lean()
      .exec()
    const noteCount = (notes || []).length
    if (noteCount < threshold) {
      return { generated: false, reason: 'below_threshold', threshold, noteCount }
    }

    const actions = await this.buildGlobalActions(userId, notes as unknown as NoteForPlanning[])
    if (actions.length === 0) {
      return { generated: false, reason: 'no_suggestion', threshold, noteCount }
    }

    const proposal = await this.proposalService.create(userId, {
      summary: `根据 ${noteCount} 篇笔记生成的全局整理提案`,
      actions,
    })
    return { generated: true, proposal, noteCount }
  }

  async createIncrementalProposal(userId: string, noteId: string) {
    if (!this.noteModel) throw new Error('note_model_unavailable')
    const note = await this.noteModel
      .findOne(this.noteAccess.readScope(noteId, userId))
      .select('_id title summary categoryId tags updatedAt')
      .lean()
      .exec()
    if (!note) throw new NotFoundException('Note not found or not readable')

    const noteValue = note as unknown as NoteForPlanning
    const userObjectId = this.noteAccess.objectId(userId, 'user id')
    const linkedKbIds = this.kbNoteModel
      ? await this.kbNoteModel.distinct('knowledgeBaseId', { userId: userObjectId, noteId: noteValue._id }).exec()
      : []
    if (Array.isArray(linkedKbIds) && linkedKbIds.length > 0) {
      return { generated: false, reason: 'already_organized', noteId }
    }

    const maps = await this.loadTaxonomyMaps(userId, [noteValue])
    const existingKbs = this.kbModel
      ? await this.kbModel.find({ userId: userObjectId }).select('_id name').lean().exec()
      : []
    const kbNames = (existingKbs || []).map((kb: any) => String(kb.name || '').trim())
    const topic = this.noteTopicName(noteValue, maps)
    const matched = topic && kbNames.find((name) => this.namesEqual(name, topic))

    const actions: OrganizerActionDraft[] = matched && this.kbModel
      ? [{
          type: 'move_note',
          noteIds: [String(noteValue._id)],
          knowledgeBaseId: String((existingKbs as any[]).find((kb: any) => this.namesEqual(String(kb.name || ''), topic))?._id),
          reason: `新笔记主题“${topic}”已存在同名知识库`,
        }]
      : [{
          type: 'create_knowledge_base',
          noteIds: [String(noteValue._id)],
          knowledgeBaseName: topic || this.safeTitle(String(noteValue.title || '')),
          reason: topic ? `新笔记主题“${topic}”尚无对应知识库` : '新笔记尚无归属知识库',
        }]

    const proposal = await this.proposalService.create(userId, {
      summary: `增量整理建议：${String(noteValue.title || 'Untitled')}`,
      actions,
    })
    return { generated: true, proposal, noteId }
  }

  private async buildGlobalActions(userId: string, notes: NoteForPlanning[]): Promise<OrganizerActionDraft[]> {
    if (!this.noteModel || !this.kbModel || !this.kbNoteModel || notes.length === 0) return []
    const userObjectId = this.noteAccess.objectId(userId, 'user id')
    const existingKbs = await this.kbModel.find({ userId: userObjectId }).select('_id name').lean().exec() as Array<{ _id: Types.ObjectId; name: string }>
    const linkedNoteIds = await this.kbNoteModel.distinct('noteId', { userId: userObjectId }).exec() as Types.ObjectId[]
    const linkedSet = new Set(linkedNoteIds.map(String))
    const unlinked = notes.filter((note) => !linkedSet.has(String(note._id)))
    const maps = await this.loadTaxonomyMaps(userId, unlinked)
    const topics = new Map<string, string[]>()
    for (const note of unlinked) {
      const topic = this.noteTopicName(note, maps)
      const key = topic || this.safeTitle(String(note.title || ''))
      if (!key) continue
      topics.set(key, [...(topics.get(key) || []), String(note._id)])
    }

    const actions: OrganizerActionDraft[] = []
    for (const [topic, noteIds] of [...topics.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const existing = existingKbs.find((kb) => this.namesEqual(String(kb.name || ''), topic))
      if (existing) {
        actions.push({ type: 'move_note', noteIds, knowledgeBaseId: String(existing._id), knowledgeBaseName: String(existing.name), reason: `将 ${noteIds.length} 篇笔记归入已有知识库“${existing.name}”` })
      } else {
        actions.push({ type: 'create_knowledge_base', noteIds, knowledgeBaseName: topic, reason: `为 ${noteIds.length} 篇笔记创建知识库“${topic}”` })
      }
    }
    return actions
  }

  private async loadTaxonomyMaps(userId: string, notes: NoteForPlanning[]) {
    const categoryIds = [...new Set(notes.map((note) => note.categoryId).filter(Boolean).map(String))]
    const tagIds = [...new Set(notes.flatMap((note) => Array.isArray(note.tags) ? note.tags : []).filter(Boolean).map(String))]
    const [categories, tags] = await Promise.all([
      categoryIds.length > 0 && this.categoryModel
        ? this.categoryModel.find({ _id: { $in: categoryIds.map((id) => new Types.ObjectId(id)) }, userId: this.noteAccess.objectId(userId, 'user id') }).select('_id name').lean().exec()
        : Promise.resolve([]),
      tagIds.length > 0 && this.tagModel
        ? this.tagModel.find({ _id: { $in: tagIds.map((id) => new Types.ObjectId(id)) }, userId: this.noteAccess.objectId(userId, 'user id') }).select('_id name').lean().exec()
        : Promise.resolve([]),
    ])
    return {
      categoryNameById: new Map((categories || []).map((item: any) => [String(item._id), String(item.name || '')])),
      tagNameById: new Map((tags || []).map((item: any) => [String(item._id), String(item.name || '')])),
    }
  }

  private noteTopicName(note: NoteForPlanning, maps: { categoryNameById: Map<string, string>; tagNameById: Map<string, string> }): string {
    if (note.categoryId) return maps.categoryNameById.get(String(note.categoryId)) || ''
    const tag = Array.isArray(note.tags) ? note.tags[0] : undefined
    if (tag) return maps.tagNameById.get(String(tag)) || ''
    return ''
  }

  private safeTitle(value: string) {
    const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40)
    return text || '未分类笔记'
  }

  private namesEqual(left: string, right: string) {
    return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase()
  }

  private globalMinNotes() {
    const value = Number(this.config?.get<string>('ORGANIZER_GLOBAL_MIN_NOTES') || this.defaultGlobalMinNotes)
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : this.defaultGlobalMinNotes
  }
}
