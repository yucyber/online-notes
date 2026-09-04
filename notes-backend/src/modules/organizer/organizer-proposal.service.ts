import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { NoteAccessService } from '../notes/note-access.service'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { NoteChunk, NoteChunkDocument } from '../notes/schemas/note-chunk.schema'
import { Tag, TagDocument } from '../tags/schemas/tag.schema'
import { Category, CategoryDocument } from '../categories/schemas/category.schema'
import { KnowledgeBase, KnowledgeBaseDocument } from '../knowledge-bases/schemas/knowledge-base.schema'
import {
  ORGANIZER_ACTION_TYPES,
  OrganizerActionType,
  OrganizerProposal,
  OrganizerProposalDocument,
  OrganizerRiskLevel,
} from './schemas/organizer-proposal.schema'

export interface OrganizerActionDraft {
  type: OrganizerActionType
  noteIds: string[]
  reason?: string
  riskLevel?: OrganizerRiskLevel
  evidenceChunkIds?: string[]
  categoryId?: string
  categoryName?: string
  tagId?: string
  tagName?: string
  knowledgeBaseId?: string
  knowledgeBaseName?: string
  targetNoteId?: string
  sourceNoteId?: string
  payload?: Record<string, unknown>
}

export interface CreateOrganizerProposalDraft {
  actions: OrganizerActionDraft[]
  summary?: string
  modelRunId?: string
}

const LOW_RISK_ACTIONS = new Set<OrganizerActionType>([
  'create_knowledge_base',
  'move_note',
  'add_tag',
  'set_category',
])

@Injectable()
export class OrganizerProposalService {
  constructor(
    @InjectModel(OrganizerProposal.name) private readonly proposalModel: Model<OrganizerProposalDocument>,
    private readonly noteAccess: NoteAccessService,
    @Optional() @InjectModel(Note.name) private readonly noteModel?: Model<NoteDocument>,
    @Optional() @InjectModel(NoteChunk.name) private readonly noteChunkModel?: Model<NoteChunkDocument>,
    @Optional() @InjectModel(Tag.name) private readonly tagModel?: Model<TagDocument>,
    @Optional() @InjectModel(Category.name) private readonly categoryModel?: Model<CategoryDocument>,
    @Optional() @InjectModel(KnowledgeBase.name) private readonly knowledgeBaseModel?: Model<KnowledgeBaseDocument>,
  ) {}

  async create(userId: string, draft: CreateOrganizerProposalDraft) {
    if (!Array.isArray(draft?.actions) || draft.actions.length === 0) {
      throw new BadRequestException('Proposal actions are required.')
    }
    const userObjectId = this.objectId(userId)
    const normalized = await this.normalizeActions(draft.actions, userId)
    if (normalized.length === 0) {
      throw new BadRequestException('No readable proposal actions remain after permission filtering.')
    }

    const created = await this.proposalModel.create({
      userId: userObjectId,
      status: 'pending',
      revision: 1,
      summary: String(draft.summary || ''),
      modelRunId: draft.modelRunId ? String(draft.modelRunId) : undefined,
      actions: normalized,
    })

    return this.serialize(created)
  }

  async findAll(userId: string) {
    const docs = await this.proposalModel
      .find({ userId: this.objectId(userId) })
      .sort({ createdAt: -1 })
      .exec()
    return docs.map((doc) => this.serialize(doc))
  }

  async findOne(id: string, userId: string) {
    const doc = await this.proposalModel.findOne({
      _id: this.objectId(id, 'proposal id'),
      userId: this.objectId(userId),
    }).exec()
    if (!doc) throw new NotFoundException('Proposal not found')
    return this.serialize(doc)
  }

  async remove(id: string, userId: string) {
    const doc = await this.proposalModel.findOneAndDelete({
      _id: this.objectId(id, 'proposal id'),
      userId: this.objectId(userId),
    }).exec()
    if (!doc) throw new NotFoundException('Proposal not found')
    return { ok: true }
  }

  async refreshStale(id: string, userId: string) {
    const doc = await this.proposalModel.findOne({
      _id: this.objectId(id, 'proposal id'),
      userId: this.objectId(userId),
    }).exec()
    if (!doc) throw new NotFoundException('Proposal not found')
    const value = this.toObject(doc)
    const expected = this.actionExpectations(value.actions || [])
    if (expected.length === 0) return this.serialize(doc)
    const noteIds = expected.map((item: any) => this.idOf(item, 'noteId'))
    const notes = this.noteModel
      ? await this.noteModel.find({ _id: { $in: noteIds } }).select('_id updatedAt').exec()
      : []
    const updatedById = new Map(notes.map((note) => [String(this.idOf(note)), this.toObject(note).updatedAt]))
    let stale = false
    for (const item of expected) {
      const noteId = String(this.idOf(item, 'noteId'))
      const stored = new Date(item.updatedAt).getTime()
      const current = new Date(updatedById.get(noteId) || 0).getTime()
      if (current !== stored) stale = true
    }
    if (stale && doc.status !== 'stale') {
      doc.status = 'stale'
      await doc.save()
    }
    return this.serialize(doc)
  }

  private async normalizeActions(drafts: OrganizerActionDraft[], userId: string) {
    const userObjectId = this.objectId(userId)
    const rawNoteIds = drafts.flatMap((action) => this.validObjectIds(action?.noteIds || []))
    const uniqueNoteIds = [...new Set(rawNoteIds.map(String))]
    const readableNotes = uniqueNoteIds.length > 0 && this.noteModel
      ? await this.noteModel
        .find(this.noteAccess.readableNotesQuery(uniqueNoteIds.map((id) => new Types.ObjectId(id)), userId))
        .select('_id updatedAt')
        .exec()
      : []
    const readableById = new Map(readableNotes.map((note) => [String(this.idOf(note)), this.toObject(note)]))

    const evidenceCandidates = [...new Set(drafts.flatMap((action) => this.validObjectIds(action?.evidenceChunkIds || [])))]
    const validEvidence = evidenceCandidates.length > 0 && this.noteChunkModel && readableById.size > 0
      ? await this.noteChunkModel.find({
          _id: { $in: evidenceCandidates.map((id) => new Types.ObjectId(id)) },
          userId: userObjectId,
          noteId: { $in: [...readableById.keys()].map((id) => new Types.ObjectId(id)) },
        }).select('_id noteId').exec()
      : []
    const evidenceNoteById = new Map(validEvidence.map((chunk) => {
      const chunkValue = this.toObject(chunk)
      return [String(this.idOf(chunk)), String(this.idOf(chunkValue, 'noteId'))]
    }))

    const categoryCandidates = [...new Set(this.validObjectIds(drafts.map((action) => action.categoryId).filter(Boolean)))]
    const validCategoryIds = categoryCandidates.length > 0 && this.categoryModel
      ? (await this.categoryModel.find({ _id: { $in: categoryCandidates }, userId: userObjectId }).select('_id').exec()).map((item) => String(this.idOf(item)))
      : new Set(categoryCandidates)
    const validCategorySet = validCategoryIds instanceof Set ? validCategoryIds : new Set(validCategoryIds)

    const tagCandidates = [...new Set(this.validObjectIds(drafts.map((action) => action.tagId).filter(Boolean)))]
    const validTagIds = tagCandidates.length > 0 && this.tagModel
      ? (await this.tagModel.find({ _id: { $in: tagCandidates }, userId: userObjectId }).select('_id').exec()).map((item) => String(this.idOf(item)))
      : new Set(tagCandidates)
    const validTagSet = validTagIds instanceof Set ? validTagIds : new Set(validTagIds)

    const kbCandidates = [...new Set(this.validObjectIds(drafts.map((action) => action.knowledgeBaseId).filter(Boolean)))]
    const validKbIds = kbCandidates.length > 0 && this.knowledgeBaseModel
      ? (await this.knowledgeBaseModel.find({ _id: { $in: kbCandidates }, userId: userObjectId }).select('_id').exec()).map((item) => String(this.idOf(item)))
      : new Set(kbCandidates)
    const validKbSet = validKbIds instanceof Set ? validKbIds : new Set(validKbIds)

    const result: any[] = []
    for (const [index, draft] of drafts.entries()) {
      const actionType = this.normalizeActionType(draft?.type)
      if (!actionType) continue
      const noteIds = [...new Set(this.validObjectIds(draft?.noteIds || []).map(String))]
        .filter((id) => readableById.has(id))
      if (noteIds.length === 0 && actionType !== 'create_knowledge_base') continue
      const evidenceChunkIds = this.validObjectIds(draft?.evidenceChunkIds || [])
        .filter((id) => evidenceNoteById.has(id) && noteIds.includes(evidenceNoteById.get(id) || ''))
      if (draft?.categoryId && !validCategorySet.has(String(draft.categoryId))) continue
      if (draft?.tagId && !validTagSet.has(String(draft.tagId))) continue
      if (draft?.knowledgeBaseId && !validKbSet.has(String(draft.knowledgeBaseId))) continue
      const expectations = noteIds.map((noteId) => {
        const noteValue = readableById.get(noteId) as any
        return {
          noteId: new Types.ObjectId(noteId),
          updatedAt: new Date(noteValue?.updatedAt || new Date(0)),
        }
      })
      // merge 复用已有目标笔记时同样需要版本基线，否则执行无法发现目标已被用户改过。
      if (actionType === 'merge_notes' && draft?.targetNoteId && !noteIds.includes(String(draft.targetNoteId)) && readableById.has(String(draft.targetNoteId))) {
        const targetValue = readableById.get(String(draft.targetNoteId)) as any
        expectations.push({
          noteId: new Types.ObjectId(String(draft.targetNoteId)),
          updatedAt: new Date(targetValue?.updatedAt || new Date(0)),
        })
      }

      result.push({
        actionId: this.actionId(actionType, index),
        type: actionType,
        noteIds: noteIds.map((id) => new Types.ObjectId(id)),
        riskLevel: draft?.riskLevel === 'high' || draft?.riskLevel === 'low' ? draft.riskLevel : this.defaultRisk(actionType),
        reason: String(draft?.reason || '').trim().slice(0, 500),
        evidenceChunkIds: evidenceChunkIds.map((id) => new Types.ObjectId(id)),
        expectedUpdatedAt: expectations,
        categoryId: draft?.categoryId ? new Types.ObjectId(String(draft.categoryId)) : undefined,
        categoryName: this.cleanText(draft?.categoryName, 80),
        tagId: draft?.tagId ? new Types.ObjectId(String(draft.tagId)) : undefined,
        tagName: this.cleanText(draft?.tagName, 80),
        knowledgeBaseId: draft?.knowledgeBaseId ? new Types.ObjectId(String(draft.knowledgeBaseId)) : undefined,
        knowledgeBaseName: this.cleanText(draft?.knowledgeBaseName, 80),
        targetNoteId: draft?.targetNoteId && readableById.has(String(draft.targetNoteId)) ? new Types.ObjectId(String(draft.targetNoteId)) : undefined,
        sourceNoteId: draft?.sourceNoteId && readableById.has(String(draft.sourceNoteId)) ? new Types.ObjectId(String(draft.sourceNoteId)) : undefined,
        payload: draft?.payload && typeof draft.payload === 'object' ? draft.payload : {},
      })
    }
    return result
  }

  private defaultRisk(type: OrganizerActionType): OrganizerRiskLevel {
    return LOW_RISK_ACTIONS.has(type) ? 'low' : 'high'
  }

  private normalizeActionType(value: unknown): OrganizerActionType | undefined {
    const text = String(value || '')
    return (ORGANIZER_ACTION_TYPES as readonly string[]).includes(text)
      ? text as OrganizerActionType
      : undefined
  }

  private validObjectIds(values: unknown[]) {
    return (Array.isArray(values) ? values : []).map(String).filter((id) => Types.ObjectId.isValid(id))
  }

  private actionExpectations(actions: any[]) {
    return (Array.isArray(actions) ? actions : []).flatMap((action) => Array.isArray(action?.expectedUpdatedAt) ? action.expectedUpdatedAt : [])
  }

  private actionId(type: OrganizerActionType, index: number) {
    return `${type}_${Date.now().toString(36)}_${index}`
  }

  private cleanText(value: unknown, maxLength: number) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
  }

  private serialize(doc: any) {
    const value = this.toObject(doc)
    return {
      id: String(value._id),
      userId: String(value.userId),
      status: value.status || 'pending',
      revision: Number(value.revision || 1),
      summary: value.summary || '',
      modelRunId: value.modelRunId || undefined,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      actions: (Array.isArray(value.actions) ? value.actions : []).map((action: any) => ({
        actionId: String(action.actionId),
        type: action.type,
        riskLevel: action.riskLevel,
        reason: action.reason || '',
        noteIds: (action.noteIds || []).map(String),
        evidenceChunkIds: (action.evidenceChunkIds || []).map(String),
        expectedUpdatedAt: (action.expectedUpdatedAt || []).map((item: any) => ({
          noteId: String(item.noteId),
          updatedAt: item.updatedAt,
        })),
        categoryId: action.categoryId ? String(action.categoryId) : undefined,
        categoryName: action.categoryName || undefined,
        tagId: action.tagId ? String(action.tagId) : undefined,
        tagName: action.tagName || undefined,
        knowledgeBaseId: action.knowledgeBaseId ? String(action.knowledgeBaseId) : undefined,
        knowledgeBaseName: action.knowledgeBaseName || undefined,
        targetNoteId: action.targetNoteId ? String(action.targetNoteId) : undefined,
        sourceNoteId: action.sourceNoteId ? String(action.sourceNoteId) : undefined,
        payload: action.payload || {},
      })),
    }
  }

  private toObject(doc: any) {
    return typeof doc?.toObject === 'function' ? doc.toObject() : doc
  }

  private idOf(doc: any, field = '_id'): Types.ObjectId {
    const value = this.toObject(doc)?.[field]
    return value instanceof Types.ObjectId ? value : new Types.ObjectId(String(value))
  }

  private objectId(id: string, label = 'user id') {
    return this.noteAccess.objectId(id, label)
  }
}
