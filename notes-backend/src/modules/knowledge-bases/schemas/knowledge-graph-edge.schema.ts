import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type KnowledgeGraphEdgeDocument = KnowledgeGraphEdge & Document

@Schema({ collection: 'knowledge_graph_edges', timestamps: true })
export class KnowledgeGraphEdge {
  @Prop({ type: Types.ObjectId, ref: 'KnowledgeBase', required: true })
  knowledgeBaseId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId

  @Prop({ required: true })
  edgeId: string

  @Prop({ required: true })
  source: string

  @Prop({ required: true })
  target: string

  @Prop({ required: true, default: 'related to' })
  relation: string

  @Prop({ required: true, min: 0, max: 1, default: 0.6 })
  weight: number

  @Prop({ type: [Types.ObjectId], ref: 'Note', default: [] })
  noteIds: Types.ObjectId[]

  @Prop({ type: [Types.ObjectId], ref: 'NoteChunk', default: [] })
  evidenceChunkIds: Types.ObjectId[]
}

export const KnowledgeGraphEdgeSchema = SchemaFactory.createForClass(KnowledgeGraphEdge)

KnowledgeGraphEdgeSchema.index(
  { knowledgeBaseId: 1, userId: 1, edgeId: 1 },
  { name: 'uniq_knowledge_graph_edge_kb_user_edge', unique: true },
)
KnowledgeGraphEdgeSchema.index(
  { userId: 1, knowledgeBaseId: 1, createdAt: -1 },
  { name: 'idx_knowledge_graph_edge_user_kb_created' },
)
