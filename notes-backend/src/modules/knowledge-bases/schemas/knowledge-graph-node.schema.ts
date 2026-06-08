import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type KnowledgeGraphNodeDocument = KnowledgeGraphNode & Document

@Schema({ collection: 'knowledge_graph_nodes', timestamps: true })
export class KnowledgeGraphNode {
  @Prop({ type: Types.ObjectId, ref: 'KnowledgeBase', required: true })
  knowledgeBaseId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId

  @Prop({ required: true })
  nodeId: string

  @Prop({ required: true })
  label: string

  @Prop({ required: true, enum: ['concept', 'entity', 'topic', 'claim'], default: 'concept' })
  type: string

  @Prop({ required: true, min: 0, max: 1, default: 0.75 })
  confidence: number

  @Prop({ type: [Types.ObjectId], ref: 'Note', default: [] })
  noteIds: Types.ObjectId[]
}

export const KnowledgeGraphNodeSchema = SchemaFactory.createForClass(KnowledgeGraphNode)

KnowledgeGraphNodeSchema.index(
  { knowledgeBaseId: 1, userId: 1, nodeId: 1 },
  { name: 'uniq_knowledge_graph_node_kb_user_node', unique: true },
)
KnowledgeGraphNodeSchema.index(
  { userId: 1, knowledgeBaseId: 1, createdAt: -1 },
  { name: 'idx_knowledge_graph_node_user_kb_created' },
)
