import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export const ORGANIZER_ACTION_TYPES = [
  'create_knowledge_base',
  'move_note',
  'add_tag',
  'set_category',
  'merge_notes',
  'split_note',
  'rewrite_note',
] as const

export type OrganizerActionType = (typeof ORGANIZER_ACTION_TYPES)[number]

export type OrganizerRiskLevel = 'low' | 'high'
export type OrganizerProposalStatus = 'pending' | 'stale' | 'confirmed'

@Schema({ _id: false })
export class OrganizerProposalNoteExpectation {
  @Prop({ type: Types.ObjectId, ref: 'Note', required: true })
  noteId: Types.ObjectId

  @Prop({ type: Date, required: true })
  updatedAt: Date
}

@Schema({ _id: false })
export class OrganizerProposalAction {
  @Prop({ required: true })
  actionId: string

  @Prop({ required: true, enum: ORGANIZER_ACTION_TYPES })
  type: OrganizerActionType

  @Prop({ type: [Types.ObjectId], ref: 'Note', default: [] })
  noteIds: Types.ObjectId[]

  @Prop({ required: true, enum: ['low', 'high'], default: 'low' })
  riskLevel: OrganizerRiskLevel

  @Prop({ required: true, default: '' })
  reason: string

  @Prop({ type: [Types.ObjectId], ref: 'NoteChunk', default: [] })
  evidenceChunkIds: Types.ObjectId[]

  @Prop({ type: [OrganizerProposalNoteExpectation], default: [] })
  expectedUpdatedAt: OrganizerProposalNoteExpectation[]

  @Prop({ type: Types.ObjectId, ref: 'Category' })
  categoryId?: Types.ObjectId

  @Prop()
  categoryName?: string

  @Prop({ type: Types.ObjectId, ref: 'Tag' })
  tagId?: Types.ObjectId

  @Prop()
  tagName?: string

  @Prop({ type: Types.ObjectId, ref: 'KnowledgeBase' })
  knowledgeBaseId?: Types.ObjectId

  @Prop()
  knowledgeBaseName?: string

  @Prop({ type: Types.ObjectId, ref: 'Note' })
  targetNoteId?: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Note' })
  sourceNoteId?: Types.ObjectId

  @Prop({ type: Object, default: {} })
  payload: Record<string, unknown>
}

@Schema({ collection: 'organizer_proposals', timestamps: true })
export class OrganizerProposal {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId

  @Prop({ required: true, enum: ['pending', 'stale', 'confirmed'], default: 'pending' })
  status: OrganizerProposalStatus

  @Prop({ required: true, default: 1 })
  revision: number

  @Prop()
  modelRunId?: string

  @Prop({ default: '' })
  summary?: string

  @Prop({ type: [OrganizerProposalAction], default: [] })
  actions: OrganizerProposalAction[]
}

export type OrganizerProposalDocument = OrganizerProposal & Document
export type OrganizerProposalActionDocument = OrganizerProposalAction & Document

export const OrganizerProposalSchema = SchemaFactory.createForClass(OrganizerProposal)
OrganizerProposalSchema.index({ userId: 1, createdAt: -1 }, { name: 'idx_organizer_proposal_user_created' })
OrganizerProposalSchema.index({ userId: 1, status: 1, createdAt: -1 }, { name: 'idx_organizer_proposal_user_status_created' })
