import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { ORGANIZER_ACTION_TYPES, OrganizerActionType } from './organizer-proposal.schema'

@Schema({ _id: false })
export class OrganizerExecutionActionJournal {
  @Prop({ required: true })
  actionId: string

  @Prop({ required: true, enum: ORGANIZER_ACTION_TYPES })
  type: OrganizerActionType

  @Prop({ type: [Types.ObjectId], ref: 'Note', default: [] })
  noteIds: Types.ObjectId[]

  @Prop({ type: Object, default: {} })
  result: Record<string, unknown>

  // 保存撤销所需的最小反向信息；不保存 AI reasoning。
  @Prop({ type: Object, default: {} })
  inverse: Record<string, unknown>
}

@Schema({ collection: 'organizer_executions', timestamps: true })
export class OrganizerExecution {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'OrganizerProposal', required: true, index: true })
  proposalId: Types.ObjectId

  @Prop({ required: true })
  proposalRevision: number

  @Prop({ required: true, enum: ['executed', 'undone'], default: 'executed' })
  status: 'executed' | 'undone'

  @Prop()
  idempotencyKey?: string

  @Prop({ required: true, type: Date })
  undoDeadline: Date

  @Prop({ type: [OrganizerExecutionActionJournal], default: [] })
  actions: OrganizerExecutionActionJournal[]

  @Prop({ type: Date })
  undoneAt?: Date
}

export type OrganizerExecutionDocument = OrganizerExecution & Document
export type OrganizerExecutionActionJournalDocument = OrganizerExecutionActionJournal & Document

export const OrganizerExecutionSchema = SchemaFactory.createForClass(OrganizerExecution)
OrganizerExecutionSchema.index({ userId: 1, idempotencyKey: 1 }, { name: 'uniq_organizer_execution_user_idem', unique: true, sparse: true })
OrganizerExecutionSchema.index({ userId: 1, createdAt: -1 }, { name: 'idx_organizer_execution_user_created' })
