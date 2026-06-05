import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type KnowledgeBaseNoteDocument = KnowledgeBaseNote & Document

@Schema({ collection: 'knowledge_base_notes', timestamps: true })
export class KnowledgeBaseNote {
  @Prop({ type: Types.ObjectId, ref: 'KnowledgeBase', required: true })
  knowledgeBaseId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Note', required: true })
  noteId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId
}

export const KnowledgeBaseNoteSchema = SchemaFactory.createForClass(KnowledgeBaseNote)

KnowledgeBaseNoteSchema.index(
  { knowledgeBaseId: 1, noteId: 1 },
  { name: 'uniq_knowledge_base_note', unique: true },
)
KnowledgeBaseNoteSchema.index(
  { userId: 1, knowledgeBaseId: 1, createdAt: -1 },
  { name: 'idx_knowledge_base_note_user_kb_created' },
)
KnowledgeBaseNoteSchema.index({ noteId: 1 }, { name: 'idx_knowledge_base_note_note' })
