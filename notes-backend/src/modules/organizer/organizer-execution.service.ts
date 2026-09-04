import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { NoteAccessService } from '../notes/note-access.service'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { NoteVersion, NoteVersionDocument } from '../versions/schemas/note-version.schema'
import { Tag, TagDocument } from '../tags/schemas/tag.schema'
import { Category, CategoryDocument } from '../categories/schemas/category.schema'
import { KnowledgeBase, KnowledgeBaseDocument } from '../knowledge-bases/schemas/knowledge-base.schema'
import { KnowledgeBaseNote, KnowledgeBaseNoteDocument } from '../knowledge-bases/schemas/knowledge-base-note.schema'
import { AuditService } from '../audit/audit.service'
import { OrganizerProposal, OrganizerProposalDocument } from './schemas/organizer-proposal.schema'
import { OrganizerExecution, OrganizerExecutionDocument } from './schemas/organizer-execution.schema'

const UNDO_DAYS = 30
const ARCHIVED_AT_FIELD = 'archivedAt'

interface JournalAction {
  actionId: string
  type: string
  noteIds: string[]
  result: Record<string, unknown>
  inverse: Record<string, unknown>
}

interface ExecutableAction {
  actionId: string
  type: string
  noteIds: Types.ObjectId[]
  reason?: string
  riskLevel?: string
  evidenceChunkIds?: Types.ObjectId[]
  categoryId?: Types.ObjectId
  categoryName?: string
  tagId?: Types.ObjectId
  tagName?: string
  knowledgeBaseId?: Types.ObjectId
  knowledgeBaseName?: string
  targetNoteId?: Types.ObjectId
  sourceNoteId?: Types.ObjectId
  expectedUpdatedAt?: Array<{ noteId: Types.ObjectId | string; updatedAt: Date | string }>
  payload?: Record<string, unknown>
}

@Injectable()
export class OrganizerExecutionService {
  constructor(
    @InjectModel(OrganizerExecution.name) private readonly executionModel: Model<OrganizerExecutionDocument>,
    @InjectModel(OrganizerProposal.name) private readonly proposalModel: Model<OrganizerProposalDocument>,
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    @InjectModel(NoteVersion.name) private readonly noteVersionModel: Model<NoteVersionDocument>,
    @InjectModel(Tag.name) private readonly tagModel: Model<TagDocument>,
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(KnowledgeBase.name) private readonly kbModel: Model<KnowledgeBaseDocument>,
    @InjectModel(KnowledgeBaseNote.name) private readonly kbNoteModel: Model<KnowledgeBaseNoteDocument>,
    private readonly noteAccess: NoteAccessService,
    private readonly audit: AuditService,
    @Optional() private readonly config?: any,
  ) {}

  async execute(userId: string, proposalId: string, actionIds: string[], requestId?: string) {
    const userObjectId = this.noteAccess.objectId(userId, 'user id')
    const proposalObjectId = this.noteAccess.objectId(proposalId, 'proposal id')
    const proposal = await this.proposalModel.findOne({ _id: proposalObjectId, userId: userObjectId }).exec()
    if (!proposal) throw new NotFoundException('Proposal not found')
    if (proposal.status === 'stale') throw new BadRequestException('Proposal is stale, please refresh before executing')

    const selected = new Set(actionIds || [])
    const actions = (proposal.actions || []).filter((action) => selected.has(String(action.actionId)))
    if (actions.length === 0) throw new BadRequestException('No selected actions to execute')

    if (requestId) {
      const existing = await this.executionModel.findOne({ userId: userObjectId, idempotencyKey: requestId }).exec()
      if (existing) return this.serialize(existing)
    }

    return this.withTransaction(async (session) => {
      await this.assertNoStaleNotes(actions, session)
      const journal: JournalAction[] = []
      const deadline = new Date(Date.now() + UNDO_DAYS * 24 * 60 * 60 * 1000)
      for (const action of actions) {
        const value = this.toPlain(action)
        journal.push(await this.applyAction(userId, value as ExecutableAction, session))
      }

      const execution = await this.executionModel.create([{
        userId: userObjectId,
        proposalId: proposalObjectId,
        proposalRevision: proposal.revision,
        status: 'executed',
        idempotencyKey: requestId || undefined,
        undoDeadline: deadline,
        actions: journal,
      }], { session }).then((rows) => rows[0])

      proposal.status = 'confirmed'
      await proposal.save({ session })
      await this.audit.record('organizer_executed', userId, 'note', String(proposalObjectId), {
        requestId,
        after: { proposalId, actionCount: actions.length },
      })
      return this.serialize(execution)
    })
  }

  async undo(userId: string, executionId: string, requestId?: string) {
    const userObjectId = this.noteAccess.objectId(userId, 'user id')
    const executionObjectId = this.noteAccess.objectId(executionId, 'execution id')
    const execution = await this.executionModel.findOne({ _id: executionObjectId, userId: userObjectId }).exec()
    if (!execution) throw new NotFoundException('Execution not found')
    if (execution.status === 'undone') {
      return { ok: true, execution: this.serialize(execution) }
    }
    if (new Date(execution.undoDeadline) < new Date()) {
      throw new BadRequestException('Undo deadline has passed')
    }

    return this.withTransaction(async (session) => {
      const conflicts = await this.findUndoConflicts(execution, userId, session)
      if (conflicts.length > 0) {
        return { ok: false, conflicts }
      }

      const actions = (execution.actions || []).slice().reverse()
      for (const entry of actions) {
        await this.applyInverse(userId, this.toPlain(entry), session)
      }
      execution.status = 'undone'
      execution.undoneAt = new Date()
      await execution.save({ session })
      await this.audit.record('organizer_undone', userId, 'note', String(executionObjectId), { requestId })
      return { ok: true, execution: this.serialize(execution) }
    })
  }

  async list(userId: string) {
    const docs = await this.executionModel.find({ userId: this.noteAccess.objectId(userId, 'user id') }).sort({ createdAt: -1 }).exec()
    return docs.map((doc) => this.serialize(doc))
  }

  private async applyAction(userId: string, action: ExecutableAction, session: any): Promise<JournalAction> {
    let journal: JournalAction
    switch (action.type) {
      case 'create_knowledge_base':
        journal = await this.applyCreateKnowledgeBase(userId, action, session)
        break
      case 'move_note':
        journal = await this.applyMoveNote(userId, action, session)
        break
      case 'add_tag':
        journal = await this.applyAddTag(userId, action, session)
        break
      case 'set_category':
        journal = await this.applySetCategory(userId, action, session)
        break
      case 'rewrite_note':
        journal = await this.applyRewriteNote(userId, action, session)
        break
      case 'split_note':
        journal = await this.applySplitNote(userId, action, session)
        break
      case 'merge_notes':
        journal = await this.applyMergeNotes(userId, action, session)
        break
      default:
        throw new BadRequestException(`Unsupported organizer action type: ${String(action.type)}`)
    }
    const afterUpdatedAts = await this.captureAfterUpdatedAts(journal, session)
    journal.result = { ...journal.result, afterUpdatedAts }
    return journal
  }

  private async assertNoStaleNotes(actions: any[], session: any) {
    const expectedByNote = new Map<string, Date>()
    for (const raw of actions) {
      const action = this.toPlain(raw)
      const entries = Array.isArray(action?.expectedUpdatedAt) ? action.expectedUpdatedAt : []
      for (const entry of entries) {
        if (!entry?.noteId) continue
        const noteId = String(entry.noteId)
        const expected = new Date(String(entry.updatedAt))
        if (!Number.isNaN(expected.getTime())) expectedByNote.set(noteId, expected)
      }
    }
    for (const [noteId, expected] of expectedByNote.entries()) {
      const note = await this.noteModel.findById(new Types.ObjectId(noteId)).session(session).select('updatedAt').lean().exec()
      if (!note) throw new BadRequestException(`Note not found for execution: ${noteId}`)
      if (new Date((note as any).updatedAt).getTime() !== expected.getTime()) {
        throw new BadRequestException('Note was updated after proposal generation, please refresh before executing')
      }
    }
  }

  private async captureAfterUpdatedAts(journal: JournalAction, session: any) {
    const ids = new Set<string>(journal.noteIds || [])
    const result = journal.result || {}
    if (result.sourceNoteId) ids.add(String(result.sourceNoteId))
    if (result.targetNoteId) ids.add(String(result.targetNoteId))
    if (Array.isArray(result.createdNoteIds)) {
      for (const id of result.createdNoteIds) ids.add(String(id))
    }
    const output: Record<string, string> = {}
    for (const id of ids) {
      const note = await this.noteModel.findById(new Types.ObjectId(id)).session(session).select('updatedAt').lean().exec()
      if (note) output[id] = String((note as any).updatedAt)
    }
    return output
  }

  private async applyCreateKnowledgeBase(userId: string, action: ExecutableAction, session: any): Promise<JournalAction> {
    const userObjectId = this.noteAccess.objectId(userId, 'user id')
    const name = String(action.knowledgeBaseName || '').trim()
    if (!name) throw new BadRequestException('Knowledge base name is required')
    let kb = await this.kbModel.findOne({ userId: userObjectId, name }).session(session).exec()
    let createdKb = false
    if (!kb) {
      kb = await this.kbModel.create([{ userId: userObjectId, name, description: '' }], { session }).then((rows) => rows[0])
      createdKb = true
    }
    const noteIds = (action.noteIds || []).filter((id) => id)
    const addedNoteIds: string[] = []
    for (const noteId of noteIds) {
      const exists = await this.kbNoteModel.exists({ knowledgeBaseId: kb._id, noteId, userId: userObjectId }).session(session)
      if (!exists) {
        await this.kbNoteModel.create([{ knowledgeBaseId: kb._id, noteId, userId: userObjectId }], { session })
        addedNoteIds.push(String(noteId))
      }
    }
    return {
      actionId: action.actionId,
      type: action.type,
      noteIds: noteIds.map(String),
      result: { knowledgeBaseId: String(kb._id), createdKb, addedNoteIds },
      inverse: { knowledgeBaseId: String(kb._id), createdKb, noteIds: addedNoteIds },
    }
  }

  private async applyMoveNote(userId: string, action: ExecutableAction, session: any): Promise<JournalAction> {
    const userObjectId = this.noteAccess.objectId(userId, 'user id')
    const targetKbId = this.noteAccess.objectId(String(action.knowledgeBaseId || ''), 'knowledge base id')
    const targetKb = await this.kbModel.findOne({ _id: targetKbId, userId: userObjectId }).session(session).exec()
    if (!targetKb) throw new NotFoundException('Knowledge base not found')
    const previousByNote = new Map<string, string[]>()
    const addedLinks: Array<{ knowledgeBaseId: string; noteId: string }> = []
    for (const noteId of (action.noteIds || [])) {
      await this.requireWritableNote(noteId, userId, session)
      const previousLinks = await this.kbNoteModel.find({ userId: userObjectId, noteId }).session(session).exec()
      const previousKbIds = previousLinks.map((link) => String(link.knowledgeBaseId))
      previousByNote.set(String(noteId), previousKbIds)
      const exists = previousKbIds.some((kbId) => kbId === String(targetKbId))
      if (!exists) {
        await this.kbNoteModel.create([{ knowledgeBaseId: targetKbId, noteId, userId: userObjectId }], { session })
        addedLinks.push({ knowledgeBaseId: String(targetKbId), noteId: String(noteId) })
      }
      for (const link of previousLinks) {
        if (String(link.knowledgeBaseId) !== String(targetKbId)) {
          await this.kbNoteModel.deleteOne({ _id: link._id }).session(session).exec()
        }
      }
    }
    return {
      actionId: action.actionId,
      type: action.type,
      noteIds: (action.noteIds || []).map(String),
      result: { knowledgeBaseId: String(targetKbId), addedLinks },
      inverse: {
        knowledgeBaseId: String(targetKbId),
        previousByNote: Object.fromEntries(previousByNote),
        addedLinks,
      },
    }
  }

  private async applyAddTag(userId: string, action: ExecutableAction, session: any): Promise<JournalAction> {
    const userObjectId = this.noteAccess.objectId(userId, 'user id')
    let tag: TagDocument | null = null
    if (action.tagId) {
      tag = await this.tagModel.findOne({ _id: action.tagId, userId: userObjectId }).session(session).exec()
    }
    let createdTag = false
    if (!tag && action.tagName) {
      tag = await this.tagModel.findOne({ userId: userObjectId, name: String(action.tagName).trim() }).session(session).exec()
      if (!tag) {
        tag = await this.tagModel.create([{ userId: userObjectId, name: String(action.tagName).trim(), noteCount: 0 }], { session }).then((rows) => rows[0])
        createdTag = true
      }
    }
    if (!tag) throw new BadRequestException('Tag not found')
    const updatedNoteIds: string[] = []
    for (const noteId of (action.noteIds || [])) {
      const note = await this.requireWritableNote(noteId, userId, session)
      const next = new Set((note.tags || []).map((id) => String(id)))
      if (!next.has(String(tag!._id))) {
        next.add(String(tag!._id))
        note.tags = [...next].map((id) => new Types.ObjectId(id)) as any
        await note.save({ session })
        updatedNoteIds.push(String(noteId))
      }
    }
    return {
      actionId: action.actionId,
      type: action.type,
      noteIds: (action.noteIds || []).map(String),
      result: { tagId: String(tag._id), createdTag, updatedNoteIds },
      inverse: { tagId: String(tag._id), createdTag, noteIds: updatedNoteIds },
    }
  }

  private async applySetCategory(userId: string, action: ExecutableAction, session: any): Promise<JournalAction> {
    const userObjectId = this.noteAccess.objectId(userId, 'user id')
    const categoryId = action.categoryId ? this.noteAccess.objectId(String(action.categoryId), 'category id') : null
    if (categoryId) {
      const category = await this.categoryModel.findOne({ _id: categoryId, userId: userObjectId }).session(session).exec()
      if (!category) throw new NotFoundException('Category not found')
    }
    const previousByNote = new Map<string, string | null>()
    for (const noteId of (action.noteIds || [])) {
      const note = await this.requireWritableNote(noteId, userId, session)
      const previous = note.categoryId ? String(note.categoryId) : null
      previousByNote.set(String(noteId), previous)
      if (previous !== (categoryId ? String(categoryId) : null)) {
        ;(note as any).categoryId = categoryId || null
        await note.save({ session })
      }
    }
    return {
      actionId: action.actionId,
      type: action.type,
      noteIds: (action.noteIds || []).map(String),
      result: { categoryId: categoryId ? String(categoryId) : null },
      inverse: { categoryId: categoryId ? String(categoryId) : null, previousByNote: Object.fromEntries(previousByNote) },
    }
  }

  private async applyRewriteNote(userId: string, action: ExecutableAction, session: any): Promise<JournalAction> {
    const noteId = action.noteIds?.[0]
    if (!noteId) throw new BadRequestException('rewrite_note requires one note')
    const note = await this.requireWritableNote(noteId, userId, session)
    const previous = this.snapshotNoteState(note)
    const content = this.firstText(action.payload?.body, action.payload?.suggestion)
    if (content === undefined) throw new BadRequestException('rewrite_note requires body or suggestion payload')
    await this.createNoteVersion(note, session)
    ;(note as any).content = content
    ;(note as any).summary = this.fallbackSummary(content)
    ;(note as any).summarySource = 'fallback'
    await note.save({ session })
    return {
      actionId: action.actionId,
      type: action.type,
      noteIds: [String(noteId)],
      result: { noteId: String(noteId) },
      inverse: { previous },
    }
  }

  private async applySplitNote(userId: string, action: ExecutableAction, session: any): Promise<JournalAction> {
    const sourceId = action.noteIds?.[0]
    if (!sourceId) throw new BadRequestException('split_note requires source note')
    const source = await this.requireWritableNote(sourceId, userId, session)
    const previous = this.snapshotNoteState(source)
    const sections = Array.isArray(action.payload?.sections) ? action.payload.sections : []
    if (sections.length === 0) throw new BadRequestException('split_note requires payload.sections')
    await this.archiveNote(source, session)
    const createdNoteIds: string[] = []
    const userObjectId = this.noteAccess.objectId(userId, 'user id')
    for (const section of sections) {
      const title = String(section?.title || '拆分片段').trim() || '拆分片段'
      const content = String(section?.summary || '')
      const note = await this.noteModel.create([{
        title,
        content,
        summary: this.fallbackSummary(content),
        summarySource: 'fallback',
        userId: userObjectId,
        status: 'published',
        visibility: 'private',
        tags: [],
      }], { session }).then((rows) => rows[0])
      createdNoteIds.push(String(note._id))
    }
    return {
      actionId: action.actionId,
      type: action.type,
      noteIds: [String(sourceId)],
      result: { sourceNoteId: String(sourceId), createdNoteIds },
      inverse: { sourceNoteId: String(sourceId), previous, createdNoteIds },
    }
  }

  private async applyMergeNotes(userId: string, action: ExecutableAction, session: any): Promise<JournalAction> {
    const sourceIds = (action.noteIds || []).map(String)
    if (sourceIds.length < 2) throw new BadRequestException('merge_notes requires at least two source notes')
    const userObjectId = this.noteAccess.objectId(userId, 'user id')
    const sources: Array<{ id: string; state: any }> = []
    for (const sourceId of sourceIds) {
      const note = await this.requireWritableNote(sourceId, userId, session)
      sources.push({ id: String(sourceId), state: this.snapshotNoteState(note) })
      await this.archiveNote(note, session)
    }
    let target: NoteDocument | null = null
    let createdTarget = false
    const targetNoteId = action.targetNoteId ? String(action.targetNoteId) : undefined
    if (targetNoteId && !sourceIds.includes(targetNoteId)) {
      target = await this.noteModel.findOne({ _id: this.noteAccess.objectId(targetNoteId, 'target note id'), userId: userObjectId }).session(session).exec()
    }
    const targetTitle = String(action.payload?.targetTitle || sources[0]?.state?.title || '合并笔记')
    const mergedContent = this.firstText(action.payload?.body, action.payload?.suggestion) || sources.map((s) => s.state.content).filter(Boolean).join('\n\n---\n\n')
    let previousTarget: any
    if (!target) {
      target = await this.noteModel.create([{
        title: targetTitle,
        content: mergedContent,
        summary: this.fallbackSummary(mergedContent),
        summarySource: 'fallback',
        userId: userObjectId,
        status: 'published',
        visibility: 'private',
        tags: [],
      }], { session }).then((rows) => rows[0])
      createdTarget = true
    } else {
      // 目标笔记已有版本历史，执行前先快照，undo 才可能恢复到合并前状态。
      previousTarget = this.snapshotNoteState(target)
      await this.createNoteVersion(target, session)
      target.title = targetTitle
      target.content = mergedContent
      target.summary = this.fallbackSummary(mergedContent)
      target.summarySource = 'fallback'
      await target.save({ session })
    }
    return {
      actionId: action.actionId,
      type: action.type,
      noteIds: sourceIds,
      result: { targetNoteId: String(target._id), createdTarget, sourceNoteIds: sourceIds },
      inverse: {
        targetNoteId: String(target._id),
        createdTarget,
        sourceStates: sources,
        previousTarget: createdTarget ? undefined : previousTarget,
      },
    }
  }

  private async applyInverse(userId: string, entry: any, session: any) {
    const inverse = entry.inverse || {}
    switch (entry.type) {
      case 'create_knowledge_base': {
        const userObjectId = this.noteAccess.objectId(userId, 'user id')
        const kbId = this.noteAccess.objectId(String(inverse.knowledgeBaseId || ''), 'knowledge base id')
        if (Array.isArray(inverse.noteIds)) {
          for (const noteId of inverse.noteIds) {
            await this.kbNoteModel.deleteOne({ knowledgeBaseId: kbId, noteId: new Types.ObjectId(String(noteId)), userId: userObjectId }).session(session).exec()
          }
        }
        if (inverse.createdKb) {
          const otherLinks = await this.kbNoteModel.countDocuments({ knowledgeBaseId: kbId }).session(session)
          if (otherLinks === 0) {
            await this.kbModel.deleteOne({ _id: kbId }).session(session).exec()
          }
        }
        break
      }
      case 'move_note': {
        const userObjectId = this.noteAccess.objectId(userId, 'user id')
        const targetKbId = this.noteAccess.objectId(String(inverse.knowledgeBaseId || ''), 'knowledge base id')
        for (const link of (Array.isArray(inverse.addedLinks) ? inverse.addedLinks : [])) {
          await this.kbNoteModel.deleteOne({
            knowledgeBaseId: targetKbId,
            noteId: new Types.ObjectId(String(link.noteId)),
            userId: userObjectId,
          }).session(session).exec()
        }
        const previousByNote = inverse.previousByNote || {}
        for (const [noteId, previousKbIds] of Object.entries(previousByNote)) {
          for (const kbId of (previousKbIds as string[])) {
            const exists = await this.kbNoteModel.exists({
              knowledgeBaseId: new Types.ObjectId(kbId),
              noteId: new Types.ObjectId(noteId),
              userId: userObjectId,
            }).session(session)
            if (!exists) {
              await this.kbNoteModel.create([{
                knowledgeBaseId: new Types.ObjectId(kbId),
                noteId: new Types.ObjectId(noteId),
                userId: userObjectId,
              }], { session })
            }
          }
        }
        break
      }
      case 'add_tag': {
        const userObjectId = this.noteAccess.objectId(userId, 'user id')
        const tagId = new Types.ObjectId(String(inverse.tagId))
        for (const noteId of (Array.isArray(inverse.noteIds) ? inverse.noteIds : [])) {
          await this.noteModel.updateOne(
            { _id: new Types.ObjectId(String(noteId)), userId: userObjectId },
            { $pull: { tags: tagId } },
          ).session(session).exec()
        }
        if (inverse.createdTag) {
          const used = await this.noteModel.countDocuments({ tags: tagId }).session(session)
          if (used === 0) {
            await this.tagModel.deleteOne({ _id: tagId }).session(session).exec()
          }
        }
        break
      }
      case 'set_category': {
        const userObjectId = this.noteAccess.objectId(userId, 'user id')
        for (const [noteId, previousCategoryId] of Object.entries(inverse.previousByNote || {})) {
          await this.noteModel.updateOne(
            { _id: new Types.ObjectId(noteId), userId: userObjectId },
            { $set: { categoryId: previousCategoryId ? new Types.ObjectId(String(previousCategoryId)) : null } },
          ).session(session).exec()
        }
        break
      }
      case 'rewrite_note': {
        if (inverse.previous?.noteId) await this.restoreNoteState(inverse.previous, session)
        break
      }
      case 'split_note': {
        for (const noteId of (inverse.createdNoteIds || [])) {
          await this.noteModel.deleteOne({ _id: new Types.ObjectId(String(noteId)) }).session(session).exec()
        }
        if (inverse.previous?.noteId) await this.restoreNoteState(inverse.previous, session)
        break
      }
      case 'merge_notes': {
        if (inverse.createdTarget) {
          await this.noteModel.deleteOne({ _id: new Types.ObjectId(String(inverse.targetNoteId)) }).session(session).exec()
        } else if (inverse.previousTarget?.noteId) {
          await this.restoreNoteState(inverse.previousTarget, session)
        }
        for (const source of (inverse.sourceStates || [])) {
          await this.restoreNoteState(source, session)
        }
        break
      }
      default:
        throw new BadRequestException(`Unsupported inverse organizer action type: ${String(entry.type)}`)
    }
  }

  private async findUndoConflicts(execution: OrganizerExecutionDocument, userId: string, session: any) {
    const conflicts: Array<{ noteId: string; message: string }> = []
    const expectedByNote = new Map<string, string>()
    for (const entry of (execution.actions || [])) {
      const value = this.toPlain(entry)
      const afterUpdatedAts = (value?.result?.afterUpdatedAts as Record<string, string>) || {}
      for (const [noteId, expected] of Object.entries(afterUpdatedAts)) {
        expectedByNote.set(noteId, expected)
      }
    }
    for (const [noteId, expected] of expectedByNote.entries()) {
      const note = await this.noteModel.findById(new Types.ObjectId(noteId)).session(session).select('updatedAt').lean().exec()
      if (!note) {
        conflicts.push({ noteId, message: '笔记已被删除，无法自动撤销' })
      } else if (String((note as any).updatedAt) !== expected) {
        conflicts.push({ noteId, message: '笔记在执行后被编辑过，已阻止自动覆盖' })
      }
    }
    return conflicts
  }

  private async requireWritableNote(noteId: Types.ObjectId | string, userId: string, session: any): Promise<NoteDocument> {
    const note = await this.noteModel.findOne(this.noteAccess.writeScope(String(noteId), userId)).session(session).exec()
    if (!note) throw new NotFoundException('Note not found or not writable')
    return note
  }

  private async archiveNote(note: NoteDocument, session: any) {
    ;(note as any)[ARCHIVED_AT_FIELD] = new Date()
    await note.save({ session })
  }

  private async createNoteVersion(note: NoteDocument, session: any) {
    const last = await this.noteVersionModel.findOne({ noteId: note._id }).sort({ versionNo: -1 }).session(session).exec()
    const nextNo = (last?.versionNo || 0) + 1
    await this.noteVersionModel.create([{
      noteId: note._id,
      versionNo: nextNo,
      title: note.title,
      content: note.content,
      tags: (note.tags || []).map((id) => id),
      categoryId: (note as any).categoryId,
      createdBy: (note as any).userId || note._id,
    }], { session })
  }

  private snapshotNoteState(note: NoteDocument) {
    return {
      noteId: String(note._id),
      title: String(note.title || ''),
      content: String(note.content || ''),
      tags: (note.tags || []).map((id) => String(id)),
      categoryId: note.categoryId ? String(note.categoryId) : null,
      archivedAt: (note as any)[ARCHIVED_AT_FIELD] ? String((note as any)[ARCHIVED_AT_FIELD]) : null,
    }
  }

  private async restoreNoteState(state: any, session: any) {
    if (!state?.noteId) return
    const note = await this.noteModel.findOne({ _id: new Types.ObjectId(String(state.noteId)) }).session(session).exec()
    if (!note) return
    note.title = state.title
    note.content = state.content
    note.tags = (state.tags || []).map((id: string) => new Types.ObjectId(id)) as any
    ;(note as any).categoryId = state.categoryId ? new Types.ObjectId(String(state.categoryId)) : null
    ;(note as any)[ARCHIVED_AT_FIELD] = state.archivedAt ? new Date(String(state.archivedAt)) : null
    await note.save({ session })
  }

  private fallbackSummary(content: string) {
    const plain = String(content || '').replace(/[#>*_`~-]/g, ' ').replace(/\s+/g, ' ').trim()
    return plain.slice(0, 200)
  }

  private firstText(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return undefined
  }

  private async withTransaction<T>(fn: (session: any) => Promise<T>): Promise<T> {
    const db: any = (this.noteModel as any).db
    if (typeof db?.startSession !== 'function') {
      throw new Error('Organizer execution requires MongoDB transaction support')
    }
    const session = await db.startSession()
    if (typeof session?.withTransaction !== 'function') {
      await session?.endSession?.()
      throw new Error('Organizer execution requires MongoDB transaction support')
    }
    try {
      return await session.withTransaction(() => fn(session))
    } finally {
      await session.endSession()
    }
  }

  private toPlain(doc: any) {
    return typeof doc?.toObject === 'function' ? doc.toObject() : doc
  }

  private serialize(doc: any) {
    const value = this.toPlain(doc)
    return {
      id: String(value._id || value.id),
      proposalId: String(value.proposalId || ''),
      proposalRevision: value.proposalRevision,
      status: value.status,
      undoDeadline: value.undoDeadline,
      undoneAt: value.undoneAt || undefined,
      actions: (value.actions || []).map((action: any) => ({
        actionId: action.actionId,
        type: action.type,
        noteIds: (action.noteIds || []).map((id: any) => String(id)),
      })),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    }
  }
}
