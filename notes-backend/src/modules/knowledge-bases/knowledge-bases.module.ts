import { Module, forwardRef } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { NotesModule } from '../notes/notes.module'
import { Note, NoteSchema } from '../notes/schemas/note.schema'
import { KnowledgeBasesController } from './knowledge-bases.controller'
import { KnowledgeBasesService } from './knowledge-bases.service'
import { KnowledgeGraphService } from './knowledge-graph.service'
import { KnowledgeBase, KnowledgeBaseSchema } from './schemas/knowledge-base.schema'
import { KnowledgeBaseNote, KnowledgeBaseNoteSchema } from './schemas/knowledge-base-note.schema'
import { KnowledgeGraphEdge, KnowledgeGraphEdgeSchema } from './schemas/knowledge-graph-edge.schema'
import { KnowledgeGraphNode, KnowledgeGraphNodeSchema } from './schemas/knowledge-graph-node.schema'

@Module({
  imports: [
    forwardRef(() => NotesModule),
    MongooseModule.forFeature([
      { name: KnowledgeBase.name, schema: KnowledgeBaseSchema },
      { name: KnowledgeBaseNote.name, schema: KnowledgeBaseNoteSchema },
      { name: KnowledgeGraphNode.name, schema: KnowledgeGraphNodeSchema },
      { name: KnowledgeGraphEdge.name, schema: KnowledgeGraphEdgeSchema },
      { name: Note.name, schema: NoteSchema },
    ]),
  ],
  controllers: [KnowledgeBasesController],
  providers: [KnowledgeBasesService, KnowledgeGraphService],
  exports: [KnowledgeBasesService],
})
export class KnowledgeBasesModule {}
